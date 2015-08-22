'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var zlib = require('zlib');
var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.VectorTile.prototype);
var core = require('kartotherian-core');
var Err = core.Err;


function LayerMixer(uri, callback) {
    var self = this;
    BBPromise.try(function () {
        uri = core.normalizeUri(uri);
        core.checkType(uri.query, 'sources', 'string-array', true, 1);
        // This is a list of layers that should be removed from the first tile
        // Ensures that when overriding a layer, it will be removed from the result if it is not present
        // in the updating sources (e.g. given 3 sources to merge, these layers must be present in the 2nd or 3rd)
        core.checkType(uri.query, 'removeInFirst', 'string-array');
        self.removeInFirst = uri.query.removeInFirst ? _.invert(uri.query.removeInFirst) : false;

        self.sources = [];
        return core.mapSequentialAsync(uri.query.sources, function (src) {
            return LayerMixer._tilelive.loadAsync(src).then(function (handler) {
                self.sources.push(handler);
            })
        })
    }).return(this).nodeify(callback);
}

LayerMixer.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    var headers;
    BBPromise.all(_.map(self.sources, function (src, srcIdx) {
        return src
            .getTileAsync(z, x, y)
            .spread(function (pbfz, hdr) {
                if (srcIdx === 0 || !headers) {
                    headers = hdr; // we prefer to get the headers from the first source, but will take anything
                }
                return core.uncompressAsync(pbfz);
            }).then(function (pbf) {
                var vtile = new mapnik.VectorTile(z, x, y);
                return vtile.setDataAsync(pbf).return(vtile);
            }).then(function (vtile) {
                return vtile.parseAsync().return(vtile);
            }).catch(function (err) {
                if (core.isNoTileError(err)) {
                    return null;
                }
                throw err;
            });
    })).then(function (tiles) {
        // create a dict with layer names as keys, and values having the sort order and the tile from which to take it
        if (_.all(tiles, function (tile) {
                return tile === null; // TODO: is there a func to check if all values are falsey?
            })) {
            core.throwNoTile();
        }
        var layers = {};
        var maxLayerIdx = 0;
        _.each(tiles, function (tile, sourceIdx) {
            if (tile) {
                _.each(tile.names(), function (layer, layerIdx) {
                    if (layer in layers) {
                        layers[layer].sourceIdx = sourceIdx;
                        layers[layer].layerIdx = layerIdx;
                    } else {
                        layers[layer] = {name: layer, layerIdx: layerIdx, order: maxLayerIdx++, sourceIdx: sourceIdx};
                    }
                })
            }
        });
        // Merge all the layers by exporting it to GeoJSON, and re-importing it into the new tile
        // TODO: Obviously innefficient, hope mapnik would allow direct layer export/import
        var orderedLayers = _.sortBy(layers, function (layer) {
            return layer.order;
        });
        return BBPromise.map(orderedLayers, function (layer, name) {
            if (layer.sourceIdx !== 0 || !self.removeInFirst || !(name in self.removeInFirst)) {
                return tiles[layer.sourceIdx].toGeoJSONAsync(layer.layerIdx);
            } else {
                return false;
            }
        }).then(function (jsonLayers) {
            var vtile = new mapnik.VectorTile(z, x, y);
            _.each(jsonLayers, function (json, idx) {
                vtile.addGeoJSON(json, orderedLayers[idx].name);
            });
            return core.compressPbfAsync2(vtile.getData(), headers);
        });
    }).nodeify(callback, {spread: true});
};

LayerMixer.prototype.getInfo = function(callback) {
    return this.sources[0].getInfo(callback);
};


LayerMixer.registerProtocols = function(tilelive) {
    LayerMixer._tilelive = tilelive;
    tilelive.protocols['layermixer:'] = LayerMixer;
};

module.exports = LayerMixer;
