'use strict';

let util = require('util'),
    pathLib = require('path'),
    _ = require('underscore'),
    Promise = require('bluebird'),
    yaml = require('js-yaml'),
    fs = require("fs"),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator');

Promise.promisifyAll(fs);

module.exports = YamlLoader;

/**
 * Load source from opts config
 * @param {object} opts
 * @param {object|string} opts.yaml
 * @param {object} opts.yamlSetAttrs
 * @param {object} opts.yamlSetParams
 * @param {object} opts.yamlLayers
 * @param {object} opts.yamlExceptLayers
 * @param {object} opts.yamlSetDataSource
 * @param {function} valueResolver
 * @param {function} [logger]
 * @constructor
 */
function YamlLoader(opts, valueResolver, logger) {
    this._resolveValue = valueResolver;
    this._opts = opts;
    this._log = logger || (() => {});
}

/**
 * @param {string} protocol
 * @return {Promise.<string>}
 */
YamlLoader.prototype.load = function load(protocol) {
    let self = this,
        opts = this._opts,
        yamlFile = self._resolveValue(opts.yaml, 'yaml', true);

    if (typeof yamlFile === 'object') {
        // this is a module loader, allow it to update loading options
        yamlFile.module.apply(opts, yamlFile.params);
        yamlFile = opts.yamlFile;
    }

    return fs.readFileAsync(yamlFile, 'utf8')
        .then(yaml => self.update(yaml, yamlFile))
        .then(yaml => {
            // override all query params except protocol
            return {
                protocol: protocol,
                yaml: yaml,
                base: pathLib.dirname(yamlFile),
                pathname: pathLib.dirname(yamlFile),
                hostname: '/'
            };
        });
};

/**
 * Actually perform the YAML modifications
 * @param {string} yamlData string YAML
 * @param {string} yamlFile the name of the yaml file to include in errors
 * @return {string} modified yaml string
 */
YamlLoader.prototype.update = function update(yamlData, yamlFile) {
    let self = this,
        opts = self._opts,
        isSource = opts.uri === 'tmsource://',
        layersProp = isSource ? 'Layer' : 'layers',
        getLayerId = isSource ?
            layer => layer.id :
            layer => layer;

    if (!opts.yamlSetParams && !opts.yamlLayers &&
        !opts.yamlExceptLayers && !opts.yamlSetDataSource
    ) {
        return yamlData;
    }

    let doc = yaml.safeLoad(yamlData);

    // 'yamlSetParams' overrides parameter values. Usage:
    //    yamlSetParams: { 'maxzoom': 20, 'source': {'ref':'v1gen'} }
    if (checkType(opts, 'yamlSetParams', 'object')) {
        _.each(opts.yamlSetParams, (value, name) => {
            doc[name] = self._resolveValue(value, name);
        });
    }

    // 'yamlLayers' selects just the layers specified by a list (could be a single string)
    // Remove layers that were not listed in the layer parameter. Keep all non-layer elements.
    // Alternatively, use 'yamlExceptLayers' to exclude a list of layers.
    //    layers: ['waterway', 'building']
    let layerFunc = getLayerFilter(opts, getLayerId);
    if (layerFunc) {
        doc[layersProp] = doc[layersProp].filter(layerFunc);
    }

    // 'yamlSetDataSource' allows alterations to the datasource parameters in each layer.
    // could be an object or an array of objects
    // use 'if' to provide a set of values to match, and 'set' to change values
    if (checkType(opts, 'yamlSetDataSource', 'object')) {
        let dataSources = opts.yamlSetDataSource;
        if (typeof dataSources === 'object' && !Array.isArray(dataSources)) {
            dataSources = [dataSources];
        }
        _.each(dataSources, ds => {
            if (typeof ds !== 'object' || Array.isArray(ds)) {
                throw new Err('YamlLoader: yamlSetDataSource must be an object');
            }
            let conditions = false;
            if (checkType(ds, 'if', 'object')) {
                conditions = _.mapObject(ds.if, (value, key) => self._resolveValue(value, key));
            }
            doc[layersProp].forEach(yamlLayer => {
                let layerDatasource = yamlLayer.Datasource;
                if (!layerDatasource) {
                    self._log('warn', 'Datasource yaml element was not found in layer %j in %j',
                        yamlLayer.id, yamlFile);
                    return;
                }
                if (conditions) {
                    if (!_.all(conditions, (val, key) => layerDatasource[key] === val)) {
                        return;
                    }
                }
                self._log('trace', 'Updating layer ' + yamlLayer.id);
                checkType(ds, 'set', 'object', true);
                _.each(ds.set, (value, name) => {
                    layerDatasource[name] = self._resolveValue(value, name);
                });
            });
        });
    }

    return yaml.safeDump(doc);
};

// returns a function that will test a layer for being in a list (or not in a list)
function getLayerFilter(opts, getLayerId) {
    let include = checkType(opts, 'yamlLayers', 'string-array'),
        exclude = checkType(opts, 'yamlExceptLayers', 'string-array');
    if (!include && !exclude) {
        return undefined;
    }
    if (include && exclude) {
        throw new Err('YamlLoader: it may be either yamlLayers or yamlExceptLayers, not both');
    }
    let layers = include ? opts.yamlLayers : opts.yamlExceptLayers;
    if (!Array.isArray(layers)) {
        throw new Err(
            'YamlLoader yamlLayers/yamlExceptLayers must be a string or an array of strings');
    }
    return layer => _.contains(layers, getLayerId(layer)) === include;
}
