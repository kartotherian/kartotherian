'use strict';

var _ = require('underscore');
var BBPromise = require('bluebird');
var callsite = require('callsite');
var mapnik = require('mapnik');
var pathLib = require('path');
var qs = require('querystring');
var urllib = require('url');
var zlib = require('zlib');

module.exports = {};
var core = module.exports;

/**
 * Parse and normalize URI, ensuring it returns an object with query object field
 */
module.exports.registerProtocols = function(module, tilelive) {
    module.registerProtocols(tilelive);
    BBPromise.promisifyAll(module.prototype);
};

/**
 * Parse and normalize URI, ensuring it returns an object with query object field
 * @param uri
 * @returns {*}
 */
module.exports.normalizeUri = function(uri) {
    if (typeof uri === 'string') {
        uri = urllib.parse(uri, true);
    } else if (typeof uri.query === 'string') {
        uri.query = qs.parse(uri.query);
    }
    uri.query = uri.query || {};
    return uri;
};

/**
 * Convert x,y into a single integer with alternating bits
 */
module.exports.xyToIndex = function(x, y) {
    var mult = 1, result = 0;
    while (x || y) {
        result += (mult * (x % 2));
        x = Math.floor(x / 2);
        mult *= 2;
        result += (mult * (y % 2));
        y = Math.floor(y / 2);
        mult *= 2;
    }
    return result;
};

/**
 * Convert a single integer into the x,y coordinates
 * Given an integer, extract every odd/even bit into two integer values
 */
module.exports.indexToXY = function(index) {
    var x = 0, y = 0, mult = 1;
    while (index) {
        x += mult * (index % 2);
        index = Math.floor(index / 2);
        y += mult * (index % 2);
        index = Math.floor(index / 2);
        mult *= 2;
    }
    return [x, y];
};

module.exports.isInteger = function(value) {
    return typeof value === 'number' && Math.floor(value) === value;
};

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param path
 * @returns {*}
 */
module.exports.normalizePath = function(path) {
    var stack = callsite(),
        requester = stack[1].getFileName();
    return pathLib.resolve(path.dirname(requester), '..', path);
};

module.exports.uncompressAsync = function(data) {
    return BBPromise.try(function () {
        if (data && data.length) {
            if (data[0] == 0x1F && data[1] == 0x8B) {
                return zlib.gunzipAsync(data);
            } else if (data[0] == 0x78 && data[1] == 0x9C) {
                return zlib.inflateAsync(data);
            }
        }
        return data;
    });
};

/**
 * Extract portion of a higher zoom tile as a new tile
 * @param baseTileRawPbf uncompressed vector tile pbf
 * @param z desired zoom of the subtile
 * @param x subtile's x
 * @param y subtile's y
 * @param bz source tile's zoom
 * @param bx source tile's x
 * @param by source tile's y
 * @returns {string|*}
 */
module.exports.extractSubTileAsync = function(baseTileRawPbf, z, x, y, bz, bx, by) {
    return BBPromise
        .try(function () {
            if (bz >= z) {
                throw new Error('Base tile zoom is not less than z');
            }
            var baseTile = new mapnik.VectorTile(bz, bx, by);
            baseTile.setData(baseTileRawPbf);
            var subTile = new mapnik.VectorTile(+z, +x, +y);
            return subTile.compositeAsync([baseTile]);
        }).then(function (vtile) {
            return vtile.getData();
        });
};

module.exports.compressPbfAsync2 = function(data, headers) {
    return zlib
        .gzipAsync(data)
        .then(function (pbfz) {
            headers['Content-Encoding'] = 'gzip';
            return [pbfz, headers];
        });
};

module.exports.getModulePath = function(moduleName, moduleResolver) {
    var params;
    if (Array.isArray(moduleName)) {
        params = moduleName;
        moduleName = moduleName.shift();
    } else if ( typeof moduleName === 'string' ) {
        if (moduleName.indexOf("/") > -1) {
            return moduleName; // Already resolved path
        }
        params = [];
    } else {
        throw new Error('npm module name key must be a string or an array');
    }
    // remove the name of the startup js file, and use it as path
    params.unshift(pathLib.dirname(moduleResolver(moduleName)));
    return pathLib.resolve.apply(undefined, params);
};

module.exports.getStaticOpts = function(conf) {
    var staticOpts = {};
    staticOpts.setHeaders = function (res) {
        if (conf.cache) {
            res.header('Cache-Control', conf.cache);
        }
        if (res.req.originalUrl.endsWith('.pbf')) {
            res.header('Content-Encoding', 'gzip');
        }
    };
    return staticOpts;
};


