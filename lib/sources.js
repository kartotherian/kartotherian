'use strict';

var util = require('util');
var pathLib = require('path');
var _ = require('underscore');
var Promise = require('bluebird');
var yaml = require('js-yaml');

var fs = require("fs");
Promise.promisifyAll(fs);

// constant
var sourceByRefProtocol = 'sourceref:';

var core = require('./core');
var Err = require('./Err');

function Sources(app) {
    this._log = app.logger.log.bind(app.logger);
    this._variables = {};
    this._sources = {};

    // Set up a ref protocol resolver - this way its enough to specify the source
    // by sourceref:///?ref=sourceID URL, instead of a full source URL.
    var self = this;
    core.tilelive.protocols[sourceByRefProtocol] = function (uri, callback) {
        Promise.try(function () {
            uri = core.normalizeUri(uri);
            if (!uri.query.ref) {
                throw new Err('ref uri parameter is not set');
            }
            return self.getHandlerById(uri.query.ref);
        }).nodeify(callback);
    };
}

/**
 * Regex string to match proper source IDs
 * @type {string}
 */
Sources.sourceIdReStr = '[A-Za-z][-A-Za-z0-9_]*';

/**
 * Precompiled regex to match source ID as a full string
 * @type {RegExp}
 */
Sources.sourceIdRe = new RegExp('^' + Sources.sourceIdReStr + '$');

/**
 * Source ID must begin with a letter, and may contain letters, digits, and underscores
 */
Sources.isValidSourceId = function (sourceId) {
    return typeof sourceId === 'string' && sourceId.length > 0 && Sources.sourceIdRe.test(sourceId);
};

/**
 * Load both variables and sources in one function call
 * @param variables
 * @param sources
 * @returns {*}
 */
Sources.prototype.init = function(variables, sources) {
    var self = this;
    return Promise.try(function () {
        return self.loadVariablesAsync(self._localOrExternalDataAsync(variables, 'variables'));
    }).then(function () {
        return self.loadSourcesAsync(self._localOrExternalDataAsync(sources, 'sources'))
    }).return(self);
};

/**
 * Load variables (e.g. passwords, etc)
 * @param variables
 * @returns {*}
 */
Sources.prototype.loadVariablesAsync = function(variables) {
    var self = this;
    return Promise.resolve(variables).then(function (variables) {
        self._variables = _.extend(self._variables, variables);
    });
};

Sources.prototype.loadSourcesAsync = function(sources) {
    var self = this;
    return Promise.resolve(sources).then(function (sources) {
        if (!_.isObject(sources) || _.isArray(sources)) {
            throw new Err('Sources must be an object');
        }
        return core.mapSequentialAsync(sources, function (src, key) {
            return self._loadSourceAsync(src, key);
        });
    });
};

/**
 * Load source from src config
 * @param {object} src
 * @param {string|object} src.uri
 * @param {object} src.params
 * @param {boolean} src.public
 * @param {int} src.minzoom
 * @param {int} src.maxzoom
 * @param {object} src.defaultHeaders
 * @param {object} src.headers
 * @param {string[]} src.formats
 * @param {int[]} src.scales
 * @param {boolean} src.static
 * @param {int} src.maxwidth
 * @param {int} src.maxheight
 * @param {string} src.pathname
 * @param {object|string} src.xml
 * @param {object} src.xmlSetAttrs
 * @param {object} src.xmlSetParams
 * @param {object} src.xmlLayers
 * @param {object} src.xmlExceptLayers
 * @param {object} src.xmlSetDataSource
 * @param {object} src.setInfo
 * @param {object} src.overrideInfo
 * @param sourceId
 * @returns {Promise}
 * @private
 */
