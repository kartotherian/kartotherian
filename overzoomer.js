'use strict';

/*
 OverZoomer is a storage wrapper. Given a tile source, it will retrieve requested tile from it,
 or if missing, will zoom out until it finds a tile, and extract needed portion of it.
 */

let Promise = require('bluebird'),
    zlib = require('zlib'),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator'),
    core;


function OverZoomer(uri, callback) {
    let self = this;
    return Promise.try(() => {
        let params = checkType.normalizeUrl(uri).query;
        if (!params.source) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : parseInt(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 22 : parseInt(params.maxzoom);
        return core.loadSource(params.source);
    }).then(handler => {
        self.source = handler;
        return self;
    }).nodeify(callback);
}

OverZoomer.prototype.getTile = function getTile(z, x, y, callback) {
    let self = this,
        bz = z,
        bx = x,
        by = y;

    return getSubTile().spread((pbfz, headers) => {
        if (bz === z || !pbfz || pbfz.length === 0) {
            // this is exactly what we were asked for initially
            return [pbfz, headers];
        }
        // Extract portion of the higher zoom tile as a new tile
        headers.OverzoomFrom = bz;
        return core.uncompressAsync(pbfz).then(
            pbf => core.extractSubTileAsync(pbf, z, x, y, bz, bx, by)
        ).then(
            pbf => core.compressPbfAsync2(pbf, headers)
        );
    }).nodeify(callback, {spread: true});

    function getSubTile() {
        return Promise.try(() => {
            if (bz < self.minzoom || bz > self.maxzoom) {
                core.throwNoTile();
            }
            return self.source.getTileAsync(bz, bx, by);
        }).catch(err => {
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

OverZoomer.prototype.getInfo = function getInfo(callback) {
    return this.source.getInfo(callback);
};


OverZoomer.initKartotherian = function initKartotherian(cor) {
    core = cor;
    core.tilelive.protocols['overzoom:'] = OverZoomer;
};

module.exports = OverZoomer;
