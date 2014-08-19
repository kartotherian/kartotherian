var tilelive = require('tilelive');
var crypto = require('crypto');
var mapnik = require('mapnik');
var util = require('util');
var zlib = require('zlib');

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
        backend._minzoom = info.minzoom || 0;
        backend._maxzoom = info.maxzoom || 22;
        backend._vector_layers = info.vector_layers || undefined;
        backend._layer = backend._layer ||
            (info.vector_layers && info.vector_layers.length && info.vector_layers[0].id) ||
            '_image';
        // @TODO some sources filter out custom keys @ getInfo forcing us
        // to access info/data properties directly. Fix this.
        if ('maskLevel' in info && !isNaN(parseInt(info.maskLevel, 10))) {
            backend._maskLevel = parseInt(info.maskLevel, 10);
        } else if (source.data && 'maskLevel' in source.data) {
            backend._maskLevel = source.data.maskLevel;
        }
        backend._source = source;
        if (callback) callback(null, backend);
    }
};

Backend.prototype.getInfo = function(callback) {
    if (!this._source) return callback(new Error('Tilesource not loaded'));
    this._source.getInfo(callback);
};

// Wrapper around backend.getTile that implements a "locking" cache.
Backend.prototype.getTile = function(z, x, y, callback) {
    if (!this._source) return callback(new Error('Tilesource not loaded'));

    var backend = this;
    var source = backend._source;
    var now = +new Date;
    var legacy = callback.legacy || false;
    var scale = callback.scale || backend._scale;

    // If scale > 1 adjusts source data zoom level inversely.
    // scale 2x => z-1, scale 4x => z-2, scale 8x => z-3, etc.
    if (legacy) {
        var d = Math.round(Math.log(scale)/Math.log(2));
        var bz = (z - d) > backend._minzoom ? z - d : backend._minzoom;
        var bx = Math.floor(x / Math.pow(2, z - bz));
        var by = Math.floor(y / Math.pow(2, z - bz));
    } else {
        var bz = z | 0;
        var bx = x | 0;
        var by = y | 0;
    }

    // Overzooming support.
    if (bz > backend._maxzoom) {
        bz = backend._maxzoom;
        bx = Math.floor(x / Math.pow(2, z - bz));
        by = Math.floor(y / Math.pow(2, z - bz));
    }

    var size = 0;
    var headers = {};

    source.getTile(bz, bx, by, function sourceGet(err, body, head) {
        if (typeof backend._maskLevel === 'number' &&
            err && err.message === 'Tile does not exist' &&
            bz > backend._maskLevel) {
            bz = backend._maskLevel;
            bx = Math.floor(x / Math.pow(2, z - bz));
            by = Math.floor(y / Math.pow(2, z - bz));
            return source.getTile(bz, bx, by, sourceGet);
        }
        if (err && err.message !== 'Tile does not exist') return callback(err);

        if (body instanceof mapnik.VectorTile) {
            size = body._srcbytes;
            headers = head || {};
            return makevtile(null, body);
        }

        var compression = false;
        if (body && body[0] == 0x78 && body[1] == 0x9C) {
            compression = 'inflate';
        } else if (body && body[0] == 0x1F && body[1] == 0x8B) {
            compression = 'gunzip';
        }

        if (!body || !body.length) {
            return makevtile();
        } else if (compression) {
            size = body.length;
            headers = head || {};
            return zlib[compression](body, function(err, data) {
                if (err) return callback(err);
                return makevtile(null, data, 'pbf');
            });
        // Image sources do not allow overzooming (yet).
        } else if (bz < z) {
            return makevtile();
        } else {
            size = body.length;
            headers = head || {};
            return makevtile(null, body);
        }
    });

    function makevtile(err, data, type) {
        if (err && err.message !== 'Tile does not exist') return callback(err);

        // If no last modified is provided, use epoch.
        headers['Last-Modified'] = new Date(headers['Last-Modified'] || 0).toUTCString();

        // Set an ETag if not present.
        headers['ETag'] = headers['ETag'] || JSON.stringify(crypto.createHash('md5')
            .update((z+','+x+','+y) + (data||''))
            .digest('hex'));

        // Set content type.
        headers['Content-Type'] = 'application/x-protobuf';

        // Pass-thru of an upstream mapnik vector tile (not pbf) source.
        if (data instanceof mapnik.VectorTile) return callback(null, data, headers);

        var vtile = new mapnik.VectorTile(bz, bx, by);
        vtile._srcbytes = size;

        // null/zero length data is a solid tile be painted.
        if (!data || !data.length) return callback(null, vtile, headers);

        try {
            if (type === 'pbf') {
                vtile.setData(data);
            } else {
                vtile.addImage(data, backend._layer);
            }
        } catch (err) {
            return callback(err);
        }
        vtile.parse(function(err) {
            if (err) return callback(err);
            callback(null, vtile, headers);
        })
    };
};

