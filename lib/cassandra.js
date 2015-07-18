'use strict';

/*

CassandraStore is a Cassandra tile storage.
 */

var promisify = require('./promisify');
var BBPromise = require('bluebird');
var util = require('./util');
var cassandra = require('cassandra-driver');
var prepared = {prepare: true};

BBPromise.promisifyAll(cassandra.Client.prototype);

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

function CassandraStore(uri, callback) {
    var self = this;
    this.batchMode = 0;
    this.batch = [];
    return BBPromise.try(function () {
        var params = util.normalizeUri(uri).query;
        if (!params.cp) {
            throw new Error("Uri must include at least one 'cp' connect point query parameter: " + uri)
        } else if (typeof params.cp === 'string') {
            self.contactPoints = [params.cp];
        } else {
            self.contactPoints = params.cp;
        }
        if (!params.keyspace || !/^[a-zA-Z0-9]+$/.test(params.keyspace)) {
            throw new Error("Uri must have a valid 'keyspace' query parameter: " + uri)
        }
        if (params.repclass && !/^[a-zA-Z0-9]+$/.test(params.repclass)) {
            throw new Error("Uri 'repclass' must be a valid value: " + uri)
        }
        self.keyspace = params.keyspace;
        self.repclass = params.repclass || 'SimpleStrategy';
        self.repfactor = typeof params.repfactor === 'undefined' ? 3 : parseInt(params.repfactor);
        var dw = params.durablewrite;
        self.durablewrite = (typeof dw === 'undefined' || (dw && dw !== 'false' && dw !== '0')) ? 'true' : 'false';
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : intParse(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 15 : intParse(params.maxzoom);
        self.maxBatchSize = typeof params.maxBatchSize === 'undefined' ? undefined : intParse(params.maxBatchSize);
        var clientOpts = {contactPoints: self.contactPoints};
        if (params.username || params.password) {
            clientOpts.authProvider = new cassandra.auth.PlainTextAuthProvider(params.username, params.password);
        }
        self.client = new cassandra.Client(clientOpts);
        self.headers = {
            'Content-Type': 'application/x-protobuf',
            'Content-Encoding': 'gzip'
        };
        return self.client.connectAsync();
    }).then(function () {
        return self.client.executeAsync(
            "CREATE KEYSPACE IF NOT EXISTS " + self.keyspace +
            " WITH REPLICATION = {'class': '" + self.repclass + "'," +
            " 'replication_factor': " + self.repfactor + "}" +
            " AND DURABLE_WRITES = " + self.durablewrite);
    }).then(function () {
        return self.client.executeAsync("USE " + self.keyspace);
    }).then(function () {
        return self.client.executeAsync(
            "CREATE TABLE IF NOT EXISTS tiles (" +
            " zoom int," +
            " idx int," +
            " tile blob," +
            " PRIMARY KEY (zoom, idx)" +
            ") WITH COMPACT STORAGE");
    }).catch(function (err) {
        return self.closeAsync().finally(function () {
            throw err;
        });
    }).then(function () {
        return self;
    }).nodeify(callback);
}

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

CassandraStore.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    return this.client.executeAsync(
        "SELECT tile FROM tiles WHERE zoom = ? AND idx = ?",
        [z, util.xyToIndex(x, y)],
        prepared
    ).then(function(res) {
        if ('rows' in res && res.rows.length === 1) {
            return [res.rows[0].tile, self.headers];
        } else {
            throw new Error('Tile does not exist');
        }
    }).nodeify(callback, {spread: true});
};

CassandraStore.prototype.getInfo = function(callback) {
    callback(null, {
        "bounds": "-180,-85.0511,180,85.0511",
        "center": "0,0,2",
        "description": "",
        "maxzoom": this.maxzoom,
        "minzoom": this.minzoom,
        "name": "cassandra",
        "template": "",
        "version": "1.0.0"
    });
};

CassandraStore.prototype.putTile = function(z, x, y, tile, callback) {
    var query, params;
    if (tile && tile.length > 0) {
        query = "UPDATE tiles SET tile = ? WHERE zoom = ? AND idx = ?";
        params = [tile, z, util.xyToIndex(x, y)];
    } else {
        query = "DELETE FROM tiles WHERE zoom = ? AND idx = ?";
        params = [z, util.xyToIndex(x, y)];
    }

    if (!this.batchMode || !this.maxBatchSize) {
        this.client.executeAsync(query, params, prepared).nodeify(callback);
    } else {
        this.batch.push({query: query, params: params});
        if (Object.keys(this.batch).length > this.maxBatchSize) {
            this.flush(callback);
        } else {
            callback();
        }
    }
};

