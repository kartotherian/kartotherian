var tilelive = require('@mapbox/tilelive');
var crypto = require('crypto');
var mapnik = require('@kartotherian/mapnik');
var sm = new (require('@mapbox/sphericalmercator'))();
var uptile = require('tilelive-promise');

module.exports = Backend;

function Backend(opts, callback) {
    this._layer = opts.layer || undefined;
    this._scale = opts.scale || 1;
    this._source = null;
    var backend = this;
    if (opts.source) {
        setsource(opts.source, opts);
    } else if (opts.uri) {
        tilelive.load(opts.uri, function(err, source) {
            if (err) return callback(err);
            source.getInfo(function(err, info) {
                if (err) return callback(err);
                setsource(source, info);
            });
        });
    } else {
        if (callback) callback(new Error('opts.uri or opts.source must be set'));
    }

    function setsource(source, info) {
        backend._minzoom = typeof info.minzoom === 'number' ? info.minzoom : 0;
        backend._maxzoom = typeof info.maxzoom === 'number' ? info.maxzoom : 22;
        backend._vector_layers = info.vector_layers || undefined;
        backend._layer = backend._layer ||
            (info.vector_layers && info.vector_layers.length && info.vector_layers[0].id) ||
            '_image';
        backend._fillzoom = 'fillzoom' in info && !isNaN(parseInt(info.fillzoom, 10)) ?
            parseInt(info.fillzoom, 10) :
            undefined;
        backend._source = uptile(source);
        if (callback) callback(null, backend);
    }
};

Backend.prototype.getAsync = function(opts) {
    let self = this;
    return new Promise((accept, reject) => {
        try {
            if (!self._source) {
                throw new Error('Tilesource not loaded');
            }
            let result;
            switch (opts.type) {
                case undefined:
                case 'tile':
                    result = _getTileAsync.call(self, opts);
                    break;
                default:
                    result = self._source.getAsync(opts);
                    break;
            }
            accept(result);
        } catch (err) {
            reject(err);
        }
    });
};

Backend.prototype.getInfo = function(callback) {
    this.getAsync({type: 'info'}).then(res => {
        callback(undefined, res.data);
    }, err => {
        callback(err);
    });
};

// handle additional parameters attached to callback
Backend.prototype.getTile = function(z, x, y, callback) {
    this.getAsync({
        z: z,
        x: x,
        y: y,
        legacy: callback.legacy,
        scale: callback.scale,
        upgrade: callback.upgrade,
        setSrcData: callback.setSrcData,
        treatAsVector: callback.treatAsVector
    }).then(res => {
        callback(undefined, res.data, res.headers);
    }, err => {
        callback(err);
    });
};

