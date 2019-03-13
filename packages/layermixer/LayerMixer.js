'use strict';

let Promise = require('bluebird'),
    _ = require('underscore'),
    checkType = require('@kartotherian/input-validator'),
    core;


function LayerMixer(uri, callback) {
    let self = this;
    Promise.try(function () {
        let query = checkType.normalizeUrl(uri).query;
        checkType(query, 'sources', 'string-array', true, 1);
        // This is a list of layers that should be removed from the first tile
        // Ensures that when overriding a layer, it will be removed from the result if it is not present
        // in the updating sources (e.g. given 3 sources to merge, these layers must be present in the 2nd or 3rd)
        checkType(query, 'removeInFirst', 'string-array');
        self.removeInFirst = query.removeInFirst ? _.invert(query.removeInFirst) : false;

        self.sources = [];
        return Promise.each(
            Object.keys(query.sources),
            key => {
                let srcUri = query.sources[key],
                    src = {};
                return core.loadSource(srcUri).then(handler => {
                    src.handler = handler;
                    return handler.getInfoAsync();
                }).then(info => {
                    src.isRaster = info.format === 'webp';
                    self.sources.push(src);
                })
            });
    }).return(this).nodeify(callback);
}

LayerMixer.prototype.getTile = function(z, x, y, callback) {
    let self = this,
        headers;
    Promise.all(_.map(self.sources, function (src, srcIdx) {
        return src.handler
            .getTileAsync(z, x, y)
            .spread(function (data, hdr) {
                if (srcIdx === 0 || !headers) {
                    headers = hdr; // we prefer to get the headers from the first source, but will take anything
                }
                return src.isRaster ? data : core.uncompressAsync(data);
            }).then(function (data) {
                if (src.isRaster) {
                    return data;
                } else if (data.length === 0 ) {
                    return false;
                } else {
                    let vtile = new core.mapnik.VectorTile(z, x, y);
                    return vtile.setDataAsync(data).return(vtile);
                }
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
        let layers = {},
            maxLayerIdx = 0;
        _.each(tiles, function (tile, sourceIdx) {
            if (tile) {
                let layerNames = self.sources[sourceIdx].isRaster ? ['_image'] : tile.names();
                _.each(layerNames, function (layer, layerIdx) {
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
        let orderedLayers = _.sortBy(layers, function (layer) {
            return layer.order;
        });
        return Promise.map(orderedLayers, function (layer, name) {
            if (layer.sourceIdx !== 0 || !self.removeInFirst || !(name in self.removeInFirst)) {
                if (self.sources[layer.sourceIdx].isRaster) {
                    return tiles[layer.sourceIdx];
                } else {
                    return tiles[layer.sourceIdx].toGeoJSONAsync(layer.layerIdx);
                }
            } else {
                return false;
            }
        }).then(function (jsonLayers) {
            let vtile = new core.mapnik.VectorTile(z, x, y);
            _.each(jsonLayers, function (data, idx) {
                if (data !== false) {
                    if (typeof data === 'string') {
                        vtile.addGeoJSON(data, orderedLayers[idx].name);
                    } else {
                        // TODO: enable named/multiple image layers
                        vtile.addImage(data, '_image');
                    }
                }
            });
            return core.compressPbfAsync2(vtile.getData(), headers);
        });
    }).nodeify(callback, {spread: true});
};

LayerMixer.prototype.getInfo = function(callback) {
    return this.sources[0].handler.getInfo(callback);
};


LayerMixer.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['layermixer:'] = LayerMixer;
};

module.exports = LayerMixer;