Sources.prototype._loadSourceAsync = function(src, sourceId) {
    var self = this;
    return Promise.try(function () {
        if (!Sources.isValidSourceId(sourceId))
            throw new Err('sourceId "%s" must only contain letters and digits', sourceId);
        if (typeof src !== 'object')
            throw new Err('source %s must be an object', sourceId);

        core.checkType(src, 'uri', 'string', true, 1);
        var uri = core.normalizeUri(src.uri);

        // These params are stored, but not acted on within core
        // Kartotherian service uses them when handling user's requests
        // If public is not true, the rest of the values are unused
        core.checkType(src, 'public', 'boolean');
        core.checkType(src, 'minzoom', 'zoom');
        core.checkType(src, 'maxzoom', 'zoom');
        core.checkType(src, 'defaultHeaders', 'object');
        core.checkType(src, 'headers', 'object');
        core.checkType(src, 'formats', 'string-array');
        if (core.checkType(src, 'scales', 'number-array')) {
            // store scales as an array of strings because it must be an exact match - optimizes caching
            if (src.scales.length === 0) {
                delete src.scales;
            } else {
                src.scales = _.map(src.scales, function (v) {
                    return v.toString();
                });
            }
        }
        core.checkType(src, 'static', 'boolean');
        core.checkType(src, 'maxwidth', 'integer');
        core.checkType(src, 'maxheight', 'integer');
        core.checkType(src, 'setInfo', 'object');
        core.checkType(src, 'overrideInfo', 'object');

        // Add URI query values, e.g.  ?password=...
        if (core.checkType(src, 'params', 'object')) {
            _.each(src.params, function (v, k) {
                uri.query[k] = self._resolveValue(v, k);
            });
        }
        // Set URI's path, e.g. /srv/data/myDir
        if (core.checkType(src, 'pathname', 'object')) {
            uri.pathname = self._resolveValue(src.pathname, 'pathname');
        }
        if (src.xml) {
            return self._loadXmlAsync(src, uri);
        } else {
            return uri;
        }
    }).then(function (uri) {
        return core.loadSource(uri);
    }).then(function (handler) {
        var info = {
            // This is the only required field per spec, and it can be overwritten
            // https://github.com/mapbox/tilejson-spec
            tilejson: "2.1.0"
        };

        // minzoom/maxzoom is automatically added before setInfo and overrideInfo if setInfo is given
        // but it is added after calling original getInfo() if setInfo is not given
        if (src.setInfo) {
            updateInfo(info, src.setInfo, src, sourceId);
            updateInfo(info, src.overrideInfo);
            return [handler, info];
        } else {
            return handler.getInfoAsync().then(function(sourceInfo) {
                updateInfo(info, sourceInfo);
                updateInfo(info, src.overrideInfo, src, sourceId);
                return [handler, info];
            });
        }

    }).spread(function (handler, info) {
        handler.getInfo = function (callback) {
            callback(undefined, info);
        };
        handler.getInfoAsync = Promise.promisify(handler.getInfo);

        src.getHandler = function() { return handler };
        self._sources[sourceId] = src;
    });
};

/**
 * Override top-level values in the info object with the ones from override object, or delete on null
 * @param {object} info
 * @param {object} override
 * @param {object} source if given, sets min/max zoom
 * @param {string} sourceId
 */
function updateInfo(info, override, source, sourceId) {
    if (source) {
        if (source.minzoom !== undefined) info.minzoom = source.minzoom;
        if (source.maxzoom !== undefined) info.maxzoom = source.maxzoom;
    }
    if (sourceId !== undefined) info.name = sourceId;
    if (override) {
        _.each(override, function(v, k) {
            if (v === null) {
                // When override.key == null, delete that key
                delete info[k];
            } else {
                // override info of the parent
                info[k] = v;
            }
        });
    }
}

Sources.prototype._localOrExternalDataAsync = function(values, name) {
    var self = this;
    return Promise.try(function () {
        if (values === undefined) {
            self._log('info', name + ' is not set in the config file');
            return {};
        }
        if (!Array.isArray(values)) {
            values = [values];
        }
        values = _.map(values, function (value) {
            if (typeof value === 'string') {
                var path = pathLib.resolve(core.getAppRootDir(), value);
                self._log('info', 'Loading ' + name + ' from ' + path);
                return fs
                    .readFileAsync(path)
                    .then(yaml.safeLoad);
            } else if (typeof value === 'object' && !Array.isArray(value)) {
                self._log('info', 'Loading ' + name + ' from the config file');
                return value;
            } else {
                throw new Err('config.%s must be an object or filename, or an array of objects and/or filenames', name);
            }
        });

        return Promise.reduce(values, _.extend, {});
    });
};

Sources.prototype._xmlParamByName = function(xmlParams, name, xmlFile) {
    var param = xmlParams.childWithAttribute('name', name);
    if (!param || param.name !== 'Parameter') {
        throw new Err('<Parameter name="%s"> xml element was not found in %s', name, xmlFile);
    }
    return param;
};

Sources.prototype._setXmlAttributes = function(newValues, xmlElement) {
    var self = this;
    _.each(newValues, function (value, name) {
        xmlElement.attr[name] = self._resolveValue(value, name);
    });
};

Sources.prototype._setXmlParameters = function(newValues, xmlParams, xmlFile) {
    var self = this;
    _.each(newValues, function (value, name) {
        var param = self._xmlParamByName(xmlParams, name, xmlFile);
        param.val = self._resolveValue(value, name);
    });
};

