'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var fsp = require('fs-promise');
var pathLib = require('path');
var util = require('./util');

var mapnik = require('mapnik');
var Vector = require('tilelive-vector');
var tilelive = require('tilelive');
var yaml = require('js-yaml');

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param path
 * @returns {*}
 */
function normalizePath(path) {
    return pathLib.resolve(__dirname, '..', path);
}

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param uriOrig
 * @returns {*}
 */
function normalizeUri(uriOrig) {
    var uri = util.normalizeUri(uriOrig);
    switch (uri.protocol) {
        case 'file:':
        case 'bridge:':
            if (!uri.pathname) {
                throw new Error('Invalid uri ' + uriOrig);
            }
            if (uri.hostname === '.' || uri.hostname == '..') {
                uri.pathname = uri.hostname + uri.pathname;
                delete uri.hostname;
                delete uri.host;
            }
            uri.pathname = normalizePath(uri.pathname);
            break;
    }
    return uri;
}

function loadConfigurationAsync(appconf) {
    var mapdataPath = pathLib.resolve(pathLib.dirname(appconf.module), 'mapdata.yaml');
    console.log('Attempting to load ' + mapdataPath);
    return fsp.readFile(mapdataPath)
        .then(function(confData) {
            return yaml.safeLoad(confData);
        }, function() {
            // on error, assume there is no config file, and fallback to the conf data inside config.yaml
            return appconf.conf;
        })
        .then(loadConfiguration2);
}

function loadConfiguration2(conf) {
    var hasSources = false,
        hasStyles = false;

    if (typeof conf.sources !== 'object')
        throw new Error('conf.sources must be an object');
    if (typeof conf.styles !== 'object')
        throw new Error('conf.styles must be an object');
    _.each(conf.sources, function (cfg, key) {
        hasSources = true;
        if (!/^\w+$/.test(key.toString()))
            throw new Error('conf.sources.' + key + ' key must contain chars and digits only');
        if (typeof cfg !== 'object')
            throw new Error('conf.sources.' + key + ' must be an object');
        if (!cfg.hasOwnProperty('uri'))
            throw new Error('conf.sources.' + key + '.uri must be given');
        cfg.uri = normalizeUri(cfg.uri);
        if (typeof cfg.ref !== 'undefined' && typeof cfg.ref !== 'object') {
            throw new Error('conf.sources.' + key + '.ref must be an object');
        }
        if (typeof cfg.public === 'undefined') {
            cfg.public = false;
        } else if (typeof cfg.public !== 'boolean') {
            throw new Error('conf.sources.' + key + '.public must be boolean');
        }
    });
    _.each(conf.styles, function (cfg, key) {
        hasStyles = true;
        if (!/^\w+$/.test(key.toString()))
            throw new Error('conf.styles.' + key + ' key must contain chars and digits only');
        if (conf.sources.hasOwnProperty(key))
            throw new Error('conf.styles.' + key + ' key already exists in conf.sources');
        if (typeof cfg !== 'object')
            throw new Error('conf.styles.' + key + ' must be an object');
        if (typeof cfg.tm2 !== 'string')
            throw new Error('conf.styles.' + key + '.tm2 must be a string');
        cfg.tm2 = normalizePath(cfg.tm2);
        if (typeof cfg.source !== 'string' && typeof cfg.source !== 'number')
            throw new Error('conf.styles.' + key + '.source must be a string or a number');
        if (!conf.sources.hasOwnProperty(cfg.source))
            throw new Error('conf.styles.' + key + '.source "' + cfg.source + '" does not exist in conf.sources');
        if (typeof cfg.public === 'undefined') {
            cfg.public = false;
        } else if (typeof cfg.public !== 'boolean') {
            throw new Error('conf.sources.' + key + '.public must be boolean');
        }
    });
    if (!hasSources)
        throw new Error('conf.sources is empty');
    if (!hasStyles)
        throw new Error('conf.styles is empty');

    // Resolve the .ref values into uri parameters. Ordering of sources is important
    _.each(conf.sources, function (cfg) {
        if (cfg.ref) {
            _.each(cfg.ref, function(refId, refName) {
                if (!conf.sources.hasOwnProperty(refId))
                    throw new Error('Unknown source ' + refId);
                cfg.uri.query[refName] = conf.sources[refId].uri;
            });
        }
    });

    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-pro-fonts')), {recurse: true});
    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-default-fonts')), {recurse: true});

    require('tilelive-bridge').registerProtocols(tilelive);
    require('tilelive-file').registerProtocols(tilelive);
    require('./dynogen').registerProtocols(tilelive);
    require('./overzoomer').registerProtocols(tilelive);
    require('./cassandra').registerProtocols(tilelive);

    // Hack: wrapping source to use the configuration ID instead of the real source URI
    forwardingSource.conf = conf;
    tilelive.protocols['fwdsource:'] = forwardingSource;

    return BBPromise.all(_.map(conf.sources, function (cfg) {
        return tilelive
            .loadAsync(cfg.uri)
            .then(function(handler) {
                cfg.handler = handler;
                return true;
            });
    })).then(function () {
        return BBPromise.all(_.map(conf.styles, function (cfg) {
            return fsp
                .readFile(cfg.tm2, 'utf8')
                .then(function (xml) {
                    return new BBPromise(function (resolve, reject) {
                        // HACK: replace 'source' parameter with something we can recognize later
                        // Expected format:
                        // <Parameter name="source"><![CDATA[tmsource:///.../osm-bright.tm2source]]></Parameter>
                        var replCount = 0;
                        xml = xml.replace(
                            /(<Parameter name="source">)(<!\[CDATA\[)?(tmsource:\/\/\/)([^\n\]]*)(]]>)?(<\/Parameter>)/g,
                            function (whole, tag, cdata, prot, src, cdata2, tag2) {
                                replCount++;
                                return tag + cdata + 'fwdsource://./' + cfg.source + cdata2 + tag2;
                            }
                        );
                        if (replCount !== 1) {
                            throw new Error('Unable to find "source" parameter in style ' + cfg.tm2);
                        }
                        new Vector({
                            xml: xml,
                            base: pathLib.dirname(cfg.tm2)
                            //source: conf.sources[cfg.source].handler
                        }, function (err, style) {
                            if (err) {
                                return reject(err);
                            } else {
                                cfg.style = style;
                                return resolve(true);
                            }
                        });
                    });
                });
        }))
    }).then(function () {
        return _.extend({cache: conf.cache}, conf.sources, conf.styles);
    });
}

function forwardingSource(options, callback) {
    var err, handler;
    if (options.path[0] !== '/')
        err = Error('Unexpected path ' + options.path);
    else
        handler = forwardingSource.conf.sources[options.path.substr(1)].handler;
    callback(err, handler);
}

module.exports = {
    loadConfigurationAsync: loadConfigurationAsync,
    normalizePath: normalizePath
};
