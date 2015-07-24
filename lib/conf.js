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

function resolveMap(map, mapname, uri, resolverFunc) {
    if (typeof map !== 'undefined' ) {
        if (typeof map !== 'object') {
            throw new Error(mapname + ' must be an object');
        }
        if (uri) {
            _.each(map, function(tagName, tagValue) {
                var val = resolverFunc ? resolverFunc(tagName) : tagName;
                if (tagValue === '') {
                    uri.pathname = val;
                } else {
                    uri.query[tagValue] = val;
                }
            });
        }
    }
}

function loadConfigurationAsync(app) {
    var log = app.logger.log.bind(app.logger);
    var confSource;
    if (typeof app.conf.sources === 'string') {
        var sourcesPath = pathLib.resolve(__dirname, '..', app.conf.sources);
         log('info', 'Loading sources configuration from ' + sourcesPath);
        confSource = fsp
            .readFile(sourcesPath)
            .then(yaml.safeLoad);
    } else {
        log('info', 'Loading sources configuration from the config file');
        confSource = BBPromise.resolve(app.conf);
    }
    return confSource.then(function(conf) {
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
            cfg.uri = util.normalizeUri(cfg.uri);
            // npm tag takes the dir path of the npm and uses it as a named url parameter, or the pathname if id is ""
            resolveMap(cfg.npm, 'conf.sources.' + key + '.npm', cfg.uri, util.getModulePath);
            // path tag uses the dir path as a named url parameter, or the pathname if id is ""
            resolveMap(cfg.path, 'conf.sources.' + key + '.path', cfg.uri);
            // Don't update yet, just validate
            resolveMap(cfg.ref, 'conf.sources.' + key + '.ref');
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
            // TODO: should provide the same capability as the source tag
            cfg.tm2 = util.getModulePath(cfg.tm2);
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
            // second pass, skip validation
            resolveMap(cfg.ref, '', cfg.uri, function (refId) {
                if (!conf.sources.hasOwnProperty(refId))
                    throw new Error('Unknown source ' + refId);
                return conf.sources[refId].uri;
            });
        });

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
                .then(function (handler) {
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
    loadConfigurationAsync: loadConfigurationAsync
};
