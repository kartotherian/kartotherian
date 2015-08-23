'use strict';

var util = require('util');
var BBPromise = require('bluebird');
var _ = require('underscore');
var express = require('express');
var router = require('../lib/util').router();

var core = require('kartotherian-core');
var Err = core.Err;

var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

var abaculus = BBPromise.promisify(require('abaculus'));

var sources;
var defaultHeaders, overrideHeaders;
var metrics;
var maxZoom = 20;

function reportError(errReporterFunc, err) {
    try {
        errReporterFunc(err);
    } catch (e2) {
        console.error('Unable to report: ' + core.errToStr(err) + '\n\nDue to: ' + core.errToStr(e2));
    }
}

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    return BBPromise.try(function () {
        core.init(app.logger, require('path').resolve(__dirname, '..'), function (module) {
            return require.resolve(module);
        });
        metrics = app.metrics;
        metrics.increment('init');
        core.safeLoadAndRegister([
            'tilelive-bridge',
            'tilelive-file',
            'tilelive-vector',
            'kartotherian-autogen',
            'kartotherian-overzoom',
            'kartotherian-cassandra',
            'kartotherian-layermixer'
        ], tilelive);

        sources = new core.Sources(app, tilelive);

        defaultHeaders = app.conf.defaultHeaders || {};
        overrideHeaders = app.conf.headers || {};

        app.use('/static/leaflet', express.static(sources.getModulePath('leaflet'), core.getStaticOpts(app.conf)));
        return sources.loadAsync(app.conf);
    }).catch(function (err) {
        reportError(function (err) {
            core.log('fatal', err);
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
    var isStatic, srcId, source, opts, z, x, y, scale, format;

    return BBPromise.try(function () {
        if (!sources) {
            throw new Err('The service has not started yet');
        }
        srcId = req.params.src;
        source = sources.getSourceById(srcId, true);
        if (!source) {
            throw new Err('Unknown source').metrics('err.req.source');
        }
        if (!source.public) {
            throw new Err('Source is not public').metrics('err.req.source');
        }
        if (!source.handler) {
            throw new Err('The source has not started yet').metrics('err.req.source');
        }
        z = core.strToInt(req.params.z);
        if (!core.isValidZoom(z)) {
            throw new Err('invalid zoom').metrics('err.req.coords');
        }
        if (source.minzoom !== undefined && z < source.minzoom) {
            throw new Err('Minimum zoom is %d', source.minzoom).metrics('err.req.zoom');
        }
        if (source.maxzoom !== undefined && z > source.maxzoom) {
            throw new Err('Maximum zoom is %d', source.maxzoom).metrics('err.req.zoom');
        }
        if (req.params.scale) {
            if (!source.maxscale) {
                throw new Err('Scaling is not enabled for this source').metrics('err.req.scale');
            }
            // Do not allow scale === 1, because that would allow two types of requests for the same data,
            // which is not very good for caching (otherwise we would have to normalize URLs in Varnish)
            scale = parseInt(req.params.scale[1]);
            if (scale < 2 || scale > source.maxscale) {
                throw new Err('Scaling parameter must be between 2 and %d', source.maxscale).metrics('err.req.scale');
            }
        }
        if (source.formats) {
            if (!_.contains(source.formats, req.params.format)) {
                throw new Err('Format %s is not known', req.params.format).metrics('err.req.format');
            }
            format = req.params.format;
        }

        isStatic = req.params.w || req.params.h;

        if (isStatic) {
            if (format !== 'png' && format !== 'jpeg') {
                throw new Err('Format %s is not allowed for static images', req.params.format).metrics('err.req.stformat');
            }
            x = core.strToFloat(req.params.x);
            y = core.strToFloat(req.params.y);
            var w = core.strToInt(req.params.w);
            var h = core.strToInt(req.params.h);
            if (typeof x !== 'number' || typeof y !== 'number') {
                throw new Err('The x and y coordinates must be numeric for static images').metrics('err.req.stcoords');
            }
            if (!core.isInteger(w) || !core.isInteger(h)) {
                throw new Err('The width and height params must be integers for static images').metrics('err.req.stsize');
            }
            var params = {
                zoom: z,
                scale: scale,
                center: {x: x, y: y, w: w, h: h},
                format: format,
                getTile: source.handler.getTile.bind(source.handler)
            };
            return abaculus(params);
        } else {
            x = core.strToInt(req.params.x);
            y = core.strToInt(req.params.y);
            if (!core.isValidCoordinate(x, z) || !core.isValidCoordinate(y, z)) {
                throw new Err('x,y coordinates are not valid, or not allowed for this zoom').metrics('err.req.coords');
            }
            if (source.pbfsource && req.params.format === 'pbf') {
                // Allow direct PBF access
                source = sources.getSourceById(source.pbfsource);
            } else if (format) {
                opts = {format: format};
                if (scale) {
                    opts.scale = scale;
                }
            }
            return core.getTitleWithParamsAsync(source.handler, z, x, y, opts);
        }
    }).spread(function (data, dataHeaders) {
        // Allow JSON to be shortened to simplify debugging
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
        if (isStatic) {
            mx += '.static';
        }
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
            core.log(err);
            metrics.increment(err.metrics || 'err.unknown');
        }, err);
    });
}

// get tile
router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w\\.]+)', getTile);
router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x).:format([\\w\\.]+)', getTile);

// get static image
// anything is accepted for x and y because float number regex is not handled well here
// [-+]?\\d*\\.?\\d+
router.get('/:src(\\w+)/:z(\\d+)/:x/:y/:w(\\d+)/:h(\\d+).:format([\\w\\.]+)', getTile);
router.get('/:src(\\w+)/:z(\\d+)/:x/:y/:w(\\d+)/:h(\\d+):scale(@\\d+x).:format([\\w\\.]+)', getTile);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
