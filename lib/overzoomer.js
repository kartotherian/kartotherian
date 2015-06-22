'use strict';

/*

OverZoomer is a storage wrapper. Given a tile source, it will retrieve requested tile from it,
or if missing, will zoom out until it finds a tile, and extract needed portion of it.
 */

var promisify = require('./promisify');
var BBPromise = require('bluebird');
var util = require('./util');
var mapnik = require('mapnik');

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
        return self.source.getTile(bz, bx, by, function (err, data, headers) {
            if (bz > 0 && err && err.message === 'Tile does not exist') {
                // Tile is missing, zoom out and repeat
                getSubTile(bz - 1, Math.floor(bx / 2), Math.floor(by / 2));
            } else if (err || bz === z || !data || data.length === 0) {
                // either this is exactly what we were asked for initially, or an error
                callback(err, data, headers);
            } else {
                util.uncompressAsync(data)
                    .then(function(data) {
                        //map.resize(256, 256);
                        //map.extent = sm.bbox(+x,+y,+z, false, '900913');
                        //// also pass buffer_size in options to be forward compatible with recent node-mapnik
                        //// https://github.com/mapnik/node-mapnik/issues/175
                        //opts.buffer_size = map.bufferSize;
                        //
                        var vtile = new mapnik.VectorTile(z, x, y);
                        vtile.setData(data);
                        vtile.parse();
                        callback(undefined, vtile, headers);
                    }).catch(callback);
            }
        });
    }
};

OverZoomer.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};
