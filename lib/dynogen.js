'use strict';

/*

DynoGen is a dynamic storage and generation tile provider.
On getTile(), it will attempt to retrieve the tile from the storage,
and if missing, will generate it using the tile generator.
Both store and generator must be provided as query parameters,
either as URI strings, or as parsed uri objects.
The generated tiles will be saved to the store, unless their zoom
is less than or equal to the "saveafter" URI parameter.
 */

var util = require('./util');
var BBPromise = require('bluebird');

module.exports = DynoGen;

DynoGen.registerProtocols = function(tilelive) {
    DynoGen._tilelive = tilelive;
    tilelive.protocols['autogen:'] = DynoGen;
};

DynoGen.resolveUri = function(uri, uriAccessor) {
    if (uri.query.hasOwnProperty('generator')) {
        uri.query.generator = uriAccessor(uri.query.generator);
    }
    if (uri.query.hasOwnProperty('store')) {
        uri.query.store = uriAccessor(uri.query.store);
    }
    return uri;
};

function DynoGen(uri, callback) {
    var self = this;
    return new BBPromise(
        function (fulfill, reject) {
            uri = util.normalizeUri(uri);
            if (!uri.query.store || !uri.query.generator) {
                throw Error("Uri must include 'store' and 'generator' query parameters: " + uri)
            }
            self.saveafter = uri.query.saveafter ? parseInt(uri.query.saveafter) : 15;
            self.minzoom = uri.query.minzoom ? parseInt(uri.query.minzoom) : 0;
            self.maxzoom = uri.query.maxzoom ? parseInt(uri.query.maxzoom) : 16;
            DynoGen._tilelive.load(uri.query.store, function (err, handler) {
                if (err) reject(err); else fulfill(handler);
            });
        }).then(function (handler) {
            return new BBPromise(function (fulfill, reject) {
                self.store = handler;
                DynoGen._tilelive.load(uri.query.generator, function (err, handler) {
                    if (err) reject(err); else fulfill(handler);
                });
            });
        }).then(function (handler) {
            self.generator = handler;
            callback(undefined, self);
        }).catch(function (err) {
            callback(err);
        });
}

DynoGen.prototype.getTile = function(z, x, y, callback) {
    if (z > this.maxzoom || z < this.minzoom) {
        return callback(new Error('Bad zoom'));
    }
    var self = this;
    return self.store.getTile(z, x, y, function(err, data, headers) {
        if (err && err.message === 'Tile does not exist') {
            self.generator.getTile(z, x, y, function(err, data, headers) {
                if (!err && z > self.saveafter) {
                    self.store.putTile(z, x, y, data, function (err) {
                        return err ? callback(err) : callback(err, data, headers);
                    });
                } else {
                    callback(err, data, headers);
                }
            });
        } else {
            callback(err, data, headers);
        }
    });
};

DynoGen.prototype.getInfo = function(callback) {
    return this.store.getInfo(callback);
};
