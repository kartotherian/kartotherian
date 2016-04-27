'use strict';

/*

OverZoomer is a storage wrapper. Given a tile source, it will retrieve requested tile from it,
or if missing, will zoom out until it finds a tile, and extract needed portion of it.
 */

var Promise = require('bluebird');
var zlib = require('zlib');
var core, Err;


function OverZoomer(uri, callback) {
    var self = this;
    return Promise.try(function () {
        var params = core.normalizeUri(uri).query;
        if (!params.source) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : parseInt(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 22 : parseInt(params.maxzoom);
        return core.loadSource(params.source);
    }).then(function (handler) {
        self.source = handler;
        return self;
    }).nodeify(callback);
}

OverZoomer.prototype.getTile = function(z, x, y, callback) {
    var self = this,
        bz = z,
        bx = x,
        by = y;

    return getSubTile().spread(function (pbfz, headers) {
        if (bz === z || !pbfz || pbfz.length === 0) {
            // this is exactly what we were asked for initially
            return [pbfz, headers];
        }
        // Extract portion of the higher zoom tile as a new tile
        headers.OverzoomFrom = bz;
        return core.uncompressAsync(pbfz).then(function (pbf) {
            return core.extractSubTileAsync(pbf, z, x, y, bz, bx, by);
        }).then(function (pbf) {
            return core.compressPbfAsync2(pbf, headers);
        });
    }).nodeify(callback, {spread: true});

    function getSubTile() {
        return Promise.try(function () {
            if (bz < self.minzoom || bz > self.maxzoom) {
                core.throwNoTile();
            }
            return self.source.getTileAsync(bz, bx, by);
        }).catch(function (err) {
            if (bz > self.minzoom && core.isNoTileError(err)) {
                // Tile is missing, zoom out and repeat
                bz = bz - 1;
                bx = Math.floor(bx / 2);
                by = Math.floor(by / 2);
                return getSubTile();
            } else {
                throw err;
            }
        });
    }
};

OverZoomer.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};


OverZoomer.initKartotherian = function(cor) {
    core = cor;
    Err = core.Err;
    core.tilelive.protocols['overzoom:'] = OverZoomer;
};

module.exports = OverZoomer;
