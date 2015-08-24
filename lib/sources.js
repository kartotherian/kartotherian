'use strict';

var util = require('util');
var pathLib = require('path');
var _ = require('underscore');
var BBPromise = require('bluebird');
var yaml = require('js-yaml');

var fs = require("fs");
BBPromise.promisifyAll(fs);

// constant
var sourceByRefProtocol = 'sourceref:';

var core = require('./core');
var Err = core.Err;

function Sources(app, tilelive) {
    this.log = app.logger.log.bind(app.logger);
    this.tilelive = tilelive;
    this.sources = {};
    this.variables = {};

    // Set up a ref protocol resolver - this way its enough to specify the source
    // by sourceref:///?ref=sourceID URL, instead of a full source URL.
    var self = this;
    tilelive.protocols[sourceByRefProtocol] = function (uri, callback) {
        BBPromise.try(function () {
            uri = core.normalizeUri(uri);
            if (!uri.query.ref) {
                throw new Err('ref uri parameter is not set');
            }
            return self.getSourceById(uri.query.ref).handler;
        }).nodeify(callback);
    };
}

/**
 * Source ID must begin with a letter, and may contain letters, digits, and underscores
 */
Sources.isValidSourceId = function (sourceId) {
    return typeof sourceId === 'string' && sourceId.length > 0 && /^[A-Za-z]\w*$/.test(sourceId);
};

Sources.prototype.loadAsync = function(conf) {
    var self = this;
    // Load variables (e.g. passwords, etc)
    return self._localOrExternalDataAsync(conf.variables, 'variables')
        .then(function (variables) {
            self.variables = _.extend(self.variables, variables);
            // Load sources
            return self._localOrExternalDataAsync(conf.sources, 'sources');
        }).then(function (sources) {
            self.sources = _.extend(self.sources, sources);

            // Parse sources in parallel (loading on the other hand has to done in order)
            return core.mapSequentialAsync(self.sources, function (src, key) {
                if (!Sources.isValidSourceId(key))
                    throw new Err('sources.%s key must only contain letters and digits', key);
                if (typeof src !== 'object')
                    throw new Err('sources.%s must be an object', key);

                core.checkType(src, 'uri', 'string', true, 1);
                src.uri = core.normalizeUri(src.uri);

                // These params are stored, but not acted on within core
                // Kartotherian service uses them when handling user's requests
                // If public is not true, the rest of the values are unused
                core.checkType(src, 'public', 'boolean');
                core.checkType(src, 'minzoom', 'zoom');
                core.checkType(src, 'maxzoom', 'zoom');
                core.checkType(src, 'defaultHeaders', 'object');
                core.checkType(src, 'headers', 'object');
                core.checkType(src, 'formats', 'string-array', []);
                core.checkType(src, 'maxscale', 'integer', false, 2, 9);
                if (core.checkType(src, 'pbfsource', 'string')) {
                    self.getSourceById(src.pbfsource);
                }
                core.checkType(src, 'static', 'boolean');
                core.checkType(src, 'maxwidth', 'integer');
                core.checkType(src, 'maxheight', 'integer');

                // Add URI query values, e.g.  ?password=...
                if (core.checkType(src, 'params', 'object')) {
                    _.each(src.params, function (v, k) {
                        src.uri.query[k] = self._resolveValue(v, k);
                    });
                }
                // Set URI's path, e.g. /srv/data/mydir
                if (core.checkType(src, 'pathname', 'object')) {
                    src.uri.pathname = self._resolveValue(src.pathname, 'pathname');
                }
                if (src.xml) {
                    return self._loadXmlAsync(src);
                }
            });
        }).then(function () {
            return core.mapSequentialAsync(self.sources, function (src) {
                return self.tilelive
                    .loadAsync(src.uri)
                    .then(function (handler) {
                        src.handler = BBPromise.promisifyAll(handler);
                        return true;
                    });
            });
        });
};

