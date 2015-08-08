'use strict';

var _ = require('underscore');
var BBPromise = require('bluebird');
var pathLib = require('path');
var yaml = require('js-yaml');

var fs = require("fs");
BBPromise.promisifyAll(fs);

var allSources, variables,
    log,
    sourceByRefProtocol = 'sourceref:';

var core = require('./utils');

function initAsync(app, tilelive, moduleResolver, serviceRootDir) {

    log = app.logger.log.bind(app.logger);

    // Load external variables (e.g. passwords, etc)
    return localOrExternalDataAsync(app.conf.variables, serviceRootDir, 'variables')
        .then(function (vars) {
            if (vars !== undefined && typeof vars !== 'object')
                throw new Error('config.variables must be an object (optional)');
            variables = vars || {};

            // Load external sources config file or use part of the main config
            return localOrExternalDataAsync(app.conf.sources, serviceRootDir, 'sources');
        }).then(function (sources) {
            if (typeof sources !== 'object')
                throw new Error('sources must be an object');

            allSources = sources;
            tilelive.protocols[sourceByRefProtocol] = getSourceByRef;
            initLayerBridgeProtocol(tilelive);
            initStyleProtocol(tilelive);

            _.each(sources, function (src, key) {
                if (!/^\w+$/.test(key.toString()))
                    throw new Error('sources.' + key + ' key must contain chars and digits only');
                if (typeof src !== 'object')
                    throw new Error('sources.' + key + ' must be an object');
                core.checkType(src, 'uri', 'string', true, 1);
                src.uri = core.normalizeUri(src.uri);

                // npm tag takes the dir path of the npm and uses it as a named url parameter, or the pathname if id is ""
                core.checkType(src, 'npm', 'object');
                resolveMap(src.npm, src.uri, getModulePath, moduleResolver);
                // path tag uses the dir path as a named url parameter, or the pathname if id is ""
                core.checkType(src, 'path', 'object');
                resolveMap(src.path, src.uri);

                core.checkType(src, 'ref', 'object');
                resolveMap(src.ref, src.uri, getSourceUri);

                core.checkType(src, 'var', 'object');
                resolveMap(src.var, src.uri, function(v) {
                    core.checkType(variables, v, 'string', true);
                    return variables[v];
                });

                core.checkType(src, 'public', 'boolean');
            });

            // Loaded sources in order
            return _.reduce(sources, function (promise, src) {
                return promise.then(function () {
                    return tilelive
                        .loadAsync(src.uri)
                        .then(function (handler) {
                            src.handler = handler;
                            return true;
                        });
                });
            }, BBPromise.resolve())
                .return(sources);
        });
}

function localOrExternalDataAsync(confValue, rootDir, name) {
    return BBPromise.try(function() {
        if (typeof confValue === 'string') {
            var path = pathLib.resolve(rootDir, confValue);
            log('info', 'Loading ' + name + ' from external file ' + path);
            return fs
                .readFileAsync(path)
                .then(yaml.safeLoad);
        }
        if (confValue === undefined) {
            log('info', name + ' is not set in the config file');
        } else {
            log('info', 'Loading ' + name + ' from the config file');
        }
        return confValue;
    });
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
        sourceParam.val = uriParams.source;

        return xml;
    });
}

function setXmlSourceLoader(protocol, targetProtocol, tilelive, updateXmlFunc) {
    tilelive.protocols[protocol] = function (uri, callback) {
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
    };
}

function getSourceById(sourceId) {
    var s = getSources();
        if (!s.hasOwnProperty(sourceId))
            throw new Error('Unknown source ' + sourceId);
    return s[sourceId];
}

function getSourceUri(sourceId) {
    getSourceById(sourceId); // assert it exists
    return sourceByRefProtocol + '///?ref=' + sourceId;
}

function getModulePath(moduleName, moduleResolver) {
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
}

function getSources() {
    if (!allSources) {
        throw new Error('Sources have not yet been initialized');
    }
    return allSources;
}

function getSourceByRef(uri, callback) {
    BBPromise.try(function() {
        uri = core.normalizeUri(uri);
        if (!uri.query.ref) {
            throw new Error('ref uri parameter is not set');
        }
        return getSourceById(uri.query.ref).handler;
    }).nodeify(callback);
}

function resolveMap(map, uri, resolverFunc, resolverArg) {
    if (typeof map !== 'undefined' ) {
        _.each(map, function(tagName, tagValue) {
            var val = resolverFunc ? resolverFunc(tagName, resolverArg) : tagName;
            if (val !== undefined) {
                if (tagValue === '') {
                    uri.pathname = val;
                } else {
                    uri.query[tagValue] = val;
                }
            }
        });
    }
}

module.exports = {
    initAsync: initAsync,
    getModulePath: getModulePath,
    getSourceUri: getSourceUri
};
