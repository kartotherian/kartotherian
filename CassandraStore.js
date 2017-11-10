'use strict';

/*

 CassandraStore is a Cassandra tile storage source for Kartotherian
 */

const util = require('util');
const Promise = require('bluebird');
const cassandra = require('cassandra-driver');
const multistream = require('multistream');
const promistreamus = require('promistreamus');
const qidx = require('quadtile-index');
const checkType = require('@kartotherian/input-validator');
const Err = require('@kartotherian/err');
const pckg = require('./package.json');

const prepared = {prepare: true};

Promise.promisifyAll(cassandra.Client.prototype);

function CassandraStore(uri, callback) {
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

    this.getHeaders = () => ({
       'Content-Type': 'application/x-protobuf',
       'Content-Encoding': 'gzip'
    });

    return Promise.try(() => {
        let params = checkType.normalizeUrl(uri).query;
        self._params = params;

        if (!params.cp) {
            self.throwError("Uri must include at least one 'cp' connect point query parameter");
        } else if (typeof params.cp === 'string') {
            self.contactPoints = [params.cp];
        } else {
            self.contactPoints = params.cp;
        }
        if (!params.keyspace || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.keyspace)) {
            self.throwError("Uri must have a valid 'keyspace' query parameter");
        }
        if (params.table && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.table)) {
            self.throwError("Optional uri 'table' param must be a valid value");
        }
        if (params.repclass && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.repclass)) {
            self.throwError("Uri 'repclass' must be a valid value");
        }
        self.keyspace = params.keyspace;
        self.createIfMissing = !!params.createIfMissing;
        self.table = params.table || 'tiles';
        self.repclass = params.repclass || 'SimpleStrategy';
        self.repfactor = typeof params.repfactor === 'undefined' ? 3 : parseInt(params.repfactor);
        let dw = params.durablewrite;
        self.durablewrite = (typeof dw === 'undefined' || (dw && dw !== 'false' && dw !== '0')) ? 'true' : 'false';
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : parseInt(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 22 : parseInt(params.maxzoom);
        self.blocksize = typeof params.blocksize === 'undefined' ? 32768 : parseInt(params.blocksize);
        self.maxBatchSize = typeof params.maxBatchSize === 'undefined' ? undefined : parseInt(params.maxBatchSize);
        self.setLastModified = !!params.setLastModified;

        let clientOpts = {contactPoints: self.contactPoints};
        if (params.username || params.password) {
            clientOpts.authProvider = new cassandra.auth.PlainTextAuthProvider(params.username, params.password);
            // make sure not to expose it in the error reporting
            delete params.password;
        }
        self.client = new cassandra.Client(clientOpts);
        return self.client.connectAsync();
    }).then(() => {
        if (!self.createIfMissing) {
            return true;
        }
        return self.client.executeAsync(
            "CREATE KEYSPACE IF NOT EXISTS " + self.keyspace +
            " WITH REPLICATION = {'class': '" + self.repclass + "'," +
            " 'replication_factor': " + self.repfactor + "}" +
            " AND DURABLE_WRITES = " + self.durablewrite);
    }).then(
        () => self.client.executeAsync("USE " + self.keyspace)
    ).then(() => {
        if (!self.createIfMissing) {
            return true;
        }
        let createTableSql = "CREATE TABLE IF NOT EXISTS " + self.table + " (" +
            " zoom int," +
            (self.blocksize ? " block int," : "") +
            " idx bigint," +
            " tile blob," +
            (self.blocksize
                ? " PRIMARY KEY ((zoom, block), idx)"
                : " PRIMARY KEY (zoom, idx)") +
            ")";
        return self.client.executeAsync(createTableSql);
    }).catch(
        err => self.closeAsync().finally(() => { throw err; })
    ).then(() => {
        let whereClause = ' WHERE zoom = ? AND idx = ?';
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
    }).catch(this.attachUri).nodeify(callback);
}

