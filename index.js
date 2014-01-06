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

module.exports = Vector;
module.exports.tm2z = tm2z;

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
};

function Task() {
    this.err = null;
    this.headers = {};
    this.access = +new Date;
    this.done;
    this.body;
    return;
};
util.inherits(Task, require('events').EventEmitter);

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

    this.update(uri, function(err) {
        this.emit('open', err, this);
    }.bind(this));
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

    var map = new mapnik.Map(256,256);
    map.fromString(opts.xml, {
        strict: false,
        base: this._base + '/'
    }, function(err) {
        if (err) return callback(err);

        delete this._info;
        this._xml = opts.xml;
        this._map = map;
        this._md5 = crypto.createHash('md5').update(opts.xml).digest('hex');
        this._format = opts.format || map.parameters.format || this._format || 'png8:m=h';
        this._scale = opts.scale || +map.parameters.scale || this._scale || 1;

        var source = map.parameters.source || opts.source;
        if (!this._backend || this._source !== source) {
            if (!source) return callback(new Error('No backend'));
            tilelive.load(source, function(err, backend) {
                if (err) return callback(err);
                if (!backend) return callback(new Error('No backend'));
                this._source = map.parameters.source || opts.source;
                if (this._backend !== backend) {
                    backend._vectorCache = {};
                    this._backend = backend;
                    delete this._minzoom;
                    delete this._maxzoom;
                    delete this._maskLevel;
                }
                return callback();
            }.bind(this));
        } else {
            return callback();
        }
    }.bind(this));
    return;
};

// Wrapper around backend.getTile that implements a "locking" cache.
Vector.prototype.sourceTile = function(backend, z, x, y, callback) {
    var source = this;
    var now = +new Date;
    var key = z + '/' + x + '/' + y;
    var cache = backend._vectorCache[key];

    // Reap cached vector tiles with stale access times on an interval.
    if (source._reap && !backend._vectorTimeout) backend._vectorTimeout = setTimeout(function() {
        var now = +new Date;
        Object.keys(backend._vectorCache).forEach(function(key) {
            if ((now - backend._vectorCache[key].access) < source._maxAge) return;
            delete backend._vectorCache[key];
        });
        delete backend._vectorTimeout;
    }, source._reap);

    // Expire cached tiles when they are past maxAge.
    if (cache && (now-cache.access) >= source._maxAge) cache = false;

    // Return cache if finished.
    if (cache && cache.done) {
        return callback(null, cache.body, cache.headers);
    // Otherwise add listener if task is in progress.
    } else if (cache) {
        return cache.once('done', callback);
    }

    var task = new Task();
    task.once('done', callback);

    var done = function(err, body, headers) {
        if (err) delete backend._vectorCache[key];
        task.done = true;
        task.body = body;
        task.headers = headers;
        task.emit('done', err, body, headers);
    };
    backend._vectorCache[key] = task;
    backend.getTile(z, x, y, function(err, body, headers) {
        if (err) return done(err);

        // If the source vector tiles are not using deflate, we're done.
        if (!source._deflate) return done(err, body, headers);

        // Otherwise, inflate the data.
        zlib.inflate(body, function(err, body) { return done(err, body, headers); });
    });
};

Vector.prototype.drawTile = function(bz, bx, by, z, x, y, format, scale, callback) {
    var source = this;
    var drawtime;
    var loadtime = +new Date;
    source.sourceTile(this._backend, bz, bx, by, function(err, data, head) {
        if (err && err.message !== 'Tile does not exist')
            return callback(err);

        if (err && source._maskLevel && bz > source._maskLevel)
            return callback(format === 'utf' ? new Error('Grid does not exist') : err);

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

        var vtile = new mapnik.VectorTile(bz, bx, by);
        vtile.setData(data || new Buffer(0), function(err) {
            // Errors for null data are ignored as a solid tile be painted.
            if (data && err) return callback(err);

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
                        buffer._srcbytes = data ? data.length : 0;
                        return callback(null, buffer, headers);
                    });
                }
            });
        });
    });
};

Vector.prototype.getTile = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    // Lazy load min/maxzoom/maskLevel info.
    if (this._maxzoom === undefined) return this._backend.getInfo(function(err, info) {
        if (err) return callback(err);

        this._minzoom = info.minzoom || 0;
        this._maxzoom = info.maxzoom || 22;

        // @TODO some sources filter out custom keys @ getInfo forcing us
        // to access info/data properties directly. Fix this.
        if ('maskLevel' in info) {
            this._maskLevel = parseInt(info.maskLevel, 10);
        } else if (this._backend.data && 'maskLevel' in this._backend.data) {
            this._maskLevel = this._backend.data.maskLevel;
        }

        return this.getTile(z, x, y, callback);
    }.bind(this));

    // Hack around tilelive API - allow params to be passed per request
    // as attributes of the callback function.
    var format = callback.format || this._format;
    var scale = callback.scale || this._scale;

    // If scale > 1 adjusts source data zoom level inversely.
    // scale 2x => z-1, scale 4x => z-2, scale 8x => z-3, etc.
    var d = Math.round(Math.log(scale)/Math.log(2));
    var bz = (z - d) > this._minzoom ? z - d : this._minzoom;
    var bx = Math.floor(x / Math.pow(2, z - bz));
    var by = Math.floor(y / Math.pow(2, z - bz));

    // Overzooming support.
    if (bz > this._maxzoom) {
        bz = this._maxzoom;
        bx = Math.floor(x / Math.pow(2, z - this._maxzoom));
        by = Math.floor(y / Math.pow(2, z - this._maxzoom));
    }

    // For nonmasked sources or bz within the maskrange attempt 1 draw.
    if (!this._maskLevel || bz <= this._maskLevel)
        return this.drawTile(bz, bx, by, z, x, y, format, scale, callback);

    // Above the maskLevel errors should attempt a second draw using the mask.
    this.drawTile(bz, bx, by, z, x, y, format, scale, function(err, buffer, headers) {
        if (!err) return callback(err, buffer, headers);
        if (err && err.message !== 'Tile does not exist') return callback(err);
        bz = this._maskLevel;
        bx = Math.floor(x / Math.pow(2, z - this._maskLevel));
        by = Math.floor(y / Math.pow(2, z - this._maskLevel));
        this.drawTile(bz, bx, by, z, x, y, format, scale, callback);
    }.bind(this));
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
    var map = new mapnik.Map(256,256);

    var mapFromStringStart = Date.now();
    map.fromString(this._xml, {
        strict: false,
        base: this._base + '/'
    }, function(err) {
        if (err) return callback(err);
        var mapFromStringTime = Date.now() - mapFromStringStart;
        var renderStart = Date.now();
        this.drawTile(0, 0, 0, 0, 0, 0, 'png', 1, function(err, buffer, headers) {
            if (err) return callback(err);
            var renderTime = Date.now() - renderStart;
            callback(null, {
                mapFromString: mapFromStringTime,
                renderTime: renderTime
            });
        });
    }.bind(this));
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
            source.mtime = new Date(source._backend.data.mtime);
            source.access = +new Date;
            callback(null, source);
        });
    };
};
tm2z.sources = {};

tm2z.findID = function(source, id, callback) {
    callback(new Error('id not found'));
};
