'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var fsp = require('fs-promise');
var pathLib = require('path');
var util = require('./util');

var mapnik = require('mapnik');
var Vector = require('tilelive-vector');
var bridge = require('tilelive-bridge');
var filestore = require('tilelive-file');
var tilelive = require('tilelive');
//var dynogen = require('./dynogen');

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

function loadConfiguration(conf, tmsource) {
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
        if (typeof cfg.enabled === 'undefined') {
            cfg.enabled = true;
        } else if (typeof cfg.enabled !== 'boolean') {
            throw new Error('conf.sources.' + key + '.enabled must be boolean');
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
    });
    if (!hasSources)
        throw new Error('conf.sources is empty');
    if (!hasStyles)
        throw new Error('conf.styles is empty');

    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-pro-fonts')), {recurse: true});
    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-default-fonts')), {recurse: true});
    bridge.registerProtocols(tilelive);
    filestore.registerProtocols(tilelive);
    //dynogen.registerProtocols(tilelive);

    var p = BBPromise.all(_.map(conf.sources, function (cfg) {
        return new BBPromise(function (fulfill, reject) {
            tilelive.load(cfg.uri, function (err, handler) {
                if (err) {
                    return reject(err);
                } else {
                    cfg.handler = handler;
                    return fulfill(true);
                }
            });
        });
    }));
    if (tmsource) {
        p = p.then(function () {
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
                                    return tag + cdata + prot + cfg.source + cdata2 + tag2;
                                }
                            );
                            if (replCount !== 1) {
                                throw new Error('Unable to find "source" parameter in style ' + cfg.tm2);
                            }
                            new Vector({
                                xml: xml,
                                base: pathLib.dirname(cfg.tm2)
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
        });
    }
    return p.then(function () {
        return _.extend({ cache: conf.cache }, conf.sources, conf.styles);
    });
}


module.exports = {
    loadConfiguration: loadConfiguration,
    normalizePath: normalizePath
};