CassandraStore.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return Promise.try(() => {
        if (z < self.minzoom || z > self.maxzoom) Err.throwNoTile();
        let queryOptions = {
            zoom: z,
            idx: qidx.xyToIndex(x, y, z),
            getWriteTime: self.setLastModified
        };
        return self.queryTileAsync(queryOptions);
    }).then(row => {
        if (!row) Err.throwNoTile();
        let headers = self.getHeaders();
        if (self.setLastModified && row.writeTime){
            headers['Last-Modified'] = row.writeTime.toUTCString();
        }
        return [row.tile, headers];
    }).nodeify(callback, {spread: true});
};

CassandraStore.prototype.putInfo = function(data, callback) {
    // hack: Store source info under zoom -1 with ID 0
    return this._storeDataAsync(-1, 0, new Buffer(JSON.stringify(data))).nodeify(callback);
};

CassandraStore.prototype.getInfo = function(callback) {
    let self = this;
    return this.queryTileAsync({info: true}).then(row => {
        if (row) {
            return JSON.parse(row.tile.toString());
        } else {
            return {
                'tilejson': '2.1.0',
                'name': 'CassandraStore ' + pckg.version,
                'bounds': '-180,-85.0511,180,85.0511',
                'minzoom': self.minzoom,
                'maxzoom': self.maxzoom
            };
        }
    }).catch(this.attachUri).nodeify(callback);
};

CassandraStore.prototype.putTile = function(z, x, y, tile, callback) {
    if (z < this.minzoom || z > this.maxzoom) {
        throw new Err('This CassandraStore source cannot save zoom %d, because its configured for zooms %d..%d',
            z, this.minzoom, this.maxzoom);
    }
    return this._storeDataAsync(z, qidx.xyToIndex(x, y, z), tile).nodeify(callback);
};

CassandraStore.prototype._storeDataAsync = function(zoom, idx, data) {
    let self = this;
    return Promise.try(() => {
        let query, params;
        if (data && data.length > 0) {
            query = self.queries.set;
            params = [data, zoom, idx];
        } else {
            query = self.queries.delete;
            params = [zoom, idx];
        }
        if (self.blocksize)
            params.push(Math.floor(idx / self.blocksize));
        if (!self.batchMode || !self.maxBatchSize) {
            return self.client.executeAsync(query, params, prepared);
        } else {
            self.batch.push({query: query, params: params});
            if (Object.keys(self.batch).length > self.maxBatchSize) {
                return self.flushAsync();
            }
        }
    }).catch(this.attachUri);
};

CassandraStore.prototype.close = function(callback) {
    let cl = this.client;
    if (!cl) {
        callback(null);
    } else {
        let self = this;
       Promise.try(
           () => (self.batchMode && self.maxBatchSize) ? self.flushAsync() : true
       ).then(() => {
            delete self.client;
            self.batchMode = 0;
            return cl.shutdownAsync();
        }).catch(this.attachUri).nodeify(callback);
    }
};

CassandraStore.prototype.startWriting = function(callback) {
    this.batchMode++;
    callback(null);
};

CassandraStore.prototype.flush = function(callback) {
    let batch = this.batch;
    if (Object.keys(batch).length > 0) {
        this.batch = [];
        this.client
            .batchAsync(batch, prepared)
            .catch(this.attachUri)
            .nodeify(callback);
    } else {
        callback();
    }
};

CassandraStore.prototype.stopWriting = function(callback) {
    let self = this;
    Promise.try(() => {
        if (self.batchMode === 0) {
            self.throwError('stopWriting() called more times than startWriting()')
        }
        self.batchMode--;
        return self.flushAsync();
    })
        .catch(this.attachUri)
        .nodeify(callback);
};

/**
 * Get tile data and metada. This function is a more capable getTile()
 * @param {object} options
 * @param {number} options.idx Index of the tile
 * @param {number} options.zoom
 * @param {boolean} options.getSize
 * @param {boolean} options.getTile
 * @param {boolean} options.getWriteTime
 * @param {boolean} options.info
 * @returns {*}
 */
