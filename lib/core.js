'use strict';

var util = require('util');
var qs = require('querystring');
var urllib = require('url');
var _ = require('underscore');
var Promise = require('bluebird');

var zlib = require('zlib');
Promise.promisifyAll(zlib);

// Make sure there is String.endsWith()
if (!String.prototype.endsWith) {
    String.prototype.endsWith = function endsWith(searchString, position) {
        var subjectString = this.toString();
        if (position === undefined || position > subjectString.length) {
            position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
}

var Err = require('./Err');

var core = {
    maxValidZoom: 26,
    maxValidCoordinate: Math.pow(2, 26),
    maxValidIndex: Math.pow(4, 26)
};
module.exports = core;

var _app, _packageConfig, _rootDir, _npmLoader, _npmResolver, _sources;

/**
 * Initializes the core
 * @param {Object} app main object from service-runner
 * @param {Object} app.conf configuration object defined in the config.yaml file
 * @param {Object} app.logger logger object that implements log(group, message) function
 * @param {Object} app.metrics object to send metrics data to
 * @param {Object} packageConfig configuration object defined in the package.json kartotherian tag
 * @param {string} rootDir Absolute path of the root directory of the main app
 * @param {function} npmLoader function that performs 'require(moduleName)' in the context of the main app
 * @param {function} npmResolver function that performs 'require.resolve(moduleName)' in the context of the main app
 *
 * TODO: Any suggestions about how to get rid of this ugly hack are welcome
 *
 */
core.init = function init(app, packageConfig, rootDir, npmLoader, npmResolver) {
    _app = app;
    _packageConfig = packageConfig;
    _rootDir = rootDir;
    _npmLoader = npmLoader;
    _npmResolver = npmResolver;

    core.log = app.logger.log.bind(app.logger);
    core.metrics = app.metrics;

    var tilelive = npmLoader('tilelive');
    Promise.promisifyAll(tilelive);
    core.tilelive = tilelive;

    var mapnik = npmLoader('mapnik');
    Promise.promisifyAll(mapnik.Map.prototype);
    Promise.promisifyAll(mapnik.VectorTile.prototype);
    core.mapnik = mapnik;

    _.each(core.loadNpmModules('registerSourceLibs'), function(lib) {
        if (lib.initKartotherian) {
            lib.initKartotherian(core);
        } else {
            lib.registerProtocols(core.tilelive);
        }
    });
};

/**
 * Log info - will get overriden during init() call
 */
core.log = function log(group, message) {
    console.log.apply(null, arguments);
};

/**
 * Attempt to convert Error to anything printable (with stacktrace)
 */
core.errToStr = function errToStr(err) {
    return (err.body && (err.body.stack || err.body.detail)) || err.stack || err;
};

/**
 * Performs 'require()' in the context of the main app
 */
core.resolveModule = function resolveModule(moduleName) {
    if (!_npmResolver) throw new Err('core.init() has not been called');
    return _npmResolver(moduleName);
};

/**
 * Returns the root dir of the app, as specified in the init() call
 */
core.getAppRootDir = function getAppRootDir() {
    if (!_rootDir) throw new Err('core.init() has not been called');
    return _rootDir;
};

/**
 * Returns the root dir of the app, as specified in the init() call
 */
core.loadNpmModules = function loadNpmModules(pkgConfigList) {
    return _.map(core.getAppConfiguration()[pkgConfigList], function (lib) {
        return _npmLoader(lib);
    });
};

/**
 * Throw "standard" tile does not exist error.
 * The error message string is often used to check if tile existance, so it has to be exact
 */
core.throwNoTile = function throwNoTile() {
    throw new Error('Tile does not exist');
};

/**
 * Checks if the error indicates the tile does not exist
 */
core.isNoTileError = function isNoTileError(err) {
    return err.message === 'Tile does not exist';
};

/**
 * Parse and normalize URI, ensuring it returns an object with query object field
 * @param uri
 * @returns {*}
 */
core.normalizeUri = function normalizeUri(uri) {
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
core.isValidCoordinate = function isValidCoordinate(val, zoom) {
    if (zoom === undefined) {
        return core.isInteger(val) && 0 <= val && val < core.maxValidCoordinate;
    } else {
        return core.isInteger(val) && core.isValidZoom(zoom) && 0 <= val && val < Math.pow(2, zoom);
    }
};

/**
 * Tests if xy index is valid for the given zoom
 */
core.isValidIndex = function isValidIndex(val, zoom) {
    if (zoom === undefined) {
        return core.isInteger(val) && 0 <= val && val < core.maxValidIndex;
    } else {
        return core.isInteger(val) && core.isValidZoom(zoom) && 0 <= val && val < Math.pow(4, zoom);
    }
};

/**
 * Tests if zoom is valid. Zoom may not exceed 26 because the index coordinate we use
 * will exceed the largest JavaScript int of 2^53  (which is 4^26)
 */
core.isValidZoom = function isValidZoom(val) {
    return core.isInteger(val) && 0 <= val && val <= core.maxValidZoom;
};

/**
 * Convert x,y into a single integer with alternating bits
 * @param x
 * @param y
 * @param zoom optional zoom level to validate x,y coordinates
 */
core.xyToIndex = function xyToIndex(x, y, zoom) {
    if (!core.isValidCoordinate(x, zoom) || !core.isValidCoordinate(y, zoom)) {
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
core.indexToXY = function indexToXY(index) {
    if (!core.isValidIndex(index)) {
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

core.isInteger = function isInteger(value) {
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
core.strToInt = function strToInt(value) {
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
core.strToFloat = function strToFloat(value) {
    if (typeof value === 'string' && floatRe.test(value)) {
        return parseFloat(value);
    }
    return value;
};

core.uncompressAsync = function uncompressAsync(data) {
    return Promise.try(function () {
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
core.extractSubTileAsync = function extractSubTileAsync(baseTileRawPbf, z, x, y, bz, bx, by) {
    return Promise
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

core.compressPbfAsync2 = function compressPbfAsync2(data, headers) {
    if (!data || data.length === 0) {
        return [data, headers];
    }
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
core.getTitleWithParamsAsync = function getTitleWithParamsAsync(source, z, x, y, opts) {
    return new Promise(function (resolve, reject) {
        try {
            var callback = function (err, data, headers) {
                if (err) {
                    reject(err);
                } else {
                    resolve([data, headers]);
                }
            };
            source.getTile(z, x, y, opts ? _.extend(callback, opts) : callback);
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Utility method to check the type of the object's property
 */
core.checkType = function checkType(obj, field, expType, mustHave, min, max) {
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
                    return typeof v === 'string' && v.length > 0;
                })
            ) {
                throw new Err('Invalid %s param: expecting a string or an array of strings', field);
            }
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
        case 'array':
            if (!Array.isArray(value))
                throw new Err('Invalid %s param type %s given, was expecting an array', field, type);
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
core.mapSequentialAsync = function mapSequentialAsync(list, iterator) {
    return _.reduce(list, function (promise, value, key) {
        return promise.then(function () {
            return iterator(value, key);
        });
    }, Promise.resolve()).return(list);
};

core.loadSource = function loadSource(sourceUri) {
    return core.tilelive.loadAsync(sourceUri).then(function (handler) {
        // Annoyingly, Tilesource API has a few functions that break the typical NodeJS callback
        // pattern of function(error, result), and instead have multiple results.  For them,
        // we need to promisify them with the { multiArgs: true }
        // API:  https://github.com/mapbox/tilelive/blob/master/API.md
        // See also: http://bluebirdjs.com/docs/api/promise.promisifyall.html#option-multiargs
        Promise.promisifyAll(handler, {
            filter: function (name) {
                return name === 'getTile' || name === 'getGrid';
            },
            multiArgs: true
        });
        // Promisify the rest of the methods
        return Promise.promisifyAll(handler);
    });
};

core.validateZoom = function validateZoom(zoom, source) {
    zoom = core.strToInt(zoom);
    if (!core.isValidZoom(zoom)) {
        throw new Err('invalid zoom').metrics('err.req.coords');
    }
    if (source.minzoom !== undefined && zoom < source.minzoom) {
        throw new Err('Minimum zoom is %d', source.minzoom).metrics('err.req.zoom');
    }
    if (source.maxzoom !== undefined && zoom > source.maxzoom) {
        throw new Err('Maximum zoom is %d', source.maxzoom).metrics('err.req.zoom');
    }
    return zoom;
};

core.validateScale = function validateScale(scale, source) {
    if (scale !== undefined) {
        if (!source.scales) {
            throw new Err('Scaling is not enabled for this source').metrics('err.req.scale');
        }
        if (!_.contains(source.scales, scale.toString())) {
            throw new Err('This scaling is not allowed for this source. Allowed: %s', source.scales.join())
                .metrics('err.req.scale');
        }
        scale = parseFloat(scale);
    }
    return scale;
};

core.reportError = function reportError(errReporterFunc, err) {
    try {
        errReporterFunc(err);
    } catch (e2) {
        console.error('Unable to report: ' + core.errToStr(err) + '\n\nDue to: ' + core.errToStr(e2));
    }
};

core.reportRequestError = function reportRequestError(err, res) {
    core.reportError(function (err) {
        res
            .status(400)
            .header('Cache-Control', 'public, s-maxage=30, max-age=30')
            .json(err.message || 'error/unknown');
        core.log('error', err);
        core.metrics.increment(err.metrics || 'err.unknown');
    }, err);
};

core.getAppConfiguration = function getAppConfiguration() {
    return _packageConfig;
};

core.getConfiguration = function getConfiguration() {
    return _app.conf;
};

core.setSources = function setSources(sources) {
    _sources = sources;
};

core.getSources = function getSources() {
    if (!_sources) {
        throw new Err('The service has not started yet');
    }
    return _sources;
};

core.getPublicSource = function getPublicSource(srcId) {
    var source = core.getSources().getSourceById(srcId, true);
    if (!source) {
        throw new Err('Unknown source').metrics('err.req.source');
    }
    if (!source.public) {
        throw new Err('Source is not public').metrics('err.req.source');
    }
    return source;
};

/**
 * Set headers on the response object
 * @param res
 * @param source
 * @param dataHeaders
 */
core.setResponseHeaders = function setResponseHeaders(res, source, dataHeaders) {
    if (_app.conf.defaultHeaders) res.set(_app.conf.defaultHeaders);
    if (source && source.defaultHeaders) res.set(source.defaultHeaders);
    if (dataHeaders) res.set(dataHeaders);
    if (_app.conf.overrideHeaders) res.set(_app.conf.overrideHeaders);
    if (source && source.headers) res.set(source.headers);
};
