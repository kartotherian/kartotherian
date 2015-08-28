'use strict';

/*

OverZoomer is a storage wrapper. Given a tile source, it will retrieve requested tile from it,
or if missing, will zoom out until it finds a tile, and extract needed portion of it.
 */

var BBPromise = require('bluebird');
var core = require('kartotherian-core');
var zlib = require('zlib');
var Err = core.Err;


function OverZoomer(uri, callback) {
    var self = this;
    return BBPromise.try(function () {
        uri = core.normalizeUri(uri);
        if (!uri.query.source) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        return core.loadSource(uri.query.source, OverZoomer._tilelive);
    }).then(function (handler) {
        self.source = handler;
        return self;
    }).nodeify(callback);
}

OverZoomer.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    getSubTile(z, x, y);

    function getSubTile(bz, bx, by) {
        return self.source.getTile(bz, bx, by, function (err, pbfz, headers) {
            if (bz > 0 && err && core.isNoTileError(err)) {
                // Tile is missing, zoom out and repeat
                getSubTile(bz - 1, Math.floor(bx / 2), Math.floor(by / 2));
            } else if (err || bz === z || !pbfz || pbfz.length === 0) {
                // either this is exactly what we were asked for initially, or an error
                callback(err, pbfz, headers);
            } else {
                // Extract portion of the higher zoom tile as a new tile
                headers.OverzoomFrom = bz;
                core.uncompressAsync(pbfz)
                    .then(function (pbf) {
                        return core.extractSubTileAsync(pbf, z, x, y, bz, bx, by);
                    }).then(function (pbf) {
                        return core.compressPbfAsync2(pbf, headers);
                    }).nodeify(callback, {spread: true});
            }
        });
    }
};

OverZoomer.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};


OverZoomer.registerProtocols = function(tilelive) {
    OverZoomer._tilelive = tilelive;
    tilelive.protocols['overzoom:'] = OverZoomer;
};

module.exports = OverZoomer;