function _getTileAsync(opts) {
    var backend = this;

    return new Promise((accept, reject) => {
    var z = opts.z, x = opts.x, y = opts.y;
    if (z < 0 || x < 0 || y < 0 || x >= Math.pow(2,z) || y >= Math.pow(2,z)) {
        return reject(new Error('Tile does not exist'));
    }
    var source = backend._source;
    var now = +new Date;
    var legacy = opts.legacy || false;
    var scale = opts.scale || backend._scale;
    var upgrade = opts.upgrade || false;

    // If scale > 1 adjusts source data zoom level inversely.
    // scale 2x => z-1, scale 4x => z-2, scale 8x => z-3, etc.
    if (legacy && z >= backend._minzoom) {
        var d = Math.round(Math.log(scale)/Math.log(2));
        opts.z = (z - d) > backend._minzoom ? z - d : backend._minzoom;
        opts.x = Math.floor(x / Math.pow(2, z - opts.z));
        opts.y = Math.floor(y / Math.pow(2, z - opts.z));
    } else {
        opts.z = z | 0;
        opts.x = x | 0;
        opts.y = y | 0;
    }

    var size = 0;
    var headers = {};

    // Overzooming support.
    if (opts.z > backend._maxzoom) {
        opts.z = backend._maxzoom;
        opts.x = Math.floor(x / Math.pow(2, z - opts.z));
        opts.y = Math.floor(y / Math.pow(2, z - opts.z));
        headers['x-vector-backend-object'] = 'overzoom';
    }

    source.getAsync(opts).catch(function onGetTileError(err) {
        if (typeof backend._fillzoom === 'number' &&
            err && err.message === 'Tile does not exist' &&
            opts.z > backend._fillzoom) {
            opts.z = backend._fillzoom;
            opts.x = Math.floor(x / Math.pow(2, z - opts.z));
            opts.y = Math.floor(y / Math.pow(2, z - opts.z));
            headers['x-vector-backend-object'] = 'fillzoom';
            return source.getAsync(opts).catch(onGetTileError);
        }
        if (err.message !== 'Tile does not exist') throw err;
        return {};
    }).then(result => {
        var body = result.data;
        var head = result.headers;

        if (body instanceof mapnik.VectorTile) {
            size = body._srcbytes;
            headers = head || {};
            return makevtile(body);
        }

        var compression = false;
        if (body) {
            if (body[0] == 0x78 && body[1] == 0x9C) {
                compression = 'inflate';
            } else if (body[0] == 0x1F && body[1] == 0x8B) {
                compression = 'gunzip';
            } else if (opts.treatAsVector) {
                compression = true;
            }
        }

        if (!body || !body.length) {
            headers['x-vector-backend-object'] = 'empty';
            return makevtile();
        } else if (compression) {
            size = body.length;
            headers = head || {};
            return makevtile(body, 'pbf');
        // Image sources do not allow overzooming (yet).
        } else if (opts.z < z && headers['x-vector-backend-object'] !== 'fillzoom') {
            headers['x-vector-backend-object'] = 'empty';
            return makevtile();
        } else {
            size = body.length;
            headers = head || {};
            return makevtile(body);
        }
    });

    function makevtile(data, type) {
        // If no last modified is provided, use epoch.
        headers['Last-Modified'] = new Date(headers['Last-Modified'] || 0).toUTCString();

        // Set an ETag if not present.
        headers['ETag'] = headers['ETag'] || JSON.stringify(crypto.createHash('md5')
            .update((z+','+x+','+y) + (data||''))
            .digest('hex'));

        // Set content type.
        headers['Content-Type'] = 'application/x-protobuf';

        // Set x-vector-backend-status header.
        headers['x-vector-backend-object'] = headers['x-vector-backend-object'] || 'default';

        // Pass-thru of an upstream mapnik vector tile (not pbf) source.
        if (data instanceof mapnik.VectorTile) return accept({data: data, headers: headers});

        var vtile = new mapnik.VectorTile(opts.z, opts.x, opts.y);
        vtile._srcbytes = size;
        if (opts.setSrcData) vtile._srcdata = data;

        // null/zero length data is a solid tile be painted.
        if (!data || !data.length) return accept({data: vtile, headers: headers});

        try {
            if (type === 'pbf') {
                // We use addData here over setData because we know it was just created
                // and is empty so skips a clear call internally in mapnik.
                vtile.addData(data,{upgrade:upgrade},function(err) {
                    if (err) return reject(err);
                    return accept({data: vtile, headers: headers});
                });
            } else {
                vtile.addImageBuffer(data, backend._layer, function(err) {
                    if (err) return reject(err);
                    return accept({data: vtile, headers: headers});
                });
            }
        } catch (err) {
            return reject(err);
        }
    };
})};

// Proxies mapnik vtile.query method with the added convienice of
// letting the tilelive-vector backend do the hard work of finding
// the right tile to use.
Backend.prototype.queryTile = function(z, lon, lat, options, callback) {
    var xyz = sm.xyz([lon, lat, lon, lat], z);
    this.getTile(z, xyz.minX, xyz.minY, function(err, vtile, head) {
        if (err) return callback(err);
        vtile.query(lon, lat, options, function(err, features) {
            if (err) return callback(err);
            var results = [];
            for (var i = 0; i < features.length; i++) {
                results.push({
                    id: features[i].id(),
                    distance: features[i].distance,
                    layer: features[i].layer,
                    attributes: features[i].attributes(),
                    geometry: {
                        type: 'Point',
                        coordinates: features[i].x_hit ?
                            [ features[i].x_hit, features[i].y_hit ] :
                            [ lon, lat ]
                    }
                });
            }
            var headers = {};
            headers['Content-Type'] = 'application/json';
            headers['ETag'] = JSON.stringify(crypto.createHash('md5')
                .update(head && head['ETag'] || (z+','+lon+','+lat))
                .digest('hex'));
            headers['Last-Modified'] = new Date(head && head['Last-Modified'] || 0).toUTCString();
            return callback(null, results, headers);
        });
    });
};

