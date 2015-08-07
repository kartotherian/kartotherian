'use strict';

/*

CassandraStore is a Cassandra tile storage.
 */

var BBPromise = require('bluebird');
var core = require('kartotherian-core');
var cassandra = require('cassandra-driver');
var multistream = require('multistream');
var promistreamus = require('promistreamus');

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
        var params = core.normalizeUri(uri).query;
        if (!params.cp) {
            throw new Error("Uri must include at least one 'cp' connect point query parameter: " + uri)
        } else if (typeof params.cp === 'string') {
            self.contactPoints = [params.cp];
        } else {
            self.contactPoints = params.cp;
        }
        if (!params.keyspace || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.keyspace)) {
            throw new Error("Uri must have a valid 'keyspace' query parameter: " + uri)
        }
        if (params.table && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.table)) {
            throw new Error("Optional uri 'table' param must be a valid value: " + uri)
        }
        if (params.repclass && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.repclass)) {
            throw new Error("Uri 'repclass' must be a valid value: " + uri)
        }
        self.keyspace = params.keyspace;
        self.table = params.table || 'tiles';
        self.repclass = params.repclass || 'SimpleStrategy';
        self.repfactor = typeof params.repfactor === 'undefined' ? 3 : parseInt(params.repfactor);
        var dw = params.durablewrite;
        self.durablewrite = (typeof dw === 'undefined' || (dw && dw !== 'false' && dw !== '0')) ? 'true' : 'false';
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : parseInt(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 15 : parseInt(params.maxzoom);
        self.blocksize = typeof params.blocksize === 'undefined' ? 32768 : parseInt(params.blocksize);
        self.maxBatchSize = typeof params.maxBatchSize === 'undefined' ? undefined : parseInt(params.maxBatchSize);
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
        var createTableSql = "CREATE TABLE IF NOT EXISTS " + self.table + " (" +
            " zoom int," +
            (self.blocksize ? " block int," : "") +
            " idx int," +
            " tile blob," +
            (self.blocksize
                ? " PRIMARY KEY (zoom, block, idx)"
                : " PRIMARY KEY (zoom, idx)") +
            ")";
        return self.client.executeAsync(createTableSql);
    }).catch(function (err) {
        return self.closeAsync().finally(function () {
            throw err;
        });
    }).then(function () {
        var whereClause = ' WHERE zoom = ? AND idx = ?';
        if (self.blocksize)
            whereClause += ' AND block = ?';
        self.queries = {
            getTile: 'SELECT tile FROM ' + self.table + whereClause,
            getWriteTime: 'SELECT WRITETIME(tile) AS wt FROM ' + self.table + whereClause,
            getTileAndWt: 'SELECT tile, WRITETIME(tile) AS wt FROM ' + self.table + whereClause,
            set: 'UPDATE ' + self.table + ' SET tile = ?' + whereClause,
            delete: 'DELETE FROM ' + self.table + whereClause
        };

        return self;
    }).nodeify(callback);
}

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

