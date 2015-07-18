'use strict';

/*

OverZoomer is a storage wrapper. Given a tile source, it will retrieve requested tile from it,
or if missing, will zoom out until it finds a tile, and extract needed portion of it.
 */

var promisify = require('./promisify');
var BBPromise = require('bluebird');
var util = require('./util');
var zlib = require('zlib');

module.exports = OverZoomer;

OverZoomer.registerProtocols = function(tilelive) {
    OverZoomer._tilelive = tilelive;
    tilelive.protocols['overzoom:'] = OverZoomer;
};

OverZoomer.resolveUri = function(uri, uriAccessor) {
    if (uri.query.hasOwnProperty('source')) {
        uri.query.source = uriAccessor(uri.query.source);
    }
    return uri;
};

function OverZoomer(uri, callback) {
    var self = this;
    return BBPromise.try(function () {
        uri = util.normalizeUri(uri);
        if (!uri.query.source) {
            throw Error("Uri must include 'source' query parameter: " + uri)
        }
        return OverZoomer._tilelive.loadAsync(uri.query.source);
    }).then(function (handler) {
        self.source = handler;
        callback(undefined, self);
    }).catch(function (err) {
        callback(err);
    });
}

OverZoomer.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    getSubTile(z, x, y);

    function getSubTile(bz, bx, by) {
        return self.source.getTile(bz, bx, by, function (err, pbfz, headers) {
            if (bz > 0 && err && err.message === 'Tile does not exist') {
                // Tile is missing, zoom out and repeat
                getSubTile(bz - 1, Math.floor(bx / 2), Math.floor(by / 2));
            } else if (err || bz === z || !pbfz || pbfz.length === 0) {
                // either this is exactly what we were asked for initially, or an error
                callback(err, pbfz, headers);
            } else {
                // Extract portion of the higher zoom tile as a new tile
                headers.OverzoomFrom = bz;
                util.uncompressAsync(pbfz)
                    .then(function (pbf) {
                        return util.extractSubTileAsync(pbf, z, x, y, bz, bx, by);
                    }).then(function (pbf) {
                        return util.compressPbfAsync2(pbf, headers);
                    }).nodeify(callback, {spread: true});
            }
        });
    }
};

OverZoomer.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};

BBPromise.promisifyAll(OverZoomer.prototype);
