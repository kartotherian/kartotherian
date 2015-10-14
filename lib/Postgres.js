'use strict';

/*

 PostgresStore is a Postgres tile storage.
 */

var util = require('util');
var BBPromise = require('bluebird');
var postgres = require('pg-promise')({promiseLib: BBPromise});
var multistream = require('multistream');
var promistreamus = require('promistreamus');

var core, Err;

function PostgresStore(uri, callback) {
    var self = this;
    this.batchMode = 0;
    this.batch = [];

    this.throwError = function (msg) {
        throw new Error(util.format.apply(null, arguments) + JSON.stringify(uri));
    };

    this.attachUri = function (err) {
        err.moduleUri = JSON.stringify(self._params);
        throw err;
    };

    return BBPromise.try(function () {
        self.headers = {
            'Content-Type': 'application/x-protobuf',
            'Content-Encoding': 'gzip'
        };
        var params = core.normalizeUri(uri).query;
        self._params = params;

        if (!params.database || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.database)) {
            self.throwError("Uri must have a valid 'database' query parameter");
        }
        if (params.table && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.table)) {
            self.throwError("Optional uri 'table' param must be a valid value");
        }
        self.createIfMissing = !!params.createIfMissing;
        self.table = params.table || 'tiles';
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : parseInt(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 20 : parseInt(params.maxzoom);
        self.maxBatchSize = typeof params.maxBatchSize === 'undefined' ? undefined : parseInt(params.maxBatchSize);
        var clientOpts = {
            host: params.host,
            database: params.database,
            user: params.username,
            password: params.password
        };
        // make sure not to expose it in the error reporting
        delete params.password;

        self.client = postgres(clientOpts);

        var sql;
        if (self.createIfMissing) {
            sql = 'CREATE TABLE IF NOT EXISTS ' + self.table + ' (zoom smallint, idx bigint, tile bytea, PRIMARY KEY (zoom, idx))';
        } else {
            // Check the valid structure of the table - must not return any results
            sql = 'SELECT zoom, idx, tile FROM ' + self.table + ' WHERE zoom IS NULL AND idx IS NULL';
        }
        return self.client.none(sql);
    }).then(function () {
        self.queries = {
            getTile: 'SELECT tile FROM ' + self.table + ' WHERE zoom = $1 AND idx = $2',
            getTileSize: 'SELECT length(tile) AS len FROM ' + self.table + ' WHERE zoom = $1 AND idx = $2',
            set: 'UPDATE ' + self.table + ' SET tile=$3 WHERE zoom = $1 AND idx = $2;' +
            'INSERT INTO ' + self.table + ' (zoom, idx, tile) SELECT $1, $2, $3 ' +
            'WHERE NOT EXISTS (SELECT 1 FROM ' + self.table + ' WHERE zoom = $1 AND idx = $2);',
            delete: 'DELETE FROM ' + self.table + ' WHERE zoom = $1 AND idx = $2'
        };

        return self;
    }).catch(this.attachUri).nodeify(callback);
}

PostgresStore.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    return BBPromise.try(function () {
        if (z < self.minzoom || z > self.maxzoom) {
            core.throwNoTile();
        }
        return self.queryTileAsync({zoom: z, idx: core.xyToIndex(x, y, z)});
    }).then(function (row) {
        if (!row) {
            core.throwNoTile();
        }
        return [row.tile, self.headers];
    }).catch(this.attachUri).nodeify(callback, {spread: true});
};

PostgresStore.prototype.putInfo = function(data, callback) {
    // hack: Store source info under zoom -1 with ID 0
    return this._storeDataAsync(-1, 0, new Buffer(JSON.stringify(data))).nodeify(callback);
};

PostgresStore.prototype.getInfo = function(callback) {
    var self = this;
    return this.queryTileAsync({info: true}).then(function (row) {
        if (row) {
            return JSON.parse(row.tile.toString());
        } else {
            return {
                "bounds": "-180,-85.0511,180,85.0511",
                "center": "0,0,2",
                "description": "",
                "maxzoom": self.maxzoom,
                "minzoom": self.minzoom,
                "name": "postgres",
                "template": "",
                "version": "1.0.0"
            };
        }
    }).catch(this.attachUri).nodeify(callback);
};

PostgresStore.prototype.putTile = function(z, x, y, tile, callback) {
    if (z < this.minzoom || z > this.maxzoom) {
        throw new Err('This PostgresStore source cannot save zoom %d, because its configured for zooms %d..%d',
            z, this.minzoom, this.maxzoom);
    }
    return this._storeDataAsync(z, core.xyToIndex(x, y, z), tile).nodeify(callback);
};

PostgresStore.prototype._storeDataAsync = function(zoom, idx, data) {
    var self = this;
    return BBPromise.try(function () {
        var query, params;
        if (data && data.length > 0) {
            query = self.queries.set;
            params = [zoom, idx, data];
        } else {
            query = self.queries.delete;
            params = [zoom, idx];
        }
        if (!self.batchMode || !self.maxBatchSize) {
            return self.client.none(query, params);
        } else {
            self.batch.push({query: query, params: params});
            if (Object.keys(self.batch).length > self.maxBatchSize) {
                return self.flushAsync();
            }
        }
    }).catch(this.attachUri);
};

PostgresStore.prototype.startWriting = function(callback) {
    this.batchMode++;
    callback(null);
};

PostgresStore.prototype.flush = function(callback) {
    var batch = this.batch;
    if (Object.keys(batch).length > 0) {
        this.batch = [];
        this.client
            .batchAsync(batch)
            .catch(this.attachUri)
            .nodeify(callback);
    } else {
        callback();
    }
};

