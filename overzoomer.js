'use strict';

/*
 OverZoomer is a storage wrapper. Given a tile source, it will retrieve requested tile from it,
 or if missing, will zoom out until it finds a tile, and extract needed portion of it.
 */

const Promise = require('bluebird');
const zlib = Promise.promisifyAll(require('zlib'));
const Err = require('@kartotherian/err');
const checkType = require('@kartotherian/input-validator');
const uptile = require('tilelive-promise');

let core;


function OverZoomer(uri, callback) {
    let self = this;
    return Promise.try(() => {
        self = uptile(self);
        let params = checkType.normalizeUrl(uri).query;
        if (!params.source) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        self.minzoom = typeof params.minzoom === 'undefined' ? 0 : parseInt(params.minzoom);
        self.maxzoom = typeof params.maxzoom === 'undefined' ? 22 : parseInt(params.maxzoom);
        return core.loadSource(params.source);
    }).then(source => {
        self.source = uptile(source);
        return self;
    }).nodeify(callback);
}

OverZoomer.prototype.getAsync = Promise.method(function(opts) {

    if (opts.type !== undefined && opts.type !== 'tile') {
        return self.source.getAsync(opts);
    }

    const self = this;
    const opts2 = Object.assign({}, opts);

    return getSubTile().then(
        res => {
            if (opts2.z === opts.z || !res.tile || res.tile.length === 0) {
                // this is exactly what we were asked for initially
                return res;
            }

            // Extract portion of the higher zoom tile as a new tile
            let resultP;
            if (!res.headers) {
                res.headers = {};
            }
            const contentEnc = res.headers['Content-Encoding'];
            if (contentEnc && contentEnc === 'gzip') {
                // Re-compression should be done by the final layer
                delete res.headers['Content-Encoding'];
                resultP = zlib.gunzipAsync(res.tile);
            } else {
                resultP = Promise.resolve(res.tile);
            }

            return resultP.then(
                pbf => core.extractSubTileAsync(v, opts.z, opts.x, opts.y, opts2.z, opts2.x, opts2.y)
            ).then(pbf => {
                res.tile = pbf;
                res.headers.OverzoomFrom = opts2.z;
                return res;
            });

        });

    function getSubTile() {
        if (opts2.z < self.minzoom || opts2.z > self.maxzoom) {
            core.throwNoTile();
        }

        return Promise.try(() => {
            return self.source.getTileAsync(opts2.z, opts2.x, opts2.y);
        }).catch(err => {
            if (opts2.z > self.minzoom && core.isNoTileError(err)) {
                // Tile is missing, zoom out and repeat
                opts2.z = opts2.z - 1;
                opts2.x = Math.floor(opts2.x / 2);
                opts2.y = Math.floor(opts2.y / 2);
                return getSubTile();
            } else {
                throw err;
            }
        });
    }
});

OverZoomer.prototype.getInfo = function getInfo(callback) {
    return this.source.getInfo(callback);
};


OverZoomer.initKartotherian = function initKartotherian(cor) {
    core = cor;
    core.tilelive.protocols['overzoom:'] = OverZoomer;
};

module.exports = OverZoomer;
