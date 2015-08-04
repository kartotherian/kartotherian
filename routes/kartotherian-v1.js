'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var express = require('express');

var core = require('kartotherian-core');
var storage = require('../lib/storage');

var router = require('../lib/util').router();
var Vector = require('tilelive-vector');
var pathLib = require('path');

var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

var fs = require("fs");
BBPromise.promisifyAll(fs);

var conf;
var vectorHeaders = {'Content-Encoding': 'gzip'};
var rasterHeaders = {}; // {'Content-Type': 'image/png'};


function sendReplyAsync(state) {
    return new BBPromise(function(resolve, reject) {
        var res = state.response;
        if (state.error) {
            throw Error(state.error);
        } else {
            if (state.data) {
                res.set(state.headers);
                res.send(state.data);
                resolve(state);
            } else {
                storage.sendResponse(state).then(resolve, reject);
            }
        }
    });
}

function stateToPromise(state) {
    // Ensure that this promise does not start until needed
    return new BBPromise(function(resolve/*, reject*/) {
        if (!state.source.style) {
            // This is a data source, init storage & set headers
            storage.initState(state);
            if (!state.headers) {
                state.headers = state.isRaster ? rasterHeaders : vectorHeaders;
            }
        }
        resolve(state);
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

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    //app.set('json spaces', 4);
    var log = app.logger.log.bind(app.logger);

    core.registerProtocols(require('tilelive-bridge'), tilelive);
    core.registerProtocols(require('tilelive-file'), tilelive);
    //core.registerProtocols(require('./dynogen'), tilelive);
    core.registerProtocols(require('kartotherian-overzoom'), tilelive);
    core.registerProtocols(require('kartotherian-cassandra'), tilelive);

    var resolver = function (module) {
        return require.resolve(module);
    };

    app.use('/static/leaflet', express.static(core.getModulePath('leaflet', resolver), core.getStaticOpts(app.conf)));

    // todo: need to crash if this fails to load
    // todo: implement dynamic configuration reloading
    core.loadConfigurationAsync(app, tilelive, resolver)
        .then(function(conf) {
            // Hack: wrapping source to use the configuration ID instead of the real source URI
            forwardingSource.conf = conf;
            tilelive.protocols['fwdsource:'] = forwardingSource;

            return BBPromise.all(_.map(conf.styles, function (cfg) {
                return fs
                    .readFileAsync(cfg.tm2, 'utf8')
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
            })).return(conf);
        }).then(function (c) {
            conf = _.extend({cache: c.cache}, c.sources, c.styles);
        })
        .catch(function (err) {
            console.error((err.body && (err.body.stack || err.body.detail)) || err.stack || err);
            process.exit(1);
        });
}

function getTileFromStore(state) {
    state.isRaster = false;
    switch (state.format) {
        case 'png':
        case 'webp':
        case 'jpeg':
            state.isRaster = true;
            // fallthrough
        case 'vector.pbf':
            // If storage is set up, try to get tile there first
            // If missing, or no storage but can generate, generate it
            // If tile generated and source.saveGenerated is true, save it
            if (state.source.cacheDir) {
                return stateToPromise(state)
                    .then(sendReplyAsync)
                    .catch(function (err) {
                        // Failed, probably due to missing file
                        if (!state.source.generate) throw err;
                        return storage.generateVector(state)
                            .then(sendReplyAsync)
                    });
            } else {
                return stateToPromise(state)
                    .then(storage.generateVector)
                    .then(sendReplyAsync);
            }

        case 'vector.pbf.generate':
        case 'vector.pbf.force':
            // Refresh tile if it doesn't ecist, or force regenerate
            state.regenerate = state.format === 'vector.pbf.force';
            return stateToPromise(state)
                .then(storage.ensureVectorExists)
                .then(function (state) {
                    state.response.send(state.storageState);
                });

        default:
            throw new Error('Unknown format');
    }
}

function getTileFromStyle(state) {
    var getStyleAsync = function(state) {
        return new BBPromise(function (resolve, reject) {
            var callback = function (err, data, headers) {
                if (err) {
                    reject(err);
                } else {
                    if ('summary' in state.response.req.query) {
                        data = _(data).reduce(function (memo, layer) {
                            memo[layer.name] = {
                                features: layer.features.length,
                                jsonsize: JSON.stringify(layer).length
                            };
                            return memo;
                        }, {});
                    } else if ('nogeo' in state.response.req.query) {
                        var filter = function (val, key) {
                            if (key === 'geometry') {
                                return val.length;
                            } else if (_.isArray(val)) {
                                return _.map(val, filter);
                            } else if (_.isObject(val)) {
                                _.each(val, function(v, k) {
                                    val[k] = filter(v, k);
                                });
                            }
                            return val;
                        };
                        data = _.map(data, filter);
                    }
                    state.data = data;
                    state.headers = headers;
                    resolve(state);
                }
            };
            callback.scale = state.scale;
            callback.format = state.format;
            state.source.style.getTile(state.z, state.x, state.y, callback);
        });
    };

    switch (state.format) {
        case 'json':
        case 'headers':
        case 'svg':
        case 'png':
        case 'jpeg':
            return stateToPromise(state)
                .then(getStyleAsync)
                .then(sendReplyAsync);
        default:
            throw new Error('Unknown format');
    }
}

/**
 * Web server (express) route handler to get requested tile
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function getTile(req, res, next) {

    if (conf.cache) {
        res.header('Cache-Control', conf.cache);
    }

    var scale = (req.params.scale) ? req.params.scale[1] | 0 : undefined;
    scale = scale > 4 ? 4 : scale; // limits scale to 4x (1024 x 1024 tiles or 288dpi)

    if (!conf.hasOwnProperty(req.params.src)) {
        throw new Error('Unknown source');
    }
    var source = conf[req.params.src];
    if (!source.public) {
        throw new Error('Source not public');
    }

    var state = {
        source: source,
        z: req.params.z | 0,
        x: req.params.x | 0,
        y: req.params.y | 0,
        format: req.params.format,
        scale: scale,
        response: res
    };

    return !source.style ? getTileFromStore(state) : getTileFromStyle(state);
}

router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w\\.]+)', getTile);
router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x).:format([\\w\\.]+)', getTile);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
