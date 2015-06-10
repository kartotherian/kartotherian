'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var fsp = require('fs-promise');
var pathLib = require('path');

var mapnik = require('mapnik');
var Vector = require('tilelive-vector');
var bridge = require('tilelive-bridge');
var tilelive = require('tilelive');

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param path
 * @returns {*}
 */
function normalizePath(path) {
    return pathLib.resolve(__dirname, '..', path);
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
        if (typeof cfg.tm2source !== 'string')
            throw new Error('conf.sources.' + key + '.tm2source must be a string');
        cfg.tm2source = normalizePath(cfg.tm2source);
        if (typeof cfg.generate !== 'boolean')
            throw new Error('conf.sources.' + key + '.generate must be boolean');
        if (typeof cfg.saveGenerated !== 'boolean')
            throw new Error('conf.sources.' + key + '.saveGenerated must be boolean');
        if (cfg.saveGenerated && !cfg.generate)
            throw new Error('conf.sources.' + key + '.generate must be true when saveGenerated is true');
        if (typeof cfg.mbtiles === 'undefined') {
            cfg.mbtiles = {}
        } else if (typeof conf.styles !== 'object') {
            throw new Error('conf.sources.' + key + '.mbtiles must be an object');
        } else {
            _.each(conf.mbtiles, function (maxCount, zoom) {

            });
        }

        if (typeof cfg.cacheBaseDir !== 'undefined') {
            if (typeof cfg.cacheBaseDir !== 'string')
                throw new Error('conf.sources.' + key + '.cacheBaseDir must be a string');
            cfg.cacheDir = pathLib.join(normalizePath(cfg.cacheBaseDir), key);
        } else if (cfg.saveGenerated) {
            throw new Error('conf.sources.' + key + '.cacheBaseDir must be set if saveGenerated is true');
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
        if (typeof cfg.sourceId !== 'string' && typeof cfg.sourceId !== 'number')
            throw new Error('conf.styles.' + key + '.sourceId must be a string or a number');
        if (!conf.sources.hasOwnProperty(cfg.sourceId))
            throw new Error('conf.styles.' + key + '.sourceId "' + cfg.sourceId + '" does not exist in conf.sources');
    });
    if (!hasSources)
        throw new Error('conf.sources is empty');
    if (!hasStyles)
        throw new Error('conf.styles is empty');

    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-pro-fonts')), {recurse: true});
    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-default-fonts')), {recurse: true});
    bridge.registerProtocols(tilelive);
    tilelive.protocols['tmsource:'] = tmsource;

    return BBPromise.all(_.map(conf.sources, function (cfg) {
        return new BBPromise(function (fulfill, reject) {
            tilelive.load('bridge://' + cfg.tm2source, function (err, source) {
                if (err) {
                    return reject(err);
                } else {
                    cfg.source = source;
                    return fulfill(true);
                }
            });
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
                                return tag + cdata + prot + cfg.sourceId + cdata2 + tag2;
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
    }).then(function () {
        return _.extend({
            cache: conf.cache,
        }, conf.sources, conf.styles);
    });
}


module.exports = {
    loadConfiguration: loadConfiguration,
};
