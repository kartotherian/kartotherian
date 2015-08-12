'use strict';

var util = require('util');
var pathLib = require('path');
var _ = require('underscore');
var BBPromise = require('bluebird');
var yaml = require('js-yaml');

var fs = require("fs");
BBPromise.promisifyAll(fs);

var allSources, variables,
    log,
    sourceByRefProtocol = 'sourceref:';

var core = require('./utils');
var Err = core.Err;

/**
 * Source ID must begin with a letter, and may contain letters, digits, and underscores
 */
function isValidSourceId(sourceId) {
    return typeof sourceId === 'string' && sourceId.length > 0 && /^[A-Za-z]\w*$/.test(sourceId);
}

function initAsync(app, tilelive, npmResolver, serviceRootDir) {

    log = app.logger.log.bind(app.logger);

    // Load external variables (e.g. passwords, etc)
    return localOrExternalDataAsync(app.conf.variables, serviceRootDir, 'variables')
        .then(function (vars) {
            if (vars !== undefined && typeof vars !== 'object')
                throw new Err('config.variables must be an object (optional)');
            variables = vars || {};

            // Load external sources config file or use part of the main config
            return localOrExternalDataAsync(app.conf.sources, serviceRootDir, 'sources');
        }).then(function (sources) {
            if (typeof sources !== 'object')
                throw new Err('sources must be an object');

            allSources = sources;
            tilelive.protocols[sourceByRefProtocol] = getSourceByRef;

            // Parse sources in order
            return core.mapSequentialAsync(sources, function (src, key) {
                if (!isValidSourceId(key))
                    throw new Err('sources.%s key must contain chars and digits only', key);
                if (typeof src !== 'object')
                    throw new Err('sources.%s must be an object', key);

                core.checkType(src, 'uri', 'string', true, 1);
                src.uri = core.normalizeUri(src.uri);

                // These params are stored, but not acted on within core
                // Kartotherian service uses them when handling user's requests
                // If public is not set or false, the rest of the values are unused
                core.checkType(src, 'public', 'boolean');
                core.checkType(src, 'minzoom', 'integer', false, 0, 30);
                core.checkType(src, 'maxzoom', 'integer', false, 0, 30);
                core.checkType(src, 'defaultHeaders', 'object');
                core.checkType(src, 'headers', 'object');

                // npm tag takes the dir path of the npm and uses it as a named url parameter, or the pathname if id is ""
                core.checkType(src, 'npm', 'object');
                resolveMap(src.npm, src.uri, getModulePath, npmResolver);
                // path tag uses the dir path as a named url parameter, or the pathname if id is ""
                core.checkType(src, 'path', 'object');
                resolveMap(src.path, src.uri);

                // ref adds references to other sources
                core.checkType(src, 'ref', 'object');
                resolveMap(src.ref, src.uri, getSourceUri);

                // var allows source to add variable value from an external config, e.g. a password
                core.checkType(src, 'var', 'object');
                resolveMap(src.var, src.uri, getVariable);

                if (src.xml) {
                    return loadXmlAsync(src, npmResolver);
                }
            });
        }).then(function (sources) {
            return core.mapSequentialAsync(sources, function (src) {
                return tilelive
                    .loadAsync(src.uri)
                    .then(function (handler) {
                        src.handler = handler;
                        return true;
                    });
            });
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

function getParameterByName(xmlParams, name, xmlFile) {
    var param = xmlParams.childWithAttribute('name', name);
    if (!param || param.name !== 'Parameter') {
        throw new Err('<Parameter name="%s"> xml element was not found in %s', name, xmlFie);
    }
    return param;
}

function setXmlParameters(newValues, xmlParams, xmlFile, npmResolver) {
    _.each(newValues, function (value, name) {
        var param = getParameterByName(xmlParams, name, xmlFile);
        param.val = resolveValue(value, npmResolver);
    });
}

function loadXmlAsync(src, npmResolver) {
    src.xml = resolveValue(src.xml, npmResolver);
    var promise = fs.readFileAsync(src.xml, 'utf8');

    if (src.xmlSetParams || src.xmlLayers || src.xmlExceptLayers || src.xmlSetDataSource) {
        promise = promise.then(function (xml) {
            var xmldoc = require('xmldoc');
            var doc = new xmldoc.XmlDocument(xml);

            // 'xmlSetParams' overrides root parameter values. Usage:
            //    xmlSetParams: { 'maxzoom':20, 'source': {'ref':'v1gen'} }
            if (core.checkType(src, 'xmlSetParams', 'object')) {
                var xmlParams = doc.childNamed('Parameters');
                if (!xmlParams) {
                    throw new Err('<Parameters> xml element was not found in %s', src.xml);
                }
                setXmlParameters(src.xmlSetParams, xmlParams, src.xml, npmResolver);
            }

            // 'xmlLayers' selects just the layers specified by a list (could be just one string instead)
            // Remove layers that were not listed in the layer parameter. Keep all non-layer elements.
            // Alternatively, use 'xmlExceptLayers' to exclude a list of layers.
            //    layers: ['waterway', 'building']
            var layerFunc = getLayerFilter(src, true);
            if (layerFunc) {
                var result = [];
                doc.eachChild(function (xmlChild) {
                    if (xmlChild.name !== 'Layer' || layerFunc(xmlChild)) {
                        result.push(xmlChild);
                    }
                });
                doc.children = result;
            }

            // 'xmlSetDataSource' allows alterations to the datasource parameters in each layer.
            // could be an object or an array of objects
            // use 'if' to provide a set of values to match, and 'set' to change values, xmlLayers/xmlExceptLayers filters
            if (core.checkType(src, 'xmlSetDataSource', 'object')) {
                var dataSources = src.xmlSetDataSource;
                if (typeof dataSources === 'object' && !Array.isArray(dataSources)) {
                    dataSources = [dataSources];
                }
                _.each(dataSources, function(ds) {
                    if (typeof ds !== 'object' || Array.isArray(ds)) {
                        throw new Err('XmlLoader: xmlSetDataSource must be an object');
                    }
                    var layerFunc = getLayerFilter(ds);
                    var conditions = false;
                    if (core.checkType(ds, 'if', 'object')) {
                        conditions = _.mapObject(ds.if, function (value) {
                            return resolveValue(value, npmResolver);
                        });
                    }
                    doc.eachChild(function (xmlLayer) {
                        if (xmlLayer.name !== 'Layer' || (layerFunc && !layerFunc(xmlLayer))) {
                            return;
                        }
                        var xmlParams = xmlLayer.childNamed('Datasource');
                        if (!xmlParams) {
                            console.log('<Datasource> xml element was not found in layer %s in %s', xmlLayer.attr.name, src.xml);
                            return;
                        }
                        if (conditions) {
                            if (!_.all(conditions, function (val, key) {
                                    return getParameterByName(xmlParams, key, src.xml).val === val;
                                })) return;
                        }
                        // TODO fix logging
                        console.log('Updating layer ' + xmlLayer.attr.name);
                        core.checkType(ds, 'set', 'object', true);
                        setXmlParameters(ds.set, xmlParams, src.xml, npmResolver);
                    });
                });
            }

            return doc.toString({cdata: true});
        });
    }

    return promise.then(function(xml) {
        // override all query params except protocol
        src.uri = {
            protocol: src.uri.protocol,
            xml: xml,
            base: pathLib.dirname(src.xml)
        };
    });
}

// returns a function that will test a layer for being in a list (or not in a list)
function getLayerFilter(src) {
    var include = core.checkType(src, 'xmlLayers', 'string-array');
    var exclude = core.checkType(src, 'xmlExceptLayers', 'string-array');
    if (!include && !exclude) {
        return undefined;
    }
    if (include && exclude) {
        throw new Err('XmlLoader: it may be either xmlLayers or xmlExceptLayers, not both');
    }
    var layers = include ? src.xmlLayers : src.xmlExceptLayers;
    if (!Array.isArray(layers)) {
        throw new Err('XmlLoader xmlLayers/xmlExceptLayers must be a string or an array of strings');
    }
    return function (xmlChild) {
        return _.contains(layers, xmlChild.attr.name) === include;
    };
}

function resolveValue(value, npmResolver) {
    if (typeof value !== 'object') {
        return value;
    }
    var key = _.keys(value);
    if (key.length !== 1) {
        throw new Err('Value must be an object with one key-value pair');
    }
    key = key[0];
    value = value[key];

    switch (key) {
        case 'npm':
            return getModulePath(value, npmResolver);
        case 'ref':
            return getSourceUri(value);
        case 'var':
            return getVariable(value);
        default:
            throw new Err('Value type %s is not recognized', key);
    }
}

function getSourceById(sourceId) {
    var s = getSources();
        if (!s.hasOwnProperty(sourceId))
            throw new Err('Unknown source %s', sourceId);
    return s[sourceId];
}

function getSourceUri(sourceId) {
    getSourceById(sourceId); // assert it exists
    return sourceByRefProtocol + '///?ref=' + sourceId;
}

function getVariable(name) {
    core.checkType(variables, name, 'string', true);
    return variables[name];
}

function getModulePath(moduleName, npmResolver) {
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
        throw new Err('npm module name key must be a string or an array');
    }
    // remove the name of the startup js file, and use it as path
    params.unshift(pathLib.dirname(npmResolver(moduleName)));
    return pathLib.resolve.apply(undefined, params);
}

function getSources() {
    if (!allSources) {
        throw new Err('Sources have not yet been initialized');
    }
    return allSources;
}

function getSourceByRef(uri, callback) {
    BBPromise.try(function() {
        uri = core.normalizeUri(uri);
        if (!uri.query.ref) {
            throw new Err('ref uri parameter is not set');
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
    isValidSourceId: isValidSourceId,
    initAsync: initAsync,
    getModulePath: getModulePath,
    getSourceUri: getSourceUri
};