Sources.prototype._localOrExternalDataAsync = function(values, name) {
    var self = this;
    return BBPromise.try(function () {
        if (values === undefined) {
            self.log('info', name + ' is not set in the config file');
            return {};
        }
        if (!Array.isArray(values)) {
            values = [values];
        }
        values = _.map(values, function (value) {
            if (typeof value === 'string') {
                var path = pathLib.resolve(core.getAppRootDir(), value);
                self.log('info', 'Loading ' + name + ' from external file ' + path);
                return fs
                    .readFileAsync(path)
                    .then(yaml.safeLoad);
            } else if (typeof value === 'object' && !Array.isArray(value)) {
                self.log('info', 'Loading ' + name + ' from the config file');
                return value;
            } else {
                throw new Err('config.%s must be an object or filename, or an array of objects and/or filenames', name);
            }
        });

        return BBPromise.reduce(values, _.extend, {});
    });
};

Sources.prototype._xmlParamByName = function(xmlParams, name, xmlFile) {
    var param = xmlParams.childWithAttribute('name', name);
    if (!param || param.name !== 'Parameter') {
        throw new Err('<Parameter name="%s"> xml element was not found in %s', name, xmlFile);
    }
    return param;
};

Sources.prototype._setXmlParameters = function(newValues, xmlParams, xmlFile) {
    var self = this;
    _.each(newValues, function (value, name) {
        var param = self._xmlParamByName(xmlParams, name, xmlFile);
        param.val = self._resolveValue(value, name);
    });
};

Sources.prototype._loadXmlAsync = function(src) {
    var self = this;
    src.xml = self._resolveValue(src.xml, 'xml');
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
                self._setXmlParameters(src.xmlSetParams, xmlParams, src.xml);
            }

            // 'xmlLayers' selects just the layers specified by a list (could be just one string instead)
            // Remove layers that were not listed in the layer parameter. Keep all non-layer elements.
            // Alternatively, use 'xmlExceptLayers' to exclude a list of layers.
            //    layers: ['waterway', 'building']
            var layerFunc = getLayerFilter(src);
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
                        conditions = _.mapObject(ds.if, function (value, key) {
                            return self._resolveValue(value, key);
                        });
                    }
                    doc.eachChild(function (xmlLayer) {
                        if (xmlLayer.name !== 'Layer' || (layerFunc && !layerFunc(xmlLayer))) {
                            return;
                        }
                        var xmlParams = xmlLayer.childNamed('Datasource');
                        if (!xmlParams) {
                            self.log('warn', '<Datasource> xml element was not found in layer %s in %s', xmlLayer.attr.name, src.xml);
                            return;
                        }
                        if (conditions) {
                            if (!_.all(conditions, function (val, key) {
                                    return self._xmlParamByName(xmlParams, key, src.xml).val === val;
                                })) return;
                        }
                        self.log('info', 'Updating layer ' + xmlLayer.attr.name);
                        core.checkType(ds, 'set', 'object', true);
                        self._setXmlParameters(ds.set, xmlParams, src.xml);
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
};

Sources.prototype._resolveValue = function(value, valueName) {
    var self = this;
    if (typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return _.map(value, function (v) {
            return self._resolveValue(v, valueName);
        });
    }
    var key = _.keys(value);
    if (key.length !== 1) {
        throw new Err('Value %s must be an object with one key-value pair', valueName);
    }
    key = key[0];
    value = value[key];

    switch (key) {
        case 'npm':
            return this.getModulePath(value);
        case 'ref':
            return this._getSourceUri(value);
        case 'var':
            return this._getVariable(value);
        default:
            throw new Err('Value %s of type %s is not recognized', valueName, key);
    }
};

Sources.prototype.getSourceById = function(sourceId, dontThrow) {
    if (!Sources.isValidSourceId(sourceId) || !this.sources.hasOwnProperty(sourceId))
        throw new Err('Unknown source %s', sourceId);
    return this.sources[sourceId];
};

Sources.prototype._getSourceUri = function(sourceId) {
    this.getSourceById(sourceId); // assert it exists
    return sourceByRefProtocol + '///?ref=' + sourceId;
};

Sources.prototype._getVariable = function(name) {
    core.checkType(this.variables, name, 'string', true);
    return this.variables[name];
};

Sources.prototype.getModulePath = function(moduleName) {
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
    params.unshift(pathLib.dirname(core.resolveModule(moduleName)));
    return pathLib.resolve.apply(undefined, params);
};

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

module.exports = Sources;
