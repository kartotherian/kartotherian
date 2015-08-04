'use strict';

var BBPromise = require('bluebird');
var mapnik = require('mapnik');
var pathLib = require('path');
var qs = require('querystring');
var urllib = require('url');
var zlib = require('zlib');

module.exports = {};

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
    return pathLib.resolve(__dirname, '..', path);
}

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
}

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
}

module.exports.compressPbfAsync2 = function(data, headers) {
    return zlib
        .gzipAsync(data)
        .then(function (pbfz) {
            headers['Content-Encoding'] = 'gzip';
            return [pbfz, headers];
        });
}

module.exports.getModulePath = function(moduleName) {
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
    params.unshift(pathLib.dirname(require.resolve(moduleName)));
    return pathLib.resolve.apply(undefined, params);
}

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
}
