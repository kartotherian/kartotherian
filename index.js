'use strict';

var _ = require('underscore');
var BBPromise = require('bluebird');
var callsite = require('callsite');
var pathLib = require('path');
var qs = require('querystring');
var urllib = require('url');
var yaml = require('js-yaml');

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.Map.prototype);
BBPromise.promisifyAll(mapnik.VectorTile.prototype);

var fs = require("fs");
BBPromise.promisifyAll(fs);

var zlib = require('zlib');
BBPromise.promisifyAll(zlib);

module.exports = {};
var core = module.exports;

/**
 * Register module's protocols in tilerator, and promisify the module
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
 * Convert the result of normalizeUri() back into a string
 * @param uri
 * @returns string
 */
module.exports.formatUri = function(uri, nested) {
    if (typeof uri === 'string') {
        return uri;
    }
    uri = _.clone(uri);
    // without search value, formatter will use query args
    delete uri.search;
    // tilelive always checks for pathname, even though it could be null, so fake it as '/'
    if (uri.pathname === null) {
        uri.pathname = '/';
    }
    // Fix nested query values being URI's themselves
    nested = nested || 0;
    if (uri.query && (typeof uri.query === 'object') && nested < 2) {
        uri.query = _.mapObject(uri.query, function (val) {
            return module.exports.formatUri(val, nested + 1)
        });
    }
    return urllib.format(uri);
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

function initLayerBridgeProtocol(tilelive) {
    setXmlSourceLoader('bridgelayer:', 'bridge:', tilelive, function (xml, uriParams) {
        var layers = uriParams.layer;
        if (!layers) {
            return xml;
        }
        var result = [];
        xml.eachChild(function (child) {
            var single = typeof layers === 'string';
            if (child.name === 'Layer') {
                if (single ? child.attr.name !== layers : !_.contains(layers, child.attr.name)) {
                    // Remove layers that were not listed in the layer parameter. Keep all non-layer elements
                    return;
                }
            }
            result.push(child);
        });
        xml.children = result;
        return xml;
    });
}

function initStyleProtocol(tilelive) {
    setXmlSourceLoader('style:', 'vector:', tilelive, function (xml, uriParams) {

        if (!uriParams.source) {
            throw new Error('Source is not defined for this style');
        }
        var params = xml.childNamed('Parameters');
        if (!params) {
            throw new Error('<Parameters> xml element was not found in ' + uriParams.xml);
        }
        var sourceParam = params.childWithAttribute('name', 'source');
        if (!params) {
            throw new Error('<Parameter name="source"> xml element was not found in ' + uriParams.xml);
        }
        sourceParam.val = module.exports.formatUri(uriParams.source);

        return xml;
    });
}

function setXmlSourceLoader(protocol, targetProtocol, tilelive, updateXmlFunc) {
    function sourceLoader(uri, callback) {
        var params;
        return BBPromise
            .try(function () {
                uri = core.normalizeUri(uri);
                params = uri.query;
                if (!params.xml) {
                    throw Error("Uri must include 'xml' query parameter: " + JSON.stringify(uri))
                }
                return fs.readFileAsync(params.xml, 'utf8');
            }).then(function (xml) {
                var xmldoc = require('xmldoc');
                return new xmldoc.XmlDocument(xml);
            }).then(function (xml) {
                return updateXmlFunc(xml, params);
            }).then(function (xml) {
                var opts = {
                    protocol: targetProtocol,
                    xml: xml.toString({cdata: true}),
                    base: pathLib.dirname(params.xml)
                };
                return tilelive.loadAsync(opts);
            }).nodeify(callback);
    }
    tilelive.protocols[protocol] = sourceLoader;
}

module.exports.loadConfigurationAsync = function(app, tilelive, moduleResolver, serviceRootDir) {
    initLayerBridgeProtocol(tilelive);
    initStyleProtocol(tilelive);

    var log = app.logger.log.bind(app.logger);
    var sourcesP;
    if (typeof app.conf.sources === 'string') {
        var sourcesPath = pathLib.resolve(serviceRootDir, app.conf.sources);
        log('info', 'Loading sources configuration from ' + sourcesPath);
        sourcesP = fs
            .readFileAsync(sourcesPath)
            .then(yaml.safeLoad);
    } else {
        log('info', 'Loading sources configuration from the config file');
        sourcesP = BBPromise.resolve(app.conf.sources);
    }
    return sourcesP.then(function(sources) {
        if (typeof sources !== 'object')
            throw new Error('sources must be an object');
        _.each(sources, function (src, key) {
            if (!/^\w+$/.test(key.toString()))
                throw new Error('sources.' + key + ' key must contain chars and digits only');
            if (typeof src !== 'object')
                throw new Error('sources.' + key + ' must be an object');
            if (!src.hasOwnProperty('uri'))
                throw new Error('sources.' + key + '.uri must be given');
            src.uri = core.normalizeUri(src.uri);
            // npm tag takes the dir path of the npm and uses it as a named url parameter, or the pathname if id is ""
            resolveMap(src.npm, 'sources.' + key + '.npm', src.uri, core.getModulePath, moduleResolver);
            // path tag uses the dir path as a named url parameter, or the pathname if id is ""
            resolveMap(src.path, 'sources.' + key + '.path', src.uri);
            // Don't update yet, just validate
            resolveMap(src.ref, 'sources.' + key + '.ref');
            if (typeof src.public === 'undefined') {
                src.public = false;
            } else if (typeof src.public !== 'boolean') {
                throw new Error('sources.' + key + '.public must be boolean');
            }
        });
        // Resolve the .ref values into uri parameters. Ordering of sources is important
        _.each(sources, function (src) {
            // second pass, skip validation
            resolveMap(src.ref, '', src.uri, function (refId) {
                if (!sources.hasOwnProperty(refId))
                    throw new Error('Unknown source ' + refId);
                return sources[refId].uri;
            });
        });

        return BBPromise.all(_.map(sources, function (src) {
            return tilelive
                .loadAsync(src.uri)
                .then(function (handler) {
                    src.handler = handler;
                    return true;
                });
        })).return(sources);
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