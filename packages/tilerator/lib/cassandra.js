'use strict';

/*

CassandraStore is a Cassandra tile storage.
 */

var promisify = require('./promisify');
var BBPromise = require('bluebird');
var util = require('./util');
var cassandra = require('cassandra-driver');
BBPromise.promisifyAll(cassandra.Client.prototype);

module.exports = CassandraStore;

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

function CassandraStore(uri, callback) {
    var self = this;
    return BBPromise.try(function () {
        var params = util.normalizeUri(uri).query;
        if (!params.cp) {
            throw Error("Uri must include at least one 'cp' connect point query parameter: " + uri)
        } else if (typeof params.cp === 'string') {
            self.contactPoints = [params.cp];
        } else {
            self.contactPoints = params.cp;
        }
        if (!params.keyspace || !/^[a-zA-Z0-9]+$/.test(params.keyspace)) {
            throw Error("Uri must have a valid 'keyspace' query parameter: " + uri)
        }
        if (params.repclass && !/^[a-zA-Z0-9]+$/.test(params.repclass)) {
            throw Error("Uri 'repclass' must be a valid value: " + uri)
        }
        self.keyspace = params.keyspace;
        self.repclass = params.repclass || 'SimpleStrategy';
        self.repfactor = typeof params.repfactor === 'undefined' ? 3 : parseInt(params.repfactor);
        var dw = params.durablewrite;
        self.durablewrite = (typeof dw === 'undefined' || (dw && dw !== 'false' && dw !== '0')) ? 'true' : 'false';
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : intParse(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 15 : intParse(params.maxzoom);
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
        {prepare: true}
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
    if (tile && tile.length > 0) {
        return this.client.executeAsync(
            "UPDATE tiles SET tile = ? WHERE zoom = ? AND idx = ?",
            [tile, z, util.xyToIndex(x, y)],
            {prepare: true}
        ).nodeify(callback);
    } else {
        return this.client.executeAsync(
            "DELETE FROM tiles WHERE zoom = ? AND idx = ?",
            [z, util.xyToIndex(x, y)],
            {prepare: true}
        ).nodeify(callback);
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

BBPromise.promisifyAll(Cassandra.prototype);
