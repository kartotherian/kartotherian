'use strict';

var util = require('util');
var pathLib = require('path');
var BBPromise = require('bluebird');
var _ = require('underscore');
var express = require('express');

var abaculus = BBPromise.promisify(require('abaculus'));

var core, Err;
var app, sources;
var metrics;

var infoHeaders = {};

function reportError(errReporterFunc, err) {
    try {
        errReporterFunc(err);
    } catch (e2) {
        console.error('Unable to report: ' + core.errToStr(err) + '\n\nDue to: ' + core.errToStr(e2));
    }
}

function filterJson(query, data) {
    if ('summary' in query) {
        data = _(data).reduce(function (memo, layer) {
            memo[layer.name] = {
                features: layer.features.length,
                jsonsize: JSON.stringify(layer).length
            };
            return memo;
        }, {});
    } else if ('nogeo' in query) {
        // Recursively remove all "geometry" fields, replacing them with geometry's size
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
    return data;
}

/**
 * Web server (express) route handler to get requested tile, snapshot image, or info
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function requestHandler(req, res, next) {

    var start = Date.now();
    // These vars might get set before finishing validation.
    // Do not use them unless successful
    var isStatic, srcId, source, opts, z, x, y, scale, format, handler;

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
        var isInfoRequest = false;
        if (req.params.info) {
            if (req.params.info === 'pbfinfo' || req.params.info === 'info') {
                isInfoRequest = true;
                format = 'json';
            } else {
                throw new Err('Unexpected info type').metrics('err.req.info');
            }
        } else {
            format = req.params.format;
        }
        if (!isInfoRequest && format !== 'pbf' && !_.contains(source.formats, format)) {
            throw new Err('Format %s is not known', format).metrics('err.req.format');
        }
        if (format === 'pbf' || req.params.info === 'pbfinfo') {
            if (!source.pbfsource) {
                throw new Err('pbf access is not enabled for this source').metrics('err.req.pbf');
            }
            var pbfSrcId = source.pbfsource;
            source = sources.getSourceById(pbfSrcId);
            handler = sources.getHandlerById(pbfSrcId, true);
        } else {
            handler = sources.getHandlerById(srcId, true);
        }
        if (!handler) {
            throw new Err('The source has not started yet').metrics('err.req.source');
        }
        if (isInfoRequest) {
            return handler.getInfoAsync().then(function(info) {
                return [info, infoHeaders];
            });
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
        scale = req.params.scale;
        if (scale !== undefined) {
            if (!source.scales) {
                throw new Err('Scaling is not enabled for this source').metrics('err.req.scale');
            }
            if (!_.contains(source.scales, scale.toString())) {
                throw new Err('This scaling is not allowed for this source. Allowed: %s', source.scales.join())
                    .metrics('err.req.scale');
            }
            scale = parseFloat(scale);
        }

        isStatic = req.params.w !== undefined || req.params.h !== undefined;

        if (isStatic) {
            if (!source.static) {
                throw new Err('Static snapshot images are not enabled for this source').metrics('err.req.static');
            }
            if (format !== 'png' && format !== 'jpeg') {
                throw new Err('Format %s is not allowed for static images', format).metrics('err.req.stformat');
            }
            var lat = core.strToFloat(req.params.lat);
            var lon = core.strToFloat(req.params.lon);
            var w = core.strToInt(req.params.w);
            var h = core.strToInt(req.params.h);
            if (typeof lat !== 'number' || typeof lon !== 'number') {
                throw new Err('The lat and lon coordinates must be numeric for static images').metrics('err.req.stcoords');
            }
            if (!core.isInteger(w) || !core.isInteger(h)) {
                throw new Err('The width and height params must be integers for static images').metrics('err.req.stsize');
            }
            if (w > source.maxwidth || h > source.maxheight) {
                throw new Err('Requested image is too big').metrics('err.req.stsizebig');
            }
            var params = {
                zoom: z,
                scale: scale,
                center: {x: lon, y: lat, w: w, h: h},
                format: format,
                getTile: handler.getTile.bind(handler)
            };
            return abaculus(params);
        } else {
            x = core.strToInt(req.params.x);
            y = core.strToInt(req.params.y);
            if (!core.isValidCoordinate(x, z) || !core.isValidCoordinate(y, z)) {
                throw new Err('x,y coordinates are not valid, or not allowed for this zoom').metrics('err.req.coords');
            }
            if (format !== 'pbf') {
                opts = {format: format};
                if (scale) {
                    opts.scale = scale;
                }
            }
            return core.getTitleWithParamsAsync(handler, z, x, y, opts);
        }
    }).spread(function (data, dataHeaders) {
        // Allow JSON to be shortened to simplify debugging
        if (format === 'json') {
            data = filterJson(req.query, data);
        }

        var hdrs = {};
        if (app.conf.defaultHeaders) hdrs = _.extend(hdrs, app.conf.defaultHeaders);
        if (source.defaultHeaders) hdrs = _.extend(hdrs, source.defaultHeaders);
        if (dataHeaders) hdrs = _.extend(hdrs, dataHeaders);
        if (app.conf.overrideHeaders) hdrs = _.extend(hdrs, app.conf.overrideHeaders);
        if (source.headers) hdrs = _.extend(hdrs, source.headers);
        res.set(hdrs);
        if (format === 'json') {
            res.json(data);
        } else {
            res.send(data);
        }

        var mx = util.format('req.%s.%s', srcId, z);
        mx += '.' + format;
        if (isStatic) {
            mx += '.static';
        }
        if (scale) {
            // replace '.' with ',' -- otherwise grafana treats it as a divider
            mx += '.' + (scale.toString().replace('.', ','));
        }
        metrics.endTiming(mx, start);
    }).catch(function (err) {
        reportError(function (err) {
            res
                .status(400)
                .header('Cache-Control', 'public, s-maxage=30, max-age=30')
                .json(err.message || 'error/unknown');
            core.log('error', err);
            metrics.increment(err.metrics || 'err.unknown');
        }, err);
    }).catch(next);
}

module.exports.init = function(opts) {

    core = opts.core;
    Err = core.Err;
    app = opts.app;
    sources = opts.sources;
    metrics = app.metrics;

    var staticOpts = {};
    staticOpts.setHeaders = function (res) {
        if (app.conf.cache) {
            res.header('Cache-Control', app.conf.cache);
        }
        if (res.req.originalUrl.endsWith('.pbf')) {
            res.header('Content-Encoding', 'gzip');
        }
    };

    var router = express.Router();

    // get tile
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w]+)', requestHandler);
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/:z(\\d+)/:x(\\d+)/:y(\\d+)@:scale([\\.\\d]+)x.:format([\\w]+)', requestHandler);

    // get static image
    router.get('/img/:src(' + core.Sources.sourceIdReStr + '),:z(\\d+),:lat([-\\d\\.]+),:lon([-\\d\\.]+),:w(\\d+)x:h(\\d+).:format([\\w]+)', requestHandler);
    router.get('/img/:src(' + core.Sources.sourceIdReStr + '),:z(\\d+),:lat([-\\d\\.]+),:lon([-\\d\\.]+),:w(\\d+)x:h(\\d+)@:scale([\\.\\d]+)x.:format([\\w]+)', requestHandler);

    // get source info (json)
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/:info(pbfinfo).json', requestHandler);
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/:info(info).json', requestHandler);

    // Add before static to prevent disk IO on each tile request
    app.use('/', router);
    app.use('/', express.static(pathLib.resolve(__dirname, '../static'), staticOpts));
    app.use('/leaflet', express.static(pathLib.dirname(require.resolve('leaflet')), staticOpts));

    metrics.increment('init');
};