CassandraStore.prototype.close = function(callback) {
    var cl = this.client;
    if (!cl) {
        callback(null);
    } else {
        var self = this;
        BBPromise.try(function () {
            return (self.batchMode && self.maxBatchSize) ? self.flushAsync() : true;
        }).then(function () {
            delete self.client;
            self.batchMode = 0;
            return cl.shutdownAsync();
        }).nodeify(callback);
    }
};

CassandraStore.prototype.startWriting = function(callback) {
    this.batchMode++;
    callback(null);
};

CassandraStore.prototype.flush = function(callback) {
    var batch = this.batch;
    if (Object.keys(batch).length > 0) {
        this.batch = [];
        this.client.batchAsync(batch, prepared).nodeify(callback);
    } else {
        callback();
    }
};

CassandraStore.prototype.stopWriting = function(callback) {
    if (this.batchMode === 0) {
        throw new Error('stopWriting() called more times than startWriting()')
    }
    this.batchMode--;
    this.flush(callback);
};

CassandraStore.prototype.query = function(options) {
    var self = this,
        readablePromise = BBPromise.pending(),
        isDone = false,
        error, stream, olderThan, getTiles;

    BBPromise.try(function() {
        if (!util.isInteger(options.zoom))
            throw new Error('Options must contain integer zoom parameter');
        if (typeof options.idxFrom !== 'undefined' && !util.isInteger(options.idxFrom))
            throw new Error('Options may contain an integer idxFrom parameter');
        if (typeof options.idxBefore !== 'undefined' && !util.isInteger(options.idxBefore))
            throw new Error('Options may contain an integer idxBefore parameter');
        if (typeof options.olderThan !== 'undefined' && Object.prototype.toString.call(options.olderThane) !== '[object Date]')
            throw new Error('Options may contain a Date olderThan parameter');
        var maxEnd = Math.pow(4, options.zoom);
        var start = options.idxFrom || 0;
        var end = options.idxBefore || maxEnd;
        if (start > end || end > maxEnd)
            throw new Error('Options must satisfy: idxFrom <= idxBefore <= ' + maxEnd);
        getTiles = typeof options.getTiles === 'undefined' ? true : options.getTiles;
        olderThan = options.olderThan ? options.olderThan.valueOf() * 1000 : false;

        if (start === end) {
            resolve(false);
            return;
        }

        var fields = 'idx';
        if (getTiles) {
            fields += ', tile';
        }
        if (olderThan) {
            fields += ', WRITETIME(tile) AS wt';
        }
        var conds = 'zoom = ?',
            params = [options.zoom];
        if (start > 0) {
            conds += ' AND idx >= ?';
            params.push(start);
        }
        if (end < maxEnd) {
            conds += ' AND idx < ?';
            params.push(end);
        }
        var query = 'SELECT ' + fields + ' FROM tiles WHERE ' + conds;
        stream = self.client.stream(query, params, {prepare: true, autoPage: true})
            .on('readable', function () {
                // Notify waiting promises that data is available,
                // and create a new one to wait for the next chunk of data
                readablePromise.resolve(true);
                readablePromise = BBPromise.pending();
            })
            .on('end', function () {
                isDone = true;
                readablePromise.resolve(true);
            })
            .on('error', function (err) {
                error = err;
                readablePromise.reject(err);
            });
    });

    var readStream = function () {
        if (error) {
            // TODO: decide if we should exhaust the stream before reporting the error or error out right away
            throw error;
        }
        var value;
        while ((value = stream.read())) {
            if (!olderThan || value.wt < olderThan) {
                var res = {
                    zoom: options.zoom,
                    idx: value.idx
                };
                if (getTiles) {
                    res.tile = value.tile;
                }
                return res;
            }
        }
        return undefined;
    };

    var iterator = function () {
        return BBPromise
            .try(readStream)
            .then(function(value) {
                return value === undefined ? readablePromise.promise.then(readStream) : value;
            })
            .then(function(value) {
                if (value !== undefined || isDone) {
                    return value;
                }
                // If we are here, the current promise has been triggered,
                // but by now other "threads" have consumed all buffered rows,
                // so start waiting for the next one
                // Note: there is a minor inefficiency here - readStream is called twice in a value, but its a rare case
                return iterator();
            });
    };
    return iterator;
};

BBPromise.promisifyAll(CassandraStore.prototype);
module.exports = CassandraStore;
