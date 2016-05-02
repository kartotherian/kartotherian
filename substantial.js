'use strict';

/*

Substantial is a tile generator wrapper. Given a tile source, it will retrieve requested tile from it,
and check if the tile has enough useful information in it to save it, rather than skip it and
let kartotherian use overzooming later.
 */

var Promise = require('bluebird');
var zlib = require('zlib');
var _ = require('underscore');
var core, Err;


function Substantial(uri, callback) {
    var self = this;
    return Promise.try(function () {
        var params = core.normalizeUri(uri).query;
        if (!params.source) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        core.checkType(params, 'minzoom', 'integer', 0, 0, 22);
        core.checkType(params, 'maxzoom', 'integer', 22, params.minzoom + 1, 22);
        core.checkType(params, 'minsize', 'integer', 0, 0);
        core.checkType(params, 'layers', 'string-array', true, 1);
        core.checkType(params, 'minsize', 'integer', 0, 0);
        core.checkType(params, 'debug', 'boolean', false);
        self.params = params;
        return core.loadSource(params.source);
    }).then(function (handler) {
        self.source = handler;
        if (handler.query) {
            self.query = query;
        }
        if (self.params.debug) {
            // in debug mode, return a predefined tile instead
            return self.source.getTileAsync(9, 156, 190).then(function(dh){
                self.params.debug = dh;
            });
        }
    }).return(self).nodeify(callback);
}

Substantial.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    return self.source.getTileAsync(z, x, y).then(function (dh) {
        if (z < self.params.minzoom || z > self.params.maxzoom) {
            return dh;
        }
        var p = self._testTile(z, x, y, dh[0]).return(dh);
        if (self.params.debug) {
            // For debug mode, return predefined tile when no tile error would be thrown otherwise
            p = p.catch(function (err) {
                if (core.isNoTileError(err)) {
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
    var self = this;
    if (!data) {
        core.throwNoTile();
    }
    if (data.length >= self.params.maxsize) {
        return; // generated tile is too big, save
    }
    var vt = new core.mapnik.VectorTile(zoom, x, y);
    return core.uncompressAsync(data).then(function (uncompressed) {
        return vt.setDataAsync(uncompressed);
    }).then(function () {
        if (vt.empty()) {
            core.throwNoTile();
        } else {
            var layers = vt.names();
            if (layers.length === 0 ||
                (layers.length === 1 && _.contains(self.params.layers, layers[0]))
            ) {
                // TODO: BUG?: should we use query() to check if there are any features?
                // either no layers, or only contains one whitelisted layer
                core.throwNoTile();
            }
        }
    });
};

function query(options) {
    var self = this,
        applyFilter = options.zoom >= self.params.minzoom && options.zoom <= self.params.maxzoom,
        iterator = this.source.query(applyFilter ? _.extend(options, {getTiles: true}) : options),
        isDone = false;

    if (!applyFilter) {
        return iterator;
    }
    var getNextValAsync = function () {
        if (isDone) {
            return Promise.resolve(undefined);
        }
        return iterator().then(function (iterValue) {
            if (iterValue !== undefined) {
                var xy = core.indexToXY(iterValue.idx);
                return self._testTile(iterValue.zoom, xy[0], xy[1], iterValue.tile).return(iterValue);
            }
            isDone = true;
        }).catch(function(err) {
            if (core.isNoTileError(err)) {
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
    Err = core.Err;
    core.tilelive.protocols['substantial:'] = Substantial;
};

module.exports = Substantial;