CassandraStore.prototype.queryTileAsync = function(options) {
    let self = this, getTile, getWriteTime, getSize;

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
        getTile = typeof options.getTile === 'undefined' ? true : options.getTile;
        getWriteTime = typeof options.getWriteTime === 'undefined' ? false : options.getWriteTime;
        getSize = typeof options.getSize === 'undefined' ? false : options.getSize;
        let query;
        if (getWriteTime && (getTile || getSize))
            query = self.queries.getTileAndWt;
        else if (getTile || getSize)
            query = self.queries.getTile;
        else if (getWriteTime)
            query = self.queries.getWriteTime;
        else
            self.throwError('Either getTile or getWriteTime or both must be requested. Opts=%j', options);
        let params = [options.zoom, options.idx];
        if (self.blocksize)
            params.push(Math.floor(options.idx / self.blocksize));
        return self.client.executeAsync(query, params, prepared);
    }).then(res => {
        if ('rows' in res && res.rows.length === 1) {
            let row = res.rows[0],
                resp = {};
            if (getTile) resp.tile = row.tile;
            if (getSize) resp.size = row.tile.length; // TODO: Use UDF in the next Cassandra ver
            if (getWriteTime) resp.writeTime = new Date(row.wt / 1000);
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
 * in the stream. The promised values will contain:
 *  {number} zoom
 *  {number} idx
 *  {Buffer} tile if options.getTiles is set, get tile data
 *  {object} headers if options.getTiles is set, get tile header
 */
CassandraStore.prototype.query = function(options) {
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

    let fields = 'idx';
    if (options.getTiles || options.smallerThan || options.biggerThan) {
        // If tile size check is requested, we have to get the whole tile at this point...
        // TODO: in the next Cassandra, UDFs should help with this
        // Optimization - if biggerThan is 0, it will not be used
        fields += ', tile';
    }
    if (dateBefore !== false || dateFrom !== false) {
        fields += ', WRITETIME(tile) AS wt';
    }

    let createStream = (blockStart, blockEnd) => {
        let conds = 'zoom = ?',
            params = [options.zoom];
        if (self.blocksize) {
            conds += ' AND block = ?';
            params.push(Math.floor(blockStart / self.blocksize));
        }
        if (start > blockStart) {
            conds += ' AND idx >= ?';
            params.push(start);
        }
        // options.zoom===0 is a temp workaround because the info data used to be stored in the zoom=0,idx=1
        if (end < blockEnd || options.zoom === 0) {
            conds += ' AND idx < ?';
            params.push(end);
        }
        let query = 'SELECT ' + fields + ' FROM ' + self.table + ' WHERE ' + conds;
        return self.client.stream(query, params, {prepare: true, autoPage: true});
    };

    let ms;
    if (self.blocksize) {
        let blockIdx = Math.floor(start / self.blocksize),
            toBlockIdx = Math.floor((end - 1) / self.blocksize);

        ms = multistream.obj(cb => {
            if (blockIdx > toBlockIdx) {
                cb();
            } else {
                try {
                    let bi = blockIdx++;
                    cb(null, createStream(bi * self.blocksize, Math.min(maxEnd, (bi + 1) * self.blocksize)));
                } catch (err) {
                    cb(err);
                }
            }
        });
    } else {
        ms = createStream(0, maxEnd);
    }

    return promistreamus(ms, value => {
        if ((dateBefore !== false && value.wt >= dateBefore) ||
            (dateFrom !== false && value.wt < dateFrom) ||
            (options.smallerThan && value.tile.length >= options.smallerThan) ||
            (options.biggerThan && value.tile.length < options.biggerThan)
        ) {
            return undefined;
        }
        let res = {
            zoom: options.zoom,
            idx: (typeof value.idx === 'number' ? value.idx : value.idx.toNumber())
        };
        if (options.getTiles) {
            res.tile = value.tile;
            res.headers = self.getHeaders();
        }
        return res;
    });
};


CassandraStore.registerProtocols = tilelive => {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

Promise.promisifyAll(CassandraStore.prototype);
module.exports = CassandraStore;