function resolveMap(map, mapname, uri, resolverFunc, resolverArg) {
    if (typeof map !== 'undefined' ) {
        if (typeof map !== 'object') {
            throw new Error(mapname + ' must be an object');
        }
        if (uri) {
            _.each(map, function(tagName, tagValue) {
                var val = resolverFunc ? resolverFunc(tagName, resolverArg) : tagName;
                if (tagValue === '') {
                    uri.pathname = val;
                } else {
                    uri.query[tagValue] = val;
                }
            });
        }
    }
}

module.exports.loadConfigurationAsync = function(app, tilelive, moduleResolver) {
    var log = app.logger.log.bind(app.logger);
    var confSource;
    if (typeof app.conf.sources === 'string') {
        var sourcesPath = pathLib.resolve(__dirname, '..', app.conf.sources);
        log('info', 'Loading sources configuration from ' + sourcesPath);
        confSource = fs
            .readFileAsync(sourcesPath)
            .then(yaml.safeLoad);
    } else {
        log('info', 'Loading sources configuration from the config file');
        confSource = BBPromise.resolve(app.conf);
    }
    return confSource.then(function(conf) {
        if (typeof conf.sources !== 'object')
            throw new Error('conf.sources must be an object');
        if (typeof conf.styles !== 'object')
            throw new Error('conf.styles must be an object');
        _.each(conf.sources, function (cfg, key) {
            if (!/^\w+$/.test(key.toString()))
                throw new Error('conf.sources.' + key + ' key must contain chars and digits only');
            if (typeof cfg !== 'object')
                throw new Error('conf.sources.' + key + ' must be an object');
            if (!cfg.hasOwnProperty('uri'))
                throw new Error('conf.sources.' + key + '.uri must be given');
            cfg.uri = core.normalizeUri(cfg.uri);
            // npm tag takes the dir path of the npm and uses it as a named url parameter, or the pathname if id is ""
            resolveMap(cfg.npm, 'conf.sources.' + key + '.npm', cfg.uri, core.getModulePath, moduleResolver);
            // path tag uses the dir path as a named url parameter, or the pathname if id is ""
            resolveMap(cfg.path, 'conf.sources.' + key + '.path', cfg.uri);
            // Don't update yet, just validate
            resolveMap(cfg.ref, 'conf.sources.' + key + '.ref');
            if (typeof cfg.public === 'undefined') {
                cfg.public = false;
            } else if (typeof cfg.public !== 'boolean') {
                throw new Error('conf.sources.' + key + '.public must be boolean');
            }
        });
        _.each(conf.styles, function (cfg, key) {
            if (!/^\w+$/.test(key.toString()))
                throw new Error('conf.styles.' + key + ' key must contain chars and digits only');
            if (conf.sources.hasOwnProperty(key))
                throw new Error('conf.styles.' + key + ' key already exists in conf.sources');
            if (typeof cfg !== 'object')
                throw new Error('conf.styles.' + key + ' must be an object');
            // TODO: should provide the same capability as the source tag
            cfg.tm2 = core.getModulePath(cfg.tm2, moduleResolver);
            if (typeof cfg.source !== 'string' && typeof cfg.source !== 'number')
                throw new Error('conf.styles.' + key + '.source must be a string or a number');
            if (!conf.sources.hasOwnProperty(cfg.source))
                throw new Error('conf.styles.' + key + '.source "' + cfg.source + '" does not exist in conf.sources');
            if (typeof cfg.public === 'undefined') {
                cfg.public = false;
            } else if (typeof cfg.public !== 'boolean') {
                throw new Error('conf.sources.' + key + '.public must be boolean');
            }
        });
        // Resolve the .ref values into uri parameters. Ordering of sources is important
        _.each(conf.sources, function (cfg) {
            // second pass, skip validation
            resolveMap(cfg.ref, '', cfg.uri, function (refId) {
                if (!conf.sources.hasOwnProperty(refId))
                    throw new Error('Unknown source ' + refId);
                return conf.sources[refId].uri;
            });
        });

        return BBPromise.all(_.map(conf.sources, function (cfg) {
            return tilelive
                .loadAsync(cfg.uri)
                .then(function (handler) {
                    cfg.handler = handler;
                    return true;
                });
        })).return(conf);
    });
};
