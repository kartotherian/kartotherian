var tilelive = require('tilelive');
var mapnik = require('mapnik');
var fs = require('fs');
var tar = require('tar');
var url = require('url');
var zlib = require('zlib');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var request = require('request');
var exists = fs.exists || require('path').exists;
var numeral = require('numeral');
var sm = new (require('sphericalmercator'))();
var Backend = require('./backend');

module.exports = Vector;
module.exports.tm2z = tm2z;
module.exports.mapnik = mapnik;
module.exports.Backend = Backend;

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
};

function Vector(uri, callback) {
    if (!uri.xml) return callback && callback(new Error('No xml'));

    this._uri = uri;
    this._scale = uri.scale || undefined;
    this._format = uri.format || undefined;
    this._source = uri.source || undefined;
    this._maxAge = typeof uri.maxAge === 'number' ? uri.maxAge : 60e3;
    this._deflate = typeof uri.deflate === 'boolean' ? uri.deflate : true;
    this._reap = typeof uri.reap === 'number' ? uri.reap : 60e3;
    this._base = path.resolve(uri.base || __dirname);

    if (callback) this.once('open', callback);

    var s = this;
    this.update(uri, function(err) { s.emit('open', err, s); });
};
util.inherits(Vector, require('events').EventEmitter);

Vector.registerProtocols = function(tilelive) {
    tilelive.protocols['vector:'] = Vector;
    tilelive.protocols['tm2z:'] = tm2z;
    tilelive.protocols['tm2z+http:'] = tm2z;
};

// Helper for callers to ensure source is open. This is not built directly
// into the constructor because there is no good auto cache-keying system
// for these tile sources (ie. sharing/caching is best left to the caller).
Vector.prototype.open = function(callback) {
    if (this._map) return callback(null, this);
    this.once('open', callback);
};

// Allows in-place update of XML/backends.
Vector.prototype.update = function(opts, callback) {
    // If the XML has changed update the map.
    if (!opts.xml || this._xml === opts.xml) return callback();

    var s = this;
    var map = new mapnik.Map(256,256);
    map.fromString(opts.xml, {
        strict: true,
        base: this._base + '/'
    }, function(err) {
        if (err) {
            err.code = 'EMAPNIK';
            return callback(err);
        }

        delete s._info;
        s._xml = opts.xml;
        s._map = map;
        s._md5 = crypto.createHash('md5').update(opts.xml).digest('hex');
        s._format = opts.format || map.parameters.format || s._format || 'png8:m=h';
        s._scale = opts.scale || +map.parameters.scale || s._scale || 1;

        var source = map.parameters.source || opts.source;
        if (!s._backend || s._source !== source) {
            if (!source) return callback(new Error('No backend'));
            new Backend({
                uri: source,
                scale: s._scale,
                reap: s._uri.reap,
                maxAge: s._uri.maxAge,
                deflate: s._uri.deflate
            }, function(err, backend) {
                if (err) return callback(err);
                s._source = map.parameters.source || opts.source;
                s._backend = backend;
                return callback();
            });
        } else {
            return callback();
        }
    });
    return;
};

