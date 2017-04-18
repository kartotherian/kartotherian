'use strict';

let util = require('util'),
    pathLib = require('path'),
    _ = require('underscore'),
    Promise = require('bluebird'),
    yaml = require('js-yaml'),
    fs = require("fs"),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator'),
    core = require('./core'),
    XmlLoader = require('@kartotherian/module-loader').XmlLoader;

Promise.promisifyAll(fs);

// constant
const sourceByRefProtocol = 'sourceref:';

function Sources() {
    this._variables = {};
    this._sources = {};

    // Set up a ref protocol resolver - this way its enough to specify the source
    // by sourceref:///?ref=sourceID URL, instead of a full source URL.
    let self = this;

    // ATTENTION: this must be a non-anonymous function, as it is a constructor
    core.tilelive.protocols[sourceByRefProtocol] = function(uri, callback) {
        Promise.try(() => {
            uri = checkType.normalizeUrl(uri);
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
Sources.isValidSourceId = function(sourceId) {
    return typeof sourceId === 'string' && sourceId.length > 0 && Sources.sourceIdRe.test(sourceId);
};

/**
 * Load both variables and sources in one function call
 * @param {object} conf
 * @param {object|string} conf.modules
 * @param {object|string} conf.variables
 * @param {object|string} conf.sources
 * @returns {*}
 */
Sources.prototype.init = function(conf) {
    let self = this;
    return Promise.try(() => {
        if (!conf.modules) {
            throw new Err('Configuration must have a "modules" parameter listing all ' +
                'Tilelive/Kartotherian NPM plugin modules');
        }
        _.each(conf.modules, core.registerTileliveModule);
        self.loadVariablesAsync(self._localOrExternalDataAsync(conf.variables, 'variables'));
    }).then(() =>
        self.loadSourcesAsync(self._localOrExternalDataAsync(conf.sources, 'sources'))
    ).return(self);
};

/**
 * Load variables (e.g. passwords, etc)
 * @param variables
 * @returns {*}
 */
Sources.prototype.loadVariablesAsync = function(variables) {
    let self = this;
    return Promise.resolve(variables).then(variables => {
        self._variables = _.extend(self._variables, variables);
    });
};

Sources.prototype.loadSourcesAsync = function(sources) {
    let self = this;
    return Promise.resolve(sources).then(sources => {
        if (!_.isObject(sources) || _.isArray(sources)) {
            throw new Err('Sources must be an object');
        }
        return Promise.each(
            Object.keys(sources),
            key => self._loadSourceAsync(sources[key], key));
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
    let self = this;
    return Promise.try(() => {
        if (!Sources.isValidSourceId(sourceId)) {
            throw new Err('sourceId %j must only contain letters and digits', sourceId);
        }
        if (typeof src !== 'object') {
            throw new Err('source %j must be an object', sourceId);
        }

        checkType(src, 'uri', 'string', true, 1);
        let uri = checkType.normalizeUrl(src.uri);

        // These params are stored, but not acted on within core
        // Kartotherian service uses them when handling user's requests
        // If public is not true, the rest of the values are unused
        checkType(src, 'public', 'boolean');
        checkType(src, 'minzoom', 'zoom');
        checkType(src, 'maxzoom', 'zoom');
        checkType(src, 'defaultHeaders', 'object');
        checkType(src, 'headers', 'object');
        checkType(src, 'formats', 'string-array');
        if (checkType(src, 'scales', 'number-array')) {
            // store scales as an array of strings because it
            // must be an exact match - optimizes caching
            if (src.scales.length === 0) {
                delete src.scales;
            } else {
                src.scales = _.map(src.scales, v => v.toString());
            }
        }
        checkType(src, 'static', 'boolean');
        checkType(src, 'maxwidth', 'integer');
        checkType(src, 'maxheight', 'integer');
        checkType(src, 'setInfo', 'object');
        checkType(src, 'overrideInfo', 'object');

        // Add URI query values, e.g.  ?password=...
        if (checkType(src, 'params', 'object')) {
            _.each(src.params, (v, k) => {
                uri.query[k] = self._resolveValue(v, k);
            });
        }
        // Set URI's path, e.g. /srv/data/myDir
        if (checkType(src, 'pathname', 'object')) {
            uri.pathname = self._resolveValue(src.pathname, 'pathname');
        }
        if (src.xml) {
            let xmlLoader = new XmlLoader(src, self._resolveValue.bind(self), core.log);
            return xmlLoader.load(uri.protocol);
        } else {
            return uri;
        }
    }).then(
        uri => core.loadSource(uri)
    ).then(handler => {
        let info = {
            // This is the only required field per spec, and it can be overwritten
            // https://github.com/mapbox/tilejson-spec
            tilejson: "2.1.0"
        };

        // minzoom/maxzoom is automatically added before
        // setInfo and overrideInfo if setInfo is given
        // but it is added after calling original getInfo() if setInfo is not given
        if (src.setInfo) {
            updateInfo(info, src.setInfo, src, sourceId);
            updateInfo(info, src.overrideInfo);
            return [handler, info];
        } else {
            return handler.getInfoAsync().then(sourceInfo => {
                updateInfo(info, sourceInfo);
                updateInfo(info, src.overrideInfo, src, sourceId);
                return [handler, info];
            });
        }

    }).spread((handler, info) => {
        handler.getInfo = callback => {
            callback(undefined, info);
        };
        handler.getInfoAsync = Promise.promisify(handler.getInfo);

        src.getHandler = () => handler;
    }).catch(err => {
        err.message = `Unable to create source "${sourceId}"` + (err.message || '');
        core.log('error', err);
        src.isDisabled = err || true;
    }).then(() => {
        self._sources[sourceId] = src;
    });
};

/**
 * Override top-level values in the info object with the ones
 * from override object, or delete on null
 * @param {object} info
 * @param {object} override
 * @param {object} [source] if given, sets min/max zoom
 * @param {string} [sourceId]
 */
function updateInfo(info, override, source, sourceId) {
    if (source) {
        if (source.minzoom !== undefined) {
            info.minzoom = source.minzoom;
        }
        if (source.maxzoom !== undefined) {
            info.maxzoom = source.maxzoom;
        }
    }
    if (sourceId !== undefined) {
        info.name = sourceId;
    }
    if (override) {
        _.each(override, (v, k) => {
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
    return Promise.try(() => {
        if (values === undefined) {
            core.log('info', name + ' is not set in the config file');
            return {};
        }
        if (!Array.isArray(values)) {
            values = [values];
        }
        values = _.map(values, value => {
            if (typeof value === 'string') {
                let path = pathLib.resolve(core.getAppRootDir(), value);
                core.log('info', 'Loading ' + name + ' from ' + path);
                return fs
                    .readFileAsync(path)
                    .then(yaml.safeLoad);
            } else if (typeof value === 'object' && !Array.isArray(value)) {
                core.log('info', 'Loading ' + name + ' from the config file');
                return value;
            } else {
                throw new Err('config.%s must be an object or filename,' +
                    ' or an array of objects and/or filenames', name);
            }
        });

        return Promise.reduce(values, _.extend, {});
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
    let self = this;
    if (typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return _.map(value, v => self._resolveValue(v, valueName, allowLoader));
    }
    let key = _.keys(value);
    if (key.length !== 1) {
        throw new Err('Value %j must be an object with one key-value pair', valueName);
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
        case 'env':
            return this._getEnvVariable(value);
        case 'loader':
        case 'npmloader':
            if (allowLoader) {
                return this._getLoader(value);
            }
        // fallthrough
        default:
            throw new Err('Value %j of type %j is not recognized', valueName, key);
    }
};

Sources.prototype.getSourceById = function(sourceId, dontThrow, allowDisabled) {
    if (!Sources.isValidSourceId(sourceId) || !this._sources.hasOwnProperty(sourceId)) {
        if (dontThrow) {
            return undefined;
        }
        throw new Err('Unknown source %j', sourceId);
    }

    let source = this._sources[sourceId];

    if (!allowDisabled && source.isDisabled) {
        if (dontThrow) {
            return undefined;
        }
        throw new Err('Source %j is disabled, possibly due to loading errors', sourceId);
    }

    return source;
};

Sources.prototype.getHandlerById = function(sourceId, dontThrow) {
    return this.getSourceById(sourceId, dontThrow).getHandler();
};

Sources.prototype.getSourceConfigs = function() {
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
    if (this._variables[name] === undefined) {
        throw new Err('Variable %j is not defined', name);
    }
    return this._variables[name];
};

Sources.prototype._getEnvVariable = function(name) {
    if (process.env[name] === undefined) {
        throw new Err('Environment variable %j is not set', name);
    }
    return process.env[name];
};

Sources.prototype.getModulePath = function(moduleName) {
    let params;
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
    let params;
    if (typeof moduleName === 'string') {
        params = [];
    } else if (Array.isArray(moduleName)) {
        params = moduleName.slice(1);
        moduleName = moduleName[0];
    }
    if (typeof moduleName !== 'string') {
        throw new Err('loader npm module name key must be a string or an array of strings');
    }
    let module = require(core.resolveModule(moduleName));
    if (typeof module !== 'function') {
        throw new Err('loader npm module %j is expected to return a function when loaded',
            moduleName);
    }
    return {
        module: module,
        params: params
    };
};

module.exports = Sources;
