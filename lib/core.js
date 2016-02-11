'use strict';

var util = require('util');
var qs = require('querystring');
var urllib = require('url');
var _ = require('underscore');
var BBPromise = require('bluebird');

var zlib = require('zlib');
BBPromise.promisifyAll(zlib);

// Make sure there is String.endsWith()
if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(searchString, position) {
        var subjectString = this.toString();
        if (position === undefined || position > subjectString.length) {
            position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
}

module.exports = {
    maxValidZoom: 26,
    maxValidCoordinate: Math.pow(2, 26),
    maxValidIndex: Math.pow(4, 26)
};

var Err = require('./Err');
var core = module.exports;
var _log, _rootDir, _npmResolver;

/**
 * Initializes the core
 * @param logger logger object that implements log(group, message) function
 * @param rootDir Absolute path of the root directory of the main app
 * @param npmResolver function that performs 'require.resolve(moduleName)' in the context of the main app
 * @param tilelive
 * @param mapnik
 *
 * TODO: Any suggestions about how to get rid of this ugly hack are welcome
 *
 * For example, if your main code is in ./routes/nnn.js, you would use this snipet at the top:
 * var core = require('kartotherian-core');
 * core.init(app.logger, require('path').resolve(__dirname, '..'), function (module) { return require.resolve(module); }, require('tilelive'));
 */
module.exports.init = function(logger, rootDir, npmResolver, tilelive, mapnik) {
    _log = logger.log.bind(logger);
    _rootDir = rootDir;
    _npmResolver = npmResolver;
    BBPromise.promisifyAll(tilelive);
    core.tilelive = tilelive;
    BBPromise.promisifyAll(mapnik.Map.prototype);
    BBPromise.promisifyAll(mapnik.VectorTile.prototype);
    core.mapnik = mapnik;
};

/**
 * Log info
 */
module.exports.log = function(group, message) {
    if (!_log) {
        console.log.apply(null, arguments);
    } else {
        _log.apply(null, arguments);
    }
};

/**
 * Attempt to convert Error to anything printable (with stacktrace)
 */
module.exports.errToStr = function(err) {
    return (err.body && (err.body.stack || err.body.detail)) || err.stack || err;
};

/**
 * Performs 'require()' in the context of the main app
 */
module.exports.resolveModule = function(moduleName) {
    if (!_npmResolver) throw new Err('core.init() has not been called');
    return _npmResolver(moduleName);
};

/**
 * Returns the root dir of the app, as specified in the init() call
 */
module.exports.getAppRootDir = function() {
    if (!_rootDir) throw new Err('core.init() has not been called');
    return _rootDir;
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
    if (zoom === undefined) {
        return core.isInteger(val) && 0 <= val && val < module.exports.maxValidCoordinate;
    } else {
        return core.isInteger(val) && core.isValidZoom(zoom) && 0 <= val && val < Math.pow(2, zoom);
    }
};

/**
 * Tests if xy index is valid for the given zoom
 */
module.exports.isValidIndex = function(val, zoom) {
    if (zoom === undefined) {
        return core.isInteger(val) && 0 <= val && val < module.exports.maxValidIndex;
    } else {
        return core.isInteger(val) && core.isValidZoom(zoom) && 0 <= val && val < Math.pow(4, zoom);
    }
};

/**
 * Tests if zoom is valid. Zoom may not exceed 26 because the index coordinate we use
 * will exceed the largest JavaScript int of 2^53  (which is 4^26)
 */
module.exports.isValidZoom = function(val) {
    return core.isInteger(val) && 0 <= val && val <= module.exports.maxValidZoom;
};

/**
 * Convert x,y into a single integer with alternating bits
 * @param x
 * @param y
 * @param zoom optional zoom level to validate x,y coordinates
 */
module.exports.xyToIndex = function(x, y, zoom) {
    if (!module.exports.isValidCoordinate(x, zoom) || !module.exports.isValidCoordinate(y, zoom)) {
        throw new Err('Invalid coordinates %s, %s', x, y);
    }
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
    if (!module.exports.isValidIndex(index)) {
        throw new Err('Invalid index %j', index);
    }
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
 * Magical int regex
 * @type {RegExp}
 */
var intRe = /^-?\d+$/;

/**
 * Converts value to integer if possible, or returns the original
 */
module.exports.strToInt = function(value) {
    if (typeof value === 'string' && intRe.test(value)) {
        return parseInt(value);
    }
    return value;
};

/**
 * Magical float regex found in http://stackoverflow.com/a/21664614/177275
 * @type {RegExp}
 */
var floatRe = /^-?\d+(?:[.,]\d*?)?$/;

/**
 * Converts value to float if possible, or returns the original
 */
module.exports.strToFloat = function(value) {
    if (typeof value === 'string' && floatRe.test(value)) {
        return parseFloat(value);
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
 * @param z desired zoom of the sub-tile
 * @param x sub-tile's x
 * @param y sub-tile's y
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
            var baseTile = new core.mapnik.VectorTile(bz, bx, by);
            // TODO: setData has an async version - we might want to use it instead
            baseTile.setData(baseTileRawPbf);
            var subTile = new core.mapnik.VectorTile(+z, +x, +y);
            // TODO: should we do a ".return(subTile)" after compositeAsync()?
            return subTile.compositeAsync([baseTile]);
        }).then(function (tile) {
            return tile.getData();
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
    if (value === undefined) {
        if (mustHave === true) {
            throw new Err('Value %s of type %s is missing', field, expType);
        }
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
                value = core.strToFloat(value);
                type = typeof value;
                break;
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
            case 'number-array':
                value = core.strToFloat(value);
                type = typeof value;
                if (type === 'number') {
                    obj[field] = value = [value];
                }
                break;
        }
    } else if (type === 'number' && expType === 'number-array') {
        obj[field] = value = [value];
        type = typeof value;
    }
    // validate the type
    switch (expType) {
        case 'string-array':
            if (!Array.isArray(value) || !_.all(value, function (v) {
                    return typeof(v) === 'string';
                }))
                throw new Err('Invalid %s param: expecting a string or an array of strings', field);
            break;
        case 'number-array':
            var isValid = Array.isArray(value);
            if (isValid) {
                value = _.map(value, function(v) {
                    v = core.strToFloat(v);
                    if (typeof v !== 'number')
                        isValid = false;
                    return v;
                });
            }
            if (!isValid)
                throw new Err('Invalid %s param: expecting a number or an array of numbers', field);
            obj[field] = value;
            break;
        case 'integer':
            if (!core.isInteger(value))
                throw new Err('Invalid %s param type %s given, was expecting an integer', field, type);
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
                throw new Err('Invalid %s param - must be at least %d, but given %d', field, min, value);
            }
            if (max !== undefined && value > max) {
                throw new Err('Invalid %s param - must be at most %d, but given %d', field, max, value);
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
            break;
        case 'string-array':
        case 'number-array':
            if (min !== undefined && value.length < min) {
                throw new Err('Invalid %s param - it must have at least %d values, but given %d', field, min, value.length);
            }
            if (max !== undefined && value.length > max) {
                throw new Err('Invalid %s param - it must have at least %d values, but given %d', field, max, value.length);
            }
            break;
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

module.exports.loadSource = function(sourceUri) {
    return core.tilelive.loadAsync(sourceUri).then(function (handler) {
        return BBPromise.promisifyAll(handler);
    });
};

module.exports.registerSourceLibs = function(lib /*, ... */) {
    var core = this;
    _.each(arguments, function(lib) {
        if (lib.initKartotherian) {
            lib.initKartotherian(core);
        } else {
            lib.registerProtocols(core.tilelive);
        }
    });
};
