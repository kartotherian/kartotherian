'use strict';

/*

 PostgresStore is a Postgres tile storage.
 */

let util = require('util'),
    Promise = require('bluebird'),
    qidx = require('quadtile-index'),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator'),
    postgres = require('pg-promise')({promiseLib: Promise}),
    promistreamus = require('promistreamus'),
    QueryStream = require('pg-query-stream'),
    pckg = require('./package.json');

let core;

function PostgresStore(uri, callback) {
    let self = this;
    this.batchMode = 0;
    this.batch = [];

    this.throwError = msg => {
        throw new Error(util.format.apply(null, arguments) + JSON.stringify(uri));
    };

    this.attachUri = err => {
        err.moduleUri = JSON.stringify(self._params);
        throw err;
    };

    return Promise.try(() => {
        self.headers = {
            'Content-Type': 'application/x-protobuf',
            'Content-Encoding': 'gzip'
        };
        let params = checkType.normalizeUrl(uri).query;
        self._params = params;

        checkType(params, 'database', 'string', true);
        checkType(params, 'port', 'integer');
        checkType(params, 'table', 'string', 'tiles');
        checkType(params, 'createIfMissing', 'boolean');
        checkType(params, 'minzoom', 'zoom', 0);
        checkType(params, 'maxzoom', 'zoom', 14);
        checkType(params, 'maxBatchSize', 'integer');

        if (!params.database || !/^[a-zA-Z][_a-zA-Z0-9]*$/.test(params.database)) {
            self.throwError("Uri must have a valid 'database' query parameter");
        }
        if (params.table && !/^[a-zA-Z][_a-zA-Z0-9]*$/.test(params.table)) {
            self.throwError("Optional uri 'table' param must be a valid value");
        }

        let clientOpts = {
            host: params.host,
            port: params.port,
            database: params.database,
            user: params.username,
            password: params.password
        };
        // make sure not to expose it in the error reporting
        delete params.password;

        self.client = postgres(clientOpts);

        let sql;
        if (params.createIfMissing) {
            // Create table and ensure that tile is stored in an uncompressed form to prevent double compression
            // TODO: instead of "IF NOT EXISTS", use a session and a conditional table creation + column alteration
            // sql = 'CREATE TABLE IF NOT EXISTS $1~ (zoom smallint, idx bigint, tile bytea, PRIMARY KEY (zoom, idx));' +
            //     'ALTER TABLE $1~ ALTER COLUMN tile SET STORAGE EXTERNAL;';
            sql = '\
DO $$BEGIN \
  IF NOT EXISTS ( \
    SELECT 1 FROM information_schema.tables \
    WHERE table_catalog = $2 AND table_name = $1 \
  ) THEN \
    CREATE TABLE $1~ (zoom smallint, idx bigint, tile bytea, PRIMARY KEY (zoom, idx)); \
    ALTER TABLE $1~ ALTER COLUMN tile SET STORAGE EXTERNAL; \
  END IF; \
END$$;';
        } else {
            // Check the valid structure of the table - must not return any results
            sql = 'SELECT zoom, idx, tile FROM $1~ WHERE zoom IS NULL AND idx IS NULL;';
        }
        return self.client.none(sql, [self._params.table, self._params.database]);
    }).then(() => {
        let table = self._params.table;
        self.queries = {
            // We could have used $1~ syntax for table name parameter in getTile and getTileSize,
            // but that is not allowed for prepared statement queries
            getTile: 'SELECT tile FROM ' + table + ' WHERE zoom = $1 AND idx = $2;',
            getTileSize: 'SELECT length(tile) AS len FROM ' + table + ' WHERE zoom = $1 AND idx = $2;',
            set: 'UPDATE $1~ SET tile=$4 WHERE zoom = $2 AND idx = $3;' +
            'INSERT INTO $1~ (zoom, idx, tile) SELECT $2, $3, $4 ' +
            'WHERE NOT EXISTS (SELECT 1 FROM $1~ WHERE zoom = $2 AND idx = $3);',
            delete: 'DELETE FROM $1~ WHERE zoom = $2 AND idx = $3;'
        };

        return self;
    }).catch(this.attachUri).nodeify(callback);
}

