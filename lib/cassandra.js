'use strict';

/*

CassandraStore is a Cassandra tile storage.
 */

var promisify = require('./promisify');
var BBPromise = require('bluebird');
var util = require('./util');
var cassandra = require('cassandra-driver');
BBPromise.promisifyAll(cassandra.Client);

module.exports = CassandraStore;

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

function CassandraStore(uri, callback) {
    var self = this;
    return BBPromise.try(function () {
        uri = util.normalizeUri(uri);
        if (!uri.query.cp) {
            throw Error("Uri must include at least one 'cp' connect point query parameter: " + uri)
        } else if (typeof uri.query.cp === 'string') {
            uri.query.cp = [uri.query.cp];
        }
        if (!uri.query.keyspace) {
            throw Error("Uri must have 'keyspace' query parameter: " + uri)
        }
        uri.query.repclass = uri.query.repclass || 'SimpleStrategy';
        uri.query.repfactor = uri.query.repfactor || 3;
        if (typeof uri.query.durablewrite === 'undefined') {
            uri.query.durablewrite = true;
        } else {
            uri.query.durablewrite = uri.query.durablewrite ? true : false;
        }
        uri.query.minzoom = typeof uri.query.minzoom === 'undefined' ? 0 : intParse(uri.query.minzoom);
        uri.query.maxzoom = typeof uri.query.maxzoom === 'undefined' ? 15 : intParse(uri.query.maxzoom);
        self.uri = uri;
        self.client = new cassandra.Client({contactPoints: uri.query.cp});
        return self.client.connectAsync();
    }).then(function () {
        return self.client.executeAsync(
            "CREATE KEYSPACE IF NOT EXISTS ? " +
            "WITH REPLICATION = {'class': '?','replication_factor': ?} " +
            "AND DURABLE_WRITES = ?",
            [self.uri.query.keyspace, self.uri.query.repclass, self.uri.query.repfactor, uri.query.durablewrite]);
    }).then(function () {
        return self.client.executeAsync(
            "CREATE TABLE IF NOT EXISTS ?.tiles (" +
            " zoom int," +
            " idx int," +
            " tile blob," +
            " PRIMARY KEY (zoom, idx)" +
            ") WITH COMPACT STORAGE", [self.uri.query.keyspace]);
    }).catch(function (err) {
        return self.close().finally(function () {
            throw err;
        });
    }).nodeify(callback);
}

CassandraStore.registerProtocols = function(tilelive) {
    tilelive.protocols['cassandra:'] = CassandraStore;
};

CassandraStore.prototype.getTile = function(z, x, y, callback) {
    return this.client.executeAsync(
        "SELECT tile FROM ?.tiles WHERE zoom = ? AND idx = ?",
        [this.uri.query.keyspace, z, util.xyToIndex(x, y)],
        {prepare: true}
    ).nodeify(callback);
};

CassandraStore.prototype.getInfo = function(callback) {
    callback(null, {
        "bounds": "-180,-85.0511,180,85.0511",
        "center": "0,0,2",
        "description": "",
        "maxzoom": this.uri.query.maxzoom,
        "minzoom": this.uri.query.minzoom,
        "name": "cassandra",
        "template": "",
        "version": "1.0.0"
    });
};

CassandraStore.prototype.putTile = function(z, x, y, tile, callback) {
    return this.client.executeAsync(
        "UPDATE ?.tiles SET tile = ? WHERE zoom = ? AND idx = ?",
        [this.uri.query.keyspace, tile, z, util.xyToIndex(x, y)],
        {prepare: true}
    ).nodeify(callback);
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