Vector.prototype.getTile = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    // Hack around tilelive API - allow params to be passed per request
    // as attributes of the callback function.
    var format = callback.format || this._format;
    var scale = callback.scale || this._scale;

    var source = this;
    var drawtime;
    var loadtime = +new Date;
    var cb = function(err, vtile, head) {
        if (err && err.message !== 'Tile does not exist')
            return callback(err);

        // if (err && source._maskLevel && bz > source._maskLevel)
        //     return callback(format === 'utf' ? new Error('Grid does not exist') : err);

        var headers = {};
        switch (format.match(/^[a-z]+/i)[0]) {
        case 'headers':
            // No content type for header-only.
            break;
        case 'json':
        case 'utf':
            headers['Content-Type'] = 'application/json';
            break;
        case 'jpeg':
            headers['Content-Type'] = 'image/jpeg';
            break;
        case 'svg':
            headers['Content-Type'] = 'image/svg+xml';
            break;
        case 'png':
        default:
            headers['Content-Type'] = 'image/png';
            break;
        }
        headers['ETag'] = JSON.stringify(crypto.createHash('md5')
            .update(scale + source._md5 + (head && head['ETag'] || (z+','+x+','+y)))
            .digest('hex'));
        headers['Last-Modified'] = new Date(head && head['Last-Modified'] || 0).toUTCString();

        // Return headers for 'headers' format.
        if (format === 'headers') return callback(null, headers, headers);

        loadtime = (+new Date) - loadtime;
        drawtime = +new Date;
        var opts = {z:z, x:x, y:y, scale:scale, buffer_size:256 * scale};
        if (format === 'json') {
            try { return callback(null, vtile.toJSON(), headers); }
            catch(err) { return callback(err); }
        } else if (format === 'utf') {
            var surface = new mapnik.Grid(256,256);
            opts.layer = source._map.parameters.interactivity_layer;
            opts.fields = source._map.parameters.interactivity_fields.split(',');
        } else if (format === 'svg') {
            var surface = new mapnik.CairoSurface('svg',256,256);
        } else {
            var surface = new mapnik.Image(256,256);
        }
        vtile.render(source._map, surface, opts, function(err, image) {
            if (err) return callback(err);
            if (format == 'svg') {
                headers['Content-Type'] = 'image/svg+xml';
                return callback(null, image.getData(), headers);
            } else if (format === 'utf') {
                image.encode(format, {}, function(err, buffer) {
                    if (err) return callback(err);
                    return callback(null, buffer, headers);
                });
            } else {
                image.encode(format, {}, function(err, buffer) {
                    if (err) return callback(err);
                    buffer._loadtime = loadtime;
                    buffer._drawtime = (+new Date) - drawtime;
                    buffer._srcbytes = vtile._srcbytes || 0;
                    return callback(null, buffer, headers);
                });
            }
        });
    };
    cb.format = format;
    cb.scale = scale;
    source._backend.getTile(z, x, y, cb);
};

Vector.prototype.getGrid = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));
    if (!this._map.parameters.interactivity_layer) return callback(new Error('Tilesource has no interactivity_layer'));
    if (!this._map.parameters.interactivity_fields) return callback(new Error('Tilesource has no interactivity_fields'));
    callback.format = 'utf';
    return this.getTile(z, x, y, callback);
};

Vector.prototype.getHeaders = function(z, x, y, callback) {
    callback.format = 'headers';
    return this.getTile(z, x, y, callback);
};

Vector.prototype.getInfo = function(callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));
    if (this._info) return callback(null, this._info);

    var params = this._map.parameters;
    this._info = Object.keys(params).reduce(function(memo, key) {
        switch (key) {
        // The special "json" key/value pair allows JSON to be serialized
        // and merged into the metadata of a mapnik XML based source. This
        // enables nested properties and non-string datatypes to be
        // captured by mapnik XML.
        case 'json':
            try { var jsondata = JSON.parse(params[key]); }
            catch (err) { return callback(err); }
            Object.keys(jsondata).reduce(function(memo, key) {
                memo[key] = memo[key] || jsondata[key];
                return memo;
            }, memo);
            break;
        case 'bounds':
        case 'center':
            memo[key] = params[key].split(',').map(function(v) { return parseFloat(v) });
            break;
        case 'minzoom':
        case 'maxzoom':
            memo[key] = parseInt(params[key], 10);
            break;
        default:
            memo[key] = params[key];
            break;
        }
        return memo;
    }, {});
    return callback(null, this._info);
};

