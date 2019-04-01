'use strict';

/*

Substantial is a tile generator wrapper. Given a tile source, it will retrieve requested tile from it,
and check if the tile has enough useful information in it to save it, rather than skip it and
let kartotherian use overzooming later.
 */

let Promise = require('bluebird'),
    zlib = require('zlib'),
    qidx = require('quadtile-index'),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator'),
    _ = require('underscore'),
    core;


function Substantial(uri, callback) {
    let self = this;
    return Promise.try(() => {
        let params = checkType.normalizeUrl(uri).query;
        if (!params.source) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        checkType(params, 'minzoom', 'integer', 0, 0, 22);
        checkType(params, 'maxzoom', 'integer', 22, params.minzoom + 1, 22);
        checkType(params, 'maxsize', 'integer', undefined, 0);
        checkType(params, 'layers', 'string-array', true, 1);
        checkType(params, 'debug', 'boolean', false);
        self.params = params;
        return core.loadSource(params.source);
    }).then(handler => {
        self.source = handler;
        if (handler.query) {
            self.query = query;
        }
        if (self.params.debug) {
            // in debug mode, return a predefined tile instead
            return self.source.getTileAsync(9, 156, 190).then(dh => {
                self.params.debug = dh;
            });
        }
    }).return(self).nodeify(callback);
}

Substantial.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return self.source.getTileAsync(z, x, y).then(dh => {
        if (z < self.params.minzoom || z > self.params.maxzoom) {
            return dh;
        }
        let p = self._testTile(z, x, y, dh[0]).return(dh);
        if (self.params.debug) {
            // For debug mode, return predefined tile when no tile error would be thrown otherwise
            p = p.catch(err => {
                if (Err.isNoTileError(err)) {
                    return self.params.debug;
                } else {
                    throw err;
                }
            });
        }
        return p;
    }).nodeify(callback, {spread: true});
};

Substantial.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};

/**
 * Checks if data satisfies filtering requirements, and succeeds if it should be passed,
 * or errors out with the missing tile error
 * @returns {Promise}
 * @private
 */
Substantial.prototype._testTile = function _testTile(zoom, x, y, data) {
    // this must be set to the source
    let self = this;
    if (!data) {
        Err.throwNoTile();
    }
    if (data.length >= self.params.maxsize) {
        return Promise.resolve(undefined); // generated tile is too big, save
    }
    let vt = new core.mapnik.VectorTile(zoom, x, y);
    return core.uncompressAsync(data).then(uncompressed => vt.setDataAsync(uncompressed)).then(() => {
        if (vt.empty()) {
            Err.throwNoTile();
        } else {
            let layers = vt.names();
            if (layers.length === 0 ||
                (layers.length === 1 && _.contains(self.params.layers, layers[0]))
            ) {
                // TODO: BUG?: should we use query() to check if there are any features?
                // either no layers, or only contains one whitelisted layer
                Err.throwNoTile();
            }
        }
    });
};

function query(options) {
    let self = this,
        applyFilter = options.zoom >= self.params.minzoom && options.zoom <= self.params.maxzoom,
        iterator = this.source.query(applyFilter ? _.extend(options, {getTiles: true}) : options),
        isDone = false;

    if (!applyFilter) {
        return iterator;
    }
    let getNextValAsync = () => {
        if (isDone) {
            return Promise.resolve(undefined);
        }
        return iterator().then(iterValue => {
            if (iterValue !== undefined) {
                let xy = qidx.indexToXY(iterValue.idx);
                return self._testTile(iterValue.zoom, xy[0], xy[1], iterValue.tile).return(iterValue);
            }
            isDone = true;
        }).catch(err => {
            if (Err.isNoTileError(err)) {
                return getNextValAsync();
            } else {
                throw err;
            }
        });
    };
    return getNextValAsync;
}


Substantial.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['substantial:'] = Substantial;
};

module.exports = Substantial;
