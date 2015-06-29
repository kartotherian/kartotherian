'use strict';

/*

CassandraStore is a Cassandra tile storage.
 */

var promisify = require('./promisify');
var BBPromise = require('bluebird');
var util = require('./util');
var cassandra = require('cassandra-driver');
var prepared = {prepare: true};

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

function CassandraStore(uri, callback) {
    var self = this;
    this.batchMode = 0;
    this.batch = {};
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
        self.maxBatchSize = typeof params.maxBatchSize === 'undefined' ? 500 : intParse(params.maxBatchSize);
        self.client = new cassandra.Client({contactPoints: self.contactPoints});
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
        return self.close().finally(function () {
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

    if (!this.batchMode) {
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
        delete this.client;
        return BBPromise.try(cl.shutdownAsync).nodeify(callback);
    }
};

CassandraStore.prototype.startWriting = function(callback) {
    this.batchMode++;
    callback(null);
};

CassandraStore.prototype.flush = function(callback) {
    var batch = this.batch;
    if (Object.keys(batch).length > 0) {
        this.batch = {};
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

CassandraStore.prototype.eachTile = function(options, rowCallback, callback) {
    if (typeof options.zoom !== 'number' || Math.floor(options.zoom) !== options.zoom)
        throw new Error('Options must contain integer zoom parameter');
    if (typeof options.indexStart !== 'number' || Math.floor(options.indexStart) !== options.indexStart)
        throw new Error('Options may contain an integer indexStart parameter');
    if (typeof options.indexEnd !== 'number' || Math.floor(options.indexEnd) !== options.indexEnd)
        throw new Error('Options may contain an integer indexEnd parameter');
    var zoom = options.zoom;
    var maxEnd = Math.pow(4, zoom);
    var start = options.indexStart || 0;
    var end = options.indexEnd || maxEnd;
    if (start > end || end > maxEnd)
        throw new Error('Options must satisfy: indexStart <= indexEnd <= ' + maxEnd);

    if (start === end) {
        // optimization
        callback();
        return;
    }

    var query = "SELECT tile FROM tiles WHERE zoom = ?",
        params = [zoom];
    if (start > 0) {
        query += ' AND idx >= ?';
        params.push(start);
    }
    if (end < maxEnd) {
        query += ' AND idx < ?';
        params.push(end);
    }

    client.eachRow(query, params, prepared,
        function(n, row) {
            //the callback will be invoked per each row as soon as they are received
            var xy = util.indexToXY(row.idx);
            rowCallback(zoom, xy[0], xy[1], row.tile);
        },
        function (err) {
            callback(err);
        }
    );
};

BBPromise.promisifyAll(cassandra.Client.prototype);
module.exports = CassandraStore;