Vector.prototype.profile = function(callback) {
    var s = this;
    var map = new mapnik.Map(256,256);
    var xmltime = Date.now();
    var densest = [];

    map.fromString(this._xml, {
        strict: true,
        base: this._base + '/'
    }, function(err) {
        if (err) {
            err.code = 'EMAPNIK';
            return callback(err);
        }

        xmltime = Date.now() - xmltime;

        s.getInfo(function(err, info) {
            if (err) return callback(err);

            s._backend.getInfo(function(err, backend_info) {
                if (err) return callback(err);

                var center = (info.center || backend_info.center).slice(0);
                var minzoom = info.minzoom || backend_info.minzoom || 0;
                var maxzoom = info.maxzoom || backend_info.maxzoom || 22;

                // wrapx lon value.
                center[0] = ((((center[0]+180)%360)+360)%360) - 180;

                var xyz = sm.xyz([center[0], center[1], center[0], center[1]], minzoom);

                getTiles(minzoom, xyz.minX, xyz.minY);

                // Profile derivative four tiles of z,x,y
                function getTiles(z, x, y) {
                    var tiles = [];
                    var queue = [
                        {z:z, x:x+0, y:y+0},
                        {z:z, x:x+0, y:y+1},
                        {z:z, x:x+1, y:y+0},
                        {z:z, x:x+1, y:y+1}
                    ];
                    getTile();
                    function getTile() {
                        if (queue.length) {
                            var t = queue.shift();
                            s.getTile(t.z, t.x, t.y, function(err, run1, headers) {
                                if (err) return callback(err);
                                s.getTile(t.z, t.x, t.y, function(err, run2, headers) {
                                    if (err) return callback(err);
                                    t.drawtime = Math.min(run1._drawtime, run2._drawtime);
                                    t.loadtime = run1._loadtime;
                                    t.srcbytes = run1._srcbytes;
                                    t.imgbytes = run1.length;
                                    t.buffer = run1;
                                    tiles.push(t);
                                    getTile();
                                });
                            });
                        } else {
                            tiles.sort(function (a, b) {
                                if (a.imgbytes < b.imgbytes) return 1;
                                if (a.imgbytes > b.imgbytes) return -1;
                                return 0;
                            });
                            densest.push(tiles[0]);

                            // Done.
                            if (z >= maxzoom) return callback(null, {
                                tiles: densest,
                                xmltime: xmltime,
                                drawtime: densest.reduce(stat('drawtime', densest.length), {}),
                                loadtime: densest.reduce(stat('loadtime', densest.length), {}),
                                srcbytes: densest.reduce(stat('srcbytes', densest.length), {}),
                                imgbytes: densest.reduce(stat('imgbytes', densest.length), {}),
                            });

                            function stat(key, count) { return function(memo, t) {
                                memo.avg = (memo.avg || 0) + t[key]/count;
                                memo.min = Math.min(memo.min||Infinity, t[key]);
                                memo.max = Math.max(memo.max||0, t[key]);
                                return memo;
                            }}

                            // profiling zxy @ zoom level < center.
                            // next zxy should remain on center coords.
                            if (z < center[2]) {
                                var xyz = sm.xyz([center[0], center[1], center[0], center[1]], z+1);
                                getTiles(z+1, xyz.minX, xyz.minY);
                            // profiling zxy @ zoomlevel >= center.
                            // next zxy descend based on densest tile.
                            } else {
                                getTiles(z+1, tiles[0].x * 2, tiles[0].y * 2);
                            }
                        }
                    }
                }
            });
        });
    });
};