Sources.prototype._loadXmlAsync = function(src, uri) {
    var self = this,
        xmlFile = self._resolveValue(src.xml, 'xml', true);

    if (typeof xmlFile === 'object') {
        // this is a module loader, allow it to update loading options
        xmlFile.module.apply(src, xmlFile.params);
        xmlFile = src.xmlFile;
    }

    var promise = fs.readFileAsync(xmlFile, 'utf8');

    if (src.xmlSetAttrs || src.xmlSetParams || src.xmlLayers || src.xmlExceptLayers || src.xmlSetDataSource) {
        promise = promise.then(function (xml) {
            var xmldoc = require('xmldoc');
            var doc = new xmldoc.XmlDocument(xml);

            // 'xmlSetAttrs' overrides root attributes. Usage:
            //    xmlSetAttrs: { 'font-directory': 'string' }
            if (core.checkType(src, 'xmlSetAttrs', 'object')) {
                self._setXmlAttributes(src.xmlSetAttrs, doc);
            }

            // 'xmlSetParams' overrides root parameter values. Usage:
            //    xmlSetParams: { 'maxzoom': 20, 'source': {'ref':'v1gen'} }
            if (core.checkType(src, 'xmlSetParams', 'object')) {
                var xmlParams = doc.childNamed('Parameters');
                if (!xmlParams) {
                    throw new Err('<Parameters> xml element was not found in %s', xmlFile);
                }
                self._setXmlParameters(src.xmlSetParams, xmlParams, xmlFile);
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
                            self._log('warn', '<Datasource> xml element was not found in layer %s in %s', xmlLayer.attr.name, xmlFile);
                            return;
                        }
                        if (conditions) {
                            if (!_.all(conditions, function (val, key) {
                                    return self._xmlParamByName(xmlParams, key, xmlFile).val === val;
                                })) return;
                        }
                        self._log('info', 'Updating layer ' + xmlLayer.attr.name);
                        core.checkType(ds, 'set', 'object', true);
                        self._setXmlParameters(ds.set, xmlParams, xmlFile);
                    });
                });
            }

            return doc.toString({cdata: true});
        });
    }

    return promise.then(function(xml) {
        // override all query params except protocol
        return {
            protocol: uri.protocol,
            xml: xml,
            base: pathLib.dirname(xmlFile)
        };
    });
};

/**
 * Resolves a config value into a string. If value is an object, it must contain exactly one
 * key - npm, ref, or var.  For an array, each value is resolved separately.
 * If allowLoader is true,
 * @param {*} value
 * @param {string} valueName
 * @param {boolean} allowLoader
 * @returns {string|object}
 * @private
 */
Sources.prototype._resolveValue = function(value, valueName, allowLoader) {
    var self = this;
    if (typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return _.map(value, function (v) {
            return self._resolveValue(v, valueName, allowLoader);
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
        case 'npmpath':
            return this.getModulePath(value);
        case 'ref':
            return this._getSourceUri(value);
        case 'var':
            return this._getVariable(value);
        case 'loader':
        case 'npmloader':
            if (allowLoader) {
                return this._getLoader(value);
            }
            // fallthrough
        default:
            throw new Err('Value %s of type %s is not recognized', valueName, key);
    }
};

Sources.prototype.getSourceById = function(sourceId, dontThrow) {
    if (!Sources.isValidSourceId(sourceId) || !this._sources.hasOwnProperty(sourceId)) {
        if (dontThrow) return undefined;
        throw new Err('Unknown source %s', sourceId);
    }
    return this._sources[sourceId];
};

Sources.prototype.getHandlerById = function(sourceId, dontThrow) {
    return this.getSourceById(sourceId, dontThrow).getHandler();
};

Sources.prototype.getSources = function() {
    return this._sources;
};

Sources.prototype.getVariables = function() {
    return this._variables;
};

Sources.prototype._getSourceUri = function(sourceId) {
    this.getSourceById(sourceId); // assert it exists
    return sourceByRefProtocol + '///?ref=' + sourceId;
};

Sources.prototype._getVariable = function(name) {
    if (!core.checkType(this._variables, name, 'string')) {
        throw new Err('Variable %s is not defined', name);
    }
    return this._variables[name];
};

Sources.prototype.getModulePath = function(moduleName) {
    var params;
    if (Array.isArray(moduleName)) {
        params = moduleName.slice(1);
        moduleName = moduleName[0];
    } else if (typeof moduleName === 'string') {
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

/**
 * Given a module name, require that module in the context of the main app.
 * Returns loaded module and the optional additional parameters.
 * @param {string|string[]} moduleName
 * @returns {object}
 * @private
 */
Sources.prototype._getLoader = function(moduleName) {
    var params;
    if (typeof moduleName === 'string') {
        params = [];
    } else if (Array.isArray(moduleName)) {
        params = moduleName.slice(1);
        moduleName = moduleName[0];
    }
    if (typeof moduleName !== 'string') {
        throw new Err('loader npm module name key must be a string or an array of strings');
    }
    var module = require(core.resolveModule(moduleName));
    if (typeof module !== 'function') {
        throw new Err('loader npm module "%s" is expected to return a function when loaded', moduleName);
    }
    return {
        module: module,
        params: params
    };
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
