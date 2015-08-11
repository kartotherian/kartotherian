'use strict';

var util = require('util');
var BBPromise = require('bluebird');
var _ = require('underscore');
var express = require('express');
var router = require('../lib/util').router();
var pathLib = require('path');

var core = require('kartotherian-core');
var Err = core.Err;

var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

var sources;
var defaultHeaders, overrideHeaders;
var metrics;
var maxZoom = 20;

function reportError(errReporterFunc, err) {
    try {
        errReporterFunc(err);
    } catch (e2) {
        console.error('Unable to report: ' +
            ((err.body && (err.body.stack || err.body.detail)) || err.stack || err) +
            '\n\nDue to: ' +
            ((e2.body && (e2.body.stack || e2.body.detail)) || e2.stack || e2));
    }
}

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    //var log = app.logger.log.bind(app.logger);

    return BBPromise.try(function () {
        metrics = app.metrics;
        metrics.increment('init');

        core.registerProtocols(require('tilelive-bridge'), tilelive);
        core.registerProtocols(require('tilelive-file'), tilelive);
        //core.registerProtocols(require('./dynogen'), tilelive);
        core.registerProtocols(require('kartotherian-overzoom'), tilelive);
        core.registerProtocols(require('kartotherian-cassandra'), tilelive);
        core.registerProtocols(require('tilelive-vector'), tilelive);

        var resolver = function (module) {
            return require.resolve(module);
        };
        app.use('/static/leaflet', express.static(core.sources.getModulePath('leaflet', resolver), core.getStaticOpts(app.conf)));

        return core.sources.initAsync(app, tilelive, resolver, pathLib.resolve(__dirname, '..'))
    }).then(function (srcs) {
        sources = srcs;
        defaultHeaders = app.conf.defaultHeaders || {};
        overrideHeaders = app.conf.headers || {};
    }).catch(function (err) {
        reportError(function (err) {
            app.logger.log('fatal', err);
        }, err);
        process.exit(1);
    });
}

/**
 * Web server (express) route handler to get requested tile
 * @param req request object
 * @param res response object
 */
function getTile(req, res) {

    var start = Date.now();
    // These vars might get set before finishing validation.
    // Do not use them unless successful
    var srcId, source, opts, z, x, y;

    return BBPromise.try(function () {
        srcId = req.params.src;
        if (!sources) {
            throw new Err('The service has not started yet');
        }
        if (!sources.hasOwnProperty(srcId)) {
            throw new Err('Unknown source %s', srcId).metrics('err.req.source');
        }
        source = sources[srcId];
        if (!source.public) {
            throw new Err('Source %s not public', srcId).metrics('err.req.source');
        }
        z = req.params.z | 0;
        x = req.params.x | 0;
        y = req.params.y | 0;

        if (!core.isInteger(z) || !core.isInteger(x) || !core.isInteger(y) || z < 0 || z > maxZoom || x < 0 || y < 0) {
            throw new Err('z,x,y must be positive integers').metrics('err.req.coords');
        }
        var maxCoord = Math.pow(2, z);
        if (x >= maxCoord || y >= maxCoord) {
            throw new Err('x,y exceeded max allowed for this zoom').metrics('err.req.coords');
        }
        if (source.minzoom !== undefined && z < source.minzoom) {
            throw new Err('Minimum zoom is %d', source.minzoom).metrics('err.req.zoom');
        }
        if (source.maxzoom !== undefined && z > source.maxzoom) {
            throw new Err('Maximum zoom is %d', source.maxzoom).metrics('err.req.zoom');
        }

        if (source.formats) {
            if (!_.contains(source.formats, req.params.format)) {
                throw new Err('Format %s is not known', req.params.format).metrics('err.req.format');
            }
            opts = {format: req.params.format};

            // For now, if format is allowed, so is scale. We might want to introduce another source config param later
            var scale = req.params.scale ? req.params.scale[1] | 0 : undefined;
            scale = scale > 4 ? 4 : scale; // limits scale to 4x (1024 x 1024 tiles or 288dpi)
            if (scale) {
                opts.scale = scale;
            }
        }
        return core.getTitleWithParamsAsync(source.handler, z, x, y, opts);
    }).spread(function (data, dataHeaders) {
        if (opts && opts.format === 'json') {
            if ('summary' in req.query) {
                data = _(data).reduce(function (memo, layer) {
                    memo[layer.name] = {
                        features: layer.features.length,
                        jsonsize: JSON.stringify(layer).length
                    };
                    return memo;
                }, {});
            } else if ('nogeo' in req.query) {
                var filter = function (val, key) {
                    if (key === 'geometry') {
                        return val.length;
                    } else if (_.isArray(val)) {
                        return _.map(val, filter);
                    } else if (_.isObject(val)) {
                        _.each(val, function (v, k) {
                            val[k] = filter(v, k);
                        });
                    }
                    return val;
                };
                data = _.map(data, filter);
            }
        }

        var hdrs = {};
        if (defaultHeaders) hdrs = _.extend(hdrs, defaultHeaders);
        if (source.defaultHeaders) hdrs = _.extend(hdrs, source.defaultHeaders);
        if (dataHeaders) hdrs = _.extend(hdrs, dataHeaders);
        if (overrideHeaders) hdrs = _.extend(hdrs, overrideHeaders);
        if (source.headers) hdrs = _.extend(hdrs, source.headers);
        res.set(hdrs);
        res.send(data);

        var mx = util.format('req.%s.%s', srcId, z);
        if (opts) {
            mx += '.' + opts.format;
            if (opts.scale) {
                mx += '.' + opts.scale;
            }
        }
        metrics.endTiming(mx, start);
    }).catch(function (err) {
        reportError(function (err) {
            res
                .status(400)
                .header('Cache-Control', 'public, s-maxage=30, max-age=30')
                .json(err.message || 'error/unknown');
            req.logger.log(err);
            metrics.increment(err.metrics || 'err.unknown');
        }, err);
    });
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
