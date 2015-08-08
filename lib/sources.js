'use strict';

var _ = require('underscore');
var BBPromise = require('bluebird');
var pathLib = require('path');
var yaml = require('js-yaml');

var fs = require("fs");
BBPromise.promisifyAll(fs);

var allSources,
    sourceByRefProtocol = 'sourceref:';

var core = require('./utils');

function initAsync(app, tilelive, moduleResolver, serviceRootDir) {

    var log = app.logger.log.bind(app.logger);
    var sourcesP;
    if (typeof app.conf.sources === 'string') {
        var sourcesPath = pathLib.resolve(serviceRootDir, app.conf.sources);
        log('info', 'Loading sources configuration from file ' + sourcesPath);
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
            resolveMap(src.npm, src.uri, core.getModulePath, moduleResolver);
            // path tag uses the dir path as a named url parameter, or the pathname if id is ""
            core.checkType(src, 'path', 'object');
            resolveMap(src.path, src.uri);

            core.checkType(src, 'ref', 'object');
            resolveMap(src.ref, src.uri, getSourceUri);

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
            if (tagValue === '') {
                uri.pathname = val;
            } else {
                uri.query[tagValue] = val;
            }
        });
    }
}

module.exports = {
    initAsync: initAsync,
    getSourceUri: getSourceUri
};