PostgresStore.prototype.stopWriting = function(callback) {
    var self = this;
    BBPromise.try(function () {
        if (self.batchMode === 0) {
            self.throwError('stopWriting() called more times than startWriting()')
        }
        self.batchMode--;
        return self.flushAsync();
    })
        .catch(this.attachUri)
        .nodeify(callback);
};

PostgresStore.prototype.queryTileAsync = function(options) {
    var self = this;
    var getTile, getSize;

    return BBPromise.try(function() {
        if (options.info) {
            options.zoom = -1;
            options.idx = 0;
        } else {
            if (!core.isInteger(options.zoom))
                self.throwError('Options must contain integer zoom parameter. Opts=%j', options);
            if (!core.isInteger(options.idx))
                self.throwError('Options must contain an integer idx parameter. Opts=%j', options);
            var maxEnd = Math.pow(4, options.zoom);
            if (options.idx < 0 || options.idx >= maxEnd)
                self.throwError('Options must satisfy: 0 <= idx < %d. Opts=%j', maxEnd, options);
        }
        if (options.getWriteTime)
            self.throwError('getWriteTime is not implemented by Postgres source. Opts=%j', options);
        getTile = typeof options.getTile === 'undefined' ? true : options.getTile;
        getSize = typeof options.getSize === 'undefined' ? false : options.getSize;
        var query = getTile ? self.queries.getTile : self.queries.getSize;
        return self.client.oneOrNone(query, [options.zoom, options.idx]);
    }).then(function(row) {
        if (row) {
            var resp = {};
            if (getTile) resp.tile = row.tile;
            if (getSize) resp.size = getTile ? row.tile.length : row.len;
            return resp;
        } else {
            return false;
        }
    }).catch(this.attachUri);
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
PostgresStore.prototype.query = function(options) {
    var self = this,
        dateBefore, dateFrom;

    if (!core.isInteger(options.zoom))
        self.throwError('Options must contain integer zoom parameter. Opts=%j', options);
    if (typeof options.idxFrom !== 'undefined' && !core.isInteger(options.idxFrom))
        self.throwError('Options may contain an integer idxFrom parameter. Opts=%j', options);
    if (typeof options.idxBefore !== 'undefined' && !core.isInteger(options.idxBefore))
        self.throwError('Options may contain an integer idxBefore parameter. Opts=%j', options);
    if (typeof options.dateBefore !== 'undefined' && Object.prototype.toString.call(options.dateBefore) !== '[object Date]')
        self.throwError('Options may contain a Date dateBefore parameter. Opts=%j', options);
    if (typeof options.dateFrom !== 'undefined' && Object.prototype.toString.call(options.dateFrom) !== '[object Date]')
        self.throwError('Options may contain a Date dateFrom parameter. Opts=%j', options);
    if (typeof options.biggerThan !== 'undefined' && typeof options.biggerThan !== 'number')
        self.throwError('Options may contain a biggerThan numeric parameter. Opts=%j', options);
    if ((typeof options.smallerThan !== 'undefined' && typeof options.smallerThan !== 'number') || options.smallerThan <= 0)
        self.throwError('Options may contain a smallerThan numeric parameter that is bigger than 0. Opts=%j', options);
    var maxEnd = Math.pow(4, options.zoom);
    var start = options.idxFrom || 0;
    var end = options.idxBefore || maxEnd;
    if (start > end || end > maxEnd)
        self.throwError('Options must satisfy: idxFrom <= idxBefore <= %d. Opts=%j', maxEnd, options);
    if (options.dateFrom >= options.dateBefore)
        self.throwError('Options must satisfy: dateFrom < dateBefore. Opts=%j', options);
    dateFrom = options.dateFrom ? options.dateFrom.valueOf() * 1000 : false;
    dateBefore = options.dateBefore ? options.dateBefore.valueOf() * 1000 : false;

    var fields = 'idx';
    if (options.getTiles || options.smallerThan || options.biggerThan) {
        // If tile size check is requested, we have to get the whole tile at this point...
        // TODO: in the next Postgres, UDFs should help with this
        // Optimization - if biggerThan is 0, it will not be used
        fields += ', tile';
    }
    if (dateBefore !== false || dateFrom !== false) {
        fields += ', WRITETIME(tile) AS wt';
    }

    var createStream = function(blockStart, blockEnd) {
        var conds = 'zoom = ?',
            params = [options.zoom];
        if (start > blockStart) {
            conds += ' AND idx >= ?';
            params.push(start);
        }
        // options.zoom===0 is a temp workaround because the info data used to be stored in the zoom=0,idx=1
        if (end < blockEnd || options.zoom === 0) {
            conds += ' AND idx < ?';
            params.push(end);
        }
        var query = 'SELECT ' + fields + ' FROM ' + self.table + ' WHERE ' + conds;
        return self.client.stream(query, params, {prepare: true, autoPage: true});
    };

    var ms = createStream(0, maxEnd);

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
            idx: (typeof value.idx === 'number' ? value.idx : value.idx.toNumber())
        };
        if (options.getTiles) {
            res.tile = value.tile;
            res.headers = self.headers;
        }
        return res;
    });
};


PostgresStore.initKartotherian = function(cor) {
    core = cor;
    Err = core.Err;
    core.tilelive.protocols['postgres:'] = PostgresStore;
};

BBPromise.promisifyAll(PostgresStore.prototype);
module.exports = PostgresStore;
