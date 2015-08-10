'use strict';

var BBPromise = require('bluebird');
var core = require('kartotherian-core');
var zlib = require('zlib');
var Err = core.Err;


function LayerMixer(uri, callback) {
    var self = this;
    return BBPromise.try(function () {
        uri = core.normalizeUri(uri);
        var sources = uri.query.source;
        if (!sources || !Array.isArray(sources)) {
            throw new Err("Uri must include 'source' query parameter: %j", uri);
        }
        self.sources = [];
        return core.mapSequentialAsync(sources, function (src) {
            return LayerMixer._tilelive.loadAsync(src).then(function (handler) {
                self.sources.push(handler);
            })
        });
    }).return(this).nodeify(callback);
}

LayerMixer.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    var headers;
    BBPromise.all(_.map(self.sources, function (src) {
        return src
            .getTileAsync(z, x, y)
            .spread(function (pbfz, hdr) {
                if (src === self.sources[0]) {
                    headers = hdr;
                }
                return core.uncompressAsync(pbfz);
            }).then(function (pbf) {
                var vtile = new mapnik.VectorTile(z, x, y);
                vtile.setData(pbf);
                return vtile;
            });
    })).then(function (tiles) {
        var layers = _.forEach(tiles.slice(1), function (t) {
            return _.invert(t.names());
        });
        var vtile = new mapnik.VectorTile(z, x, y);
        _.each(tiles[0].names(), function (layer) {
            // if not found, it will return -1, which becomes 0 - the first tile
            var ind = 1 + _.findLastIndex(layers, function (l) {
                    return layer in l;
                });
            vtile.addGeoJSON(tiles.toGeoJSON(layer), layer);
            _.each(layers, function (l) {
                delete l[layer];
            });
        });
        _.each(layers.reverse(), function (layer) {
            var layer2 = _.invert(layer);
            _.each(_.keys(layer2).sort(), function (id) {
                var ll = layer2[id];
                vtile.addGeoJSON(tiles.toGeoJSON(ll), l);
                _.each(layers, function (l) {
                    delete l[ll];
                });
            })
        });
        return core.compressPbfAsync2(vtile.getData(), headers);
    }).nodeify(callback, {spread: true});
};

LayerMixer.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};


LayerMixer.registerProtocols = function(tilelive) {
    LayerMixer._tilelive = tilelive;
    tilelive.protocols['layermixer:'] = LayerMixer;
};

module.exports = LayerMixer;
