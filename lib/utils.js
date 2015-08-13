'use strict';

var util = require('util');
var qs = require('querystring');
var urllib = require('url');
var _ = require('underscore');
var BBPromise = require('bluebird');

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.Map.prototype);
BBPromise.promisifyAll(mapnik.VectorTile.prototype);

var zlib = require('zlib');
BBPromise.promisifyAll(zlib);

module.exports = {};
var core = module.exports;
var Err = core.Err;

/**
 * Creates a formatted error info
 * @param message
 * @returns {module.exports.Err}
 * @constructor
 */
module.exports.Err = function(message) {
    this.message = arguments.length < 2 ? (message || 'unknown') : util.format.apply(null, arguments);
    return this;
};

module.exports.Err.prototype = Object.create(Error.prototype);
module.exports.Err.prototype.constructor = module.exports.Err;
module.exports.Err.prototype.metrics = function(metrics) {
    this.metrics = metrics;
    return this;
};

/**
 * Register module's protocols in tilerator, and promisify the module
 */
module.exports.registerProtocols = function(module, tilelive) {
    module.registerProtocols(tilelive);
    BBPromise.promisifyAll(module.prototype);
};

/**
 * Throw "standard" tile does not exist error.
 * The error message string is often used to check if tile existance, so it has to be exact
 */
module.exports.throwNoTile = function() {
    throw new Error('Tile does not exist');
};

/**
 * Checks if the error indicates the tile does not exist
 */
module.exports.isNoTileError = function(err) {
    return err.message === 'Tile does not exist';
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
 * Tests if x or y coordinate is valid for the given zoom
 */
module.exports.isValidCoordinate = function(val, zoom) {
    return core.isInteger(val) && 0 <= val && val < Math.pow(2, zoom);
};

/**
 * Tests if zoom is valid. Zoom may not exceed 26 because the index coordinate we use
 * will exceed the largest JavaScript int of 2^53  (which is 4^26)
 */
module.exports.isValidZoom = function(val, zoom) {
    return core.isInteger(val) && 0 <= val && val <= 26;
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
    return typeof value === 'number' && value % 1 === 0;
};

/**
 * Converts value to integer if possibble, or returns the original
 */
module.exports.strToInt = function(value) {
    if (typeof value === 'string') {
        var v = parseInt(value);
        if (v.toString() === value) {
            return v;
        }
    }
    return value;
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
                throw new Err('Base tile zoom is not less than z');
            }
            var baseTile = new mapnik.VectorTile(bz, bx, by);
            // TODO: setData has an async version - we might want to use it instead
            baseTile.setData(baseTileRawPbf);
            var subTile = new mapnik.VectorTile(+z, +x, +y);
            // TODO: should we do a ".return(subTile)" after compositeAsync()?
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

/**
 * Wrapper around the backwards-style getTile() call, where extra args are passed by attaching them to the callback
 */
module.exports.getTitleWithParamsAsync = function(source, z, x, y, opts) {
    return new BBPromise(function (resolve, reject) {
        try {
            var callback = function (err, data, headers) {
                if (err) {
                    reject(err);
                } else {
                    resolve([data, headers]);
                }
            };
            source.getTile(z, x, y, _.extend(callback, opts));
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Utility method to check the type of the object's property
 */
module.exports.checkType = function(obj, field, expType, mustHave, min, max) {
    var value = typeof(obj) === 'object' ? obj[field] : obj;
    if (value === undefined && mustHave !== true) {
        if (mustHave === false || mustHave === undefined) {
            delete obj[field];
        } else {
            obj[field] = mustHave;
        }
        return false;
    }
    // Try to convert value to expected type
    var type = expType[0] === '[' ? Object.prototype.toString.call(value) : typeof value;
    if (type === 'string') {
        switch (expType) {
            case 'number':
            case 'integer':
            case 'zoom':
                obj[field] = value = core.strToInt(value);
                type = typeof value;
                break;
            case 'boolean':
                obj[field] = value = (value ? true : false);
                type = typeof value;
                break;
            case 'string-array':
                obj[field] = value = [value];
                type = typeof value;
                break;
        }
    }
    // validate the type
    switch (expType) {
        case 'string-array':
            if (!Array.isArray(value) || !_.all(value, function (v) {
                    return typeof(v) === 'string';
                }))
                throw new Err('Invalid %s param: expecting a string or an array of strings', field);
            break;
        case 'integer':
            if (!core.isInteger(value))
                throw new Err('Invalid %s param type %s given, was expecting an integer', field);
            break;
        case 'zoom':
            if (!core.isValidZoom(value))
                throw new Err('Invalid %s param - an integer zoom value was expected', field);
            break;
        default:
            if (type !== expType)
                throw new Err('Invalid %s param type %s given, was expecting %s', field, type, expType);
            break;
    }
    // validate ranges
    switch (expType) {
        case 'number':
        case 'integer':
        case 'zoom':
            if (min !== undefined && value < min) {
                throw new Err('Invalid %s param - must be at least %d, but given %d', field, min, val);
            }
            if (max !== undefined && value > max) {
                throw new Err('Invalid %s param - must be at most %d, but given %d', field, max, val);
            }
            break;
        case 'string':
            if (min !== undefined && value.length < min) {
                throw new Err('Invalid %s param - the string must be at least %d symbols', field, min);
            }
            break;
        case 'boolean':
            if (value === false) {
                // convert false into undefined
                delete obj[field];
                return false;
            }
    }
    return true;
};

/**
 * given a list, async wait on each element before proceeding to the next
 */
module.exports.mapSequentialAsync = function(list, iterator) {
    return _.reduce(list, function (promise, value, key) {
        return promise.then(function () {
            return iterator(value, key);
        });
    }, BBPromise.resolve()).return(list);
};