PostgresStore.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return Promise.try(() => {
        if (z < self._params.minzoom || z > self._params.maxzoom) {
            core.throwNoTile();
        }
        return self.queryTileAsync({zoom: z, idx: qidx.xyToIndex(x, y, z)});
    }).then(row => {
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
    let self = this;
    return this.queryTileAsync({info: true}).then(row => {
        if (row) {
            return JSON.parse(row.tile.toString());
        } else {
            return {
                'tilejson': '2.1.0',
                'name': 'PostgresStore ' + pckg.version,
                'bounds': '-180,-85.0511,180,85.0511',
                'minzoom': self._params.minzoom,
                'maxzoom': self._params.maxzoom
            };
        }
    }).catch(this.attachUri).nodeify(callback);
};

PostgresStore.prototype.putTile = function(z, x, y, tile, callback) {
    if (z < this._params.minzoom || z > this._params.maxzoom) {
        this.throwError('This PostgresStore source cannot save zoom %d, because its configured for zooms %d..%d',
            z, this._params.minzoom, this._params.maxzoom);
    }
    return this._storeDataAsync(z, qidx.xyToIndex(x, y, z), tile).nodeify(callback);
};

PostgresStore.prototype._storeDataAsync = function(zoom, idx, data) {
    let self = this;
    return Promise.try(() => {
        let query, params;
        if (data && data.length > 0) {
            query = self.queries.set;
            params = [self._params.table, zoom, idx, data];
        } else {
            query = self.queries.delete;
            params = [self._params.table, zoom, idx];
        }
        if (!self.batchMode || !self._params.maxBatchSize) {
            return self.client.none(query, params);
        } else {
            self.batch.push({query: query, params: params});
            if (Object.keys(self.batch).length > self._params.maxBatchSize) {
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
    let self = this;
    Promise.try(()=> {
        let batch = self.batch;
        if (Object.keys(batch).length > 0) {
            self.batch = [];
            return self.client
                .batchAsync(batch)
                .catch(self.attachUri)
        }
    }).nodeify(callback);
};

PostgresStore.prototype.stopWriting = function(callback) {
    let self = this;
    Promise.try(() => {
        if (self.batchMode === 0) {
            self.throwError('stopWriting() called more times than startWriting()')
        }
        self.batchMode--;
        return self.flushAsync();
    }).catch(this.attachUri)
        .nodeify(callback);
};

PostgresStore.prototype.queryTileAsync = function(options) {
    let self = this;
    let getTile, getSize;

    return Promise.try(() => {
        if (options.info) {
            options.zoom = -1;
            options.idx = 0;
        } else {
            if (!Number.isInteger(options.zoom))
                self.throwError('Options must contain integer zoom parameter. Opts=%j', options);
            if (!Number.isInteger(options.idx))
                self.throwError('Options must contain an integer idx parameter. Opts=%j', options);
            let maxEnd = Math.pow(4, options.zoom);
            if (options.idx < 0 || options.idx >= maxEnd)
                self.throwError('Options must satisfy: 0 <= idx < %d. Opts=%j', maxEnd, options);
        }
        if (options.getWriteTime)
            self.throwError('getWriteTime is not implemented by Postgres source. Opts=%j', options);
        getTile = typeof options.getTile === 'undefined' ? true : options.getTile;
        getSize = typeof options.getSize === 'undefined' ? false : options.getSize;

        return self.client.oneOrNone({
            name: getTile ? 'getTile' : 'getTileSize',
            text: getTile ? self.queries.getTile : self.queries.getTileSize,
            values: [options.zoom, options.idx]
        });
    }).then(row => {
        if (row) {
            let resp = {};
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
    let self = this,
        dateBefore, dateFrom;

    if (!Number.isInteger(options.zoom))
        self.throwError('Options must contain integer zoom parameter. Opts=%j', options);
    if (typeof options.idxFrom !== 'undefined' && !Number.isInteger(options.idxFrom))
        self.throwError('Options may contain an integer idxFrom parameter. Opts=%j', options);
    if (typeof options.idxBefore !== 'undefined' && !Number.isInteger(options.idxBefore))
        self.throwError('Options may contain an integer idxBefore parameter. Opts=%j', options);
    if (typeof options.dateBefore !== 'undefined' && Object.prototype.toString.call(options.dateBefore) !== '[object Date]')
        self.throwError('Options may contain a Date dateBefore parameter. Opts=%j', options);
    if (typeof options.dateFrom !== 'undefined' && Object.prototype.toString.call(options.dateFrom) !== '[object Date]')
        self.throwError('Options may contain a Date dateFrom parameter. Opts=%j', options);
    if (typeof options.biggerThan !== 'undefined' && typeof options.biggerThan !== 'number')
        self.throwError('Options may contain a biggerThan numeric parameter. Opts=%j', options);
    if ((typeof options.smallerThan !== 'undefined' && typeof options.smallerThan !== 'number') || options.smallerThan <= 0)
        self.throwError('Options may contain a smallerThan numeric parameter that is bigger than 0. Opts=%j', options);

    let maxEnd = Math.pow(4, options.zoom),
        start = options.idxFrom || 0,
        end = options.idxBefore || maxEnd;
    if (start > end || end > maxEnd)
        self.throwError('Options must satisfy: idxFrom <= idxBefore <= %d. Opts=%j', maxEnd, options);
    if (options.dateFrom >= options.dateBefore)
        self.throwError('Options must satisfy: dateFrom < dateBefore. Opts=%j', options);

    dateFrom = options.dateFrom ? options.dateFrom.valueOf() * 1000 : false;
    dateBefore = options.dateBefore ? options.dateBefore.valueOf() * 1000 : false;

    let fields = 'idx',
        conds = 'zoom = $2', params = [self._params.table, options.zoom];

    if (options.getTiles) {
        fields += ', tile';
    }
    if (options.smallerThan) {
        params.push(options.smallerThan);
        conds += ' AND length(tile) < $' + params.length;
    }
    if (options.biggerThan) {
        params.push(options.biggerThan);
        conds += ' AND length(tile) >= $' + params.length;
    }
    if (start > 0) {
        params.push(start);
        conds += ' AND idx >= $' + params.length;
    }
    if (end < maxEnd) {
        params.push(end);
        conds += ' AND idx < $' + params.length;
    }
    if (dateBefore !== false || dateFrom !== false) {
        self.throwError('date filtering is not implemented for postgres store');
    }

    // delayed promistreamus initialization
    let iterator = promistreamus(undefined, value => {
        let res = {
            zoom: options.zoom,
            idx: parseInt(value.idx)
        };
        if (options.getTiles) {
            res.tile = value.tile;
            res.headers = self.headers;
        }
        return res;
    });

    let query = new QueryStream('SELECT ' + fields + ' FROM $1~ WHERE ' + conds, params);
    self.client.stream(query,
        stream => iterator.init(stream)
    ).then(
        v => console.log('done ' + JSON.stringify(v)),
        v => {
            console.log('err ' + JSON.stringify(v));
            self.err = v;
        }
    );

    return iterator;
};


PostgresStore.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['postgres:'] = PostgresStore;
};

Promise.promisifyAll(PostgresStore.prototype);
module.exports = PostgresStore;