function tm2z(uri, callback) {
    var maxsize = {
        file: uri.filesize || 750 * 1024,
        gunzip: uri.gunzipsize || 5 * 1024 * 1024,
        xml: uri.xmlsize || 750 * 1024
    };

    var id = url.format(uri);

    // Cache hit.
    if (tm2z.sources[id]) {
        tm2z.sources[id].access = +new Date;
        return tm2z.sources[id].open(callback);
    }

    var xml;
    var base = '/tmp/' + md5(id).substr(0,8) + '-' + path.basename(id);
    var parser = tar.Parse();
    var gunzip = zlib.Gunzip();
    var unpacked = false;

    var once = 0;
    var error = function(err) { if (!once++) callback(err); };

    // Check for unpacked manifest
    exists(base + '/.unpacked', function(exists) {
        unpacked = exists;
        if (unpacked) {
            unpack();
        } else {
            fs.mkdir(base, function(err) {
                if (err && err.code !== 'EEXIST') return callback(err);
                unpack();
            });
        }
    });

    function unpack() {
        var stream;
        var size = {
            file: 0,
            gunzip: 0,
            xml: 0
        };
        var todo = [];

        function chunked(chunk) {
            size.file += chunk.length;
            if (size.file > maxsize.file) {
                var err = new RangeError('Upload size should not exceed ' + numeral(maxsize.file).format('0b') + '.');
                stream.emit('error', err);
            }
        }

        gunzip.on('data', function(chunk) {
            size.gunzip += chunk.length;
            if (size.gunzip > maxsize.gunzip) {
                var err = new RangeError('Unzipped size should not exceed ' + numeral(maxsize.gunzip).format('0b') + '.');
                gunzip.emit('error', err);
            }
        });
        parser.on('entry', function(entry) {
            var parts = [];
            var filepath = entry.props.path.split('/').slice(1).join('/');
            entry.on('data', function(chunk) {
                if (path.basename(filepath).toLowerCase() == 'project.xml') {
                    size.xml += chunk.length;
                    if (size.xml > maxsize.xml) {
                        var err = new RangeError('Unzipped project.xml size should not exceed ' + numeral(maxsize.xml).format('0b') + '.');
                        parser.emit('error', err);
                    }
                }
                parts.push(chunk);
            });
            entry.on('end', function() {
                var buffer = Buffer.concat(parts);
                if (path.basename(filepath).toLowerCase() == 'project.xml') {
                    xml = buffer.toString();
                    if (unpacked) return load();
                } else if (!unpacked && entry.type === 'Directory') {
                    todo.push(function(next) { fs.mkdir(base + '/' + filepath, next); });
                } else if (!unpacked && entry.type === 'File') {
                    todo.push(function(next) { fs.writeFile(base + '/' + filepath, buffer, next); });
                }
            });
        });
        parser.on('end', function() {
            // Load was called early via parser. Do nothing.
            if (unpacked && xml) return;

            // Package unpacked but no project.xml. Call load to error our.
            if (unpacked) return load();

            todo.push(function(next) { fs.writeFile(base + '/.unpacked', '', next); });
            var next = function(err) {
                if (err && err.code !== 'EEXIST') return callback(err);
                if (todo.length) {
                    todo.shift()(next);
                } else {
                    unpacked = true;
                    load();
                }
            };
            next();
        });
        gunzip.on('error', error);
        parser.on('error', error);

        switch(uri.protocol) {
            case 'tm2z:':
                // The uri from unpacker has already been pulled
                // down from S3.
                stream = fs.createReadStream(uri.pathname)
                    .on('data', chunked)
                    .pipe(gunzip)
                    .pipe(parser)
                    .on('error', error);
                break;
            case 'tm2z+http:':
                uri.protocol = 'http:';
                stream = request({ uri: uri })
                    .on('data', chunked)
                    .pipe(gunzip)
                    .pipe(parser)
                    .on('error', error);
                break;
        }
    };

    function load() {
        if (!xml) return callback(new Error('project.xml not found in package'));
        tm2z.sources[id] = new Vector({
            source: 'mapbox:///mapbox.mapbox-streets-v2',
            base: base,
            xml: xml
        });
        tm2z.sources[id].open(function(err, source) {
            if (err) {
                delete tm2z.sources[id];
                return callback(err);
            }
            source.mtime = new Date(source._backend._source.data.mtime);
            source.access = +new Date;
            callback(null, source);
        });
    };
};
tm2z.sources = {};

tm2z.findID = function(source, id, callback) {
    callback(new Error('id not found'));
};