CassandraStore.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    return this.queryTileAsync({zoom: z, idx: core.xyToIndex(x, y)}).then(function(row) {
        if (row) {
            return [row.tile, self.headers];
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
    var idx = core.xyToIndex(x, y);
    if (tile && tile.length > 0) {
        query = this.queries.set;
        params = [tile, z, idx];
    } else {
        query = this.queries.delete;
        params = [z, idx];
    }
    if (this.blocksize)
        params.push(Math.floor(idx / this.blocksize));
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

CassandraStore.prototype.queryTileAsync = function(options) {
    var self = this, getTile, getWriteTime, getSize;

    return BBPromise.try(function() {
        if (!core.isInteger(options.zoom))
            throw new Error('Options must contain integer zoom parameter');
        if (!core.isInteger(options.idx))
            throw new Error('Options must contain an integer idx parameter');
        var maxEnd = Math.pow(4, options.zoom);
        if (options.idx < 0 || options.idx >= maxEnd)
            throw new Error('Options must satisfy: 0 <= idx < ' + maxEnd + ', requestd idx=' + options.idx);
        getTile = typeof options.getTile === 'undefined' ? true : options.getTile;
        getWriteTime = typeof options.getWriteTime === 'undefined' ? false : options.getWriteTime;
        getSize = typeof options.getSize === 'undefined' ? false : options.getSize;
        var query;
        if (getWriteTime && (getTile || getSize))
            query = self.queries.getTileAndWt;
        else if (getTile || getSize)
            query = self.queries.getTile;
        else if (getWriteTime)
            query = self.queries.getWriteTime;
        else
            throw new Error('Either getTile or getWriteTime or both must be requested');
        var params = [options.zoom, options.idx];
        if (self.blocksize)
            params.push(Math.floor(options.idx / self.blocksize));
        return self.client.executeAsync(query, params, prepared);
    }).then(function(res) {
        if ('rows' in res && res.rows.length === 1) {
            var row = res.rows[0];
            var resp = {};
            if (getTile) resp.tile = row.tile;
            if (getSize) resp.size = row.tile.length; // TODO: Use UDF in the next Cassandra ver
            if (getWriteTime) resp.writeTime = new Date(row.wt / 1000);
            return resp;
        } else {
            return false;
        }
    });
};

/**
 * Query database for all tiles that match conditions
 * @param options - an object that must have an integer 'zoom' value.
 * Optional values:
 *  idxFrom - int index to start iteration from (inclusive)
 *  idxBefore - int index to stop iteration at (exclusive)
 *  dateFrom - Date value - return only tiles whose write time is on or after this date (inclusive)
 *  dateBefore - Date value - return only tiles whose write time is before this date (exclusive)
 *  biggerThan - number - return only tiles whose compressed size is bigger than this value (inclusive)
 *  smallerThan - number - return only tiles whose compressed size is smaller than this value (exclusive)
 * @returns {Function} - a function that returns a promise. If promise resolves to undefined, there are no more values
 * in the stream.
 */
CassandraStore.prototype.query = function(options) {
    var self = this,
        dateBefore, dateFrom;

    if (!core.isInteger(options.zoom))
        throw new Error('Options must contain integer zoom parameter');
    if (typeof options.idxFrom !== 'undefined' && !core.isInteger(options.idxFrom))
        throw new Error('Options may contain an integer idxFrom parameter');
    if (typeof options.idxBefore !== 'undefined' && !core.isInteger(options.idxBefore))
        throw new Error('Options may contain an integer idxBefore parameter');
    if (typeof options.dateBefore !== 'undefined' && Object.prototype.toString.call(options.dateBefore) !== '[object Date]')
        throw new Error('Options may contain a Date dateBefore parameter');
    if (typeof options.dateFrom !== 'undefined' && Object.prototype.toString.call(options.dateFrom) !== '[object Date]')
        throw new Error('Options may contain a Date dateFrom parameter');
    if (typeof options.biggerThan !== 'undefined' && typeof options.biggerThan !== 'number')
        throw new Error('Options may contain a biggerThan numeric parameter');
    if ((typeof options.smallerThan !== 'undefined' && typeof options.smallerThan !== 'number') || options.smallerThan <= 0)
        throw new Error('Options may contain a smallerThan numeric parameter that is bigger than 0');
    var maxEnd = Math.pow(4, options.zoom);
    var start = options.idxFrom || 0;
    var end = options.idxBefore || maxEnd;
    if (start > end || end > maxEnd)
        throw new Error('Options must satisfy: idxFrom <= idxBefore <= ' + maxEnd);
    if (options.dateFrom >= options.dateBefore)
        throw new Error('Options must satisfy: dateFrom < dateBefore');
    dateFrom = options.dateFrom ? options.dateFrom.valueOf() * 1000 : false;
    dateBefore = options.dateBefore ? options.dateBefore.valueOf() * 1000 : false;

    var fields = 'idx';
    if (options.getTiles || options.smallerThan || options.biggerThan) {
        // If tile size check is requested, we have to get the whole tile at this point...
        // TODO: in the next Cassandra, UDFs should help with this
        // Optimization - if biggerThan is 0, it will not be used
        fields += ', tile';
    }
    if (dateBefore !== false || dateFrom !== false) {
        fields += ', WRITETIME(tile) AS wt';
    }

    var createStream = function(blockStart, blockEnd) {
        var conds = 'zoom = ?',
            params = [options.zoom];
        if (self.blocksize) {
            conds += ' AND block = ?';
            params.push(Math.floor(blockStart / self.blocksize));
        }
        if (start > blockStart) {
            conds += ' AND idx >= ?';
            params.push(start);
        }
        if (end < blockEnd) {
            conds += ' AND idx < ?';
            params.push(end);
        }
        var query = 'SELECT ' + fields + ' FROM ' + self.table + ' WHERE ' + conds;
        return self.client.stream(query, params, {prepare: true, autoPage: true});
    };

    var ms;
    if (self.blocksize) {
        var blockIdx = Math.floor(start / self.blocksize);
        var toBlockIdx = Math.floor((end - 1) / self.blocksize);
        ms = multistream.obj(function() {
            if (blockIdx > toBlockIdx) return false;
            var s = createStream(blockIdx * self.blocksize,
                Math.min(maxEnd, (blockIdx + 1) * self.blocksize));
            blockIdx++;
            return s;
        });
    } else {
        ms = createStream(0, maxEnd);
    }

    return promistreamus(ms, function(value) {
        if ((dateBefore !== false && value.wt >= dateBefore) ||
            (dateFrom !== false && value.wt < dateFrom) ||
            (options.smallerThan && value.tile.length >= options.smallerThan) ||
            (options.biggerThan && value.tile.length < options.biggerThan)
        ) {
            return undefined;
        }
        var res = {
            zoom: options.zoom,
            idx: value.idx
        };
        if (options.getTiles) {
            res.tile = value.tile;
        }
        return res;
    });
};

BBPromise.promisifyAll(CassandraStore.prototype);
module.exports = CassandraStore;
