'use strict';

var util = require('util');
var Promise = require('bluebird');
var abaculus = Promise.promisify(require('abaculus'), {multiArgs: true});
var _ = require('underscore');
var makeDomainValidator = require('domain-validator');

var downloadMapdata, addGeoJson, parseProtocol;

var core, Err;

module.exports = function snapshot(coreV, router) {
    core = coreV;
    Err = core.Err;

    var allowedDomains = core.getConfiguration().allowedDomains,
        httpsDomains = makeDomainValidator(allowedDomains ? allowedDomains.https : undefined, true),
        httpDomains = makeDomainValidator(allowedDomains ? allowedDomains.http : undefined, true);

    parseProtocol = function (domain) {
        if (httpsDomains.test(domain)) {
            return 'https';
        } else if (httpDomains.test(domain)) {
            return 'http';
        } else {
            throw new Err('Domain is not allowed').metrics('err.req.domain');
        }
    };

    if (allowedDomains) {
        downloadMapdata = require('./load-mapdata');
        addGeoJson = require('./overlayer');
    }

    // get static image
    router.get('/img/:src(' + core.Sources.sourceIdReStr + '),:z(\\d+),:lat([-\\d\\.]+),:lon([-\\d\\.]+),:w(\\d+)x:h(\\d+).:format([\\w]+)', requestHandler);
    router.get('/img/:src(' + core.Sources.sourceIdReStr + '),:z(\\d+),:lat([-\\d\\.]+),:lon([-\\d\\.]+),:w(\\d+)x:h(\\d+)@:scale([\\.\\d]+)x.:format([\\w]+)', requestHandler);
};

/**
 * Web server (express) route handler to get a snapshot image
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function requestHandler(req, res, next) {

    var source, handler, protocol,
        params = req && req.params,
        qparams = req && req.query,
        abaculusParams,
        start = Date.now();

    return Promise.try(function () {
        source = core.getPublicSource(params.src);

        params.z = core.validateZoom(params.z, source);
        params.scale = core.validateScale(params.scale, source);

        if (!source.static) {
            throw new Err('Static snapshot images are not enabled for this source').metrics('err.req.static');
        }
        if (params.format !== 'png' && params.format !== 'jpeg' || !_.contains(source.formats, params.format)) {
            throw new Err('Format %s is not allowed for static images', params.format).metrics('err.req.stformat');
        }
        params.lat = core.strToFloat(params.lat);
        params.lon = core.strToFloat(params.lon);
        params.w = core.strToInt(params.w);
        params.h = core.strToInt(params.h);
        if (typeof params.lat !== 'number' || typeof params.lon !== 'number') {
            throw new Err('The lat and lon coordinates must be numeric for static images').metrics('err.req.stcoords');
        }
        if (!core.isInteger(params.w) || !core.isInteger(params.h)) {
            throw new Err('The width and height params must be integers for static images').metrics('err.req.stsize');
        }
        if (params.w > source.maxwidth || params.h > source.maxheight) {
            throw new Err('Requested image is too big').metrics('err.req.stsizebig');
        }

        handler = source.getHandler();
        abaculusParams = {
            zoom: params.z,
            scale: params.scale,
            center: {
                lat: Math.min(85, Math.max(-85, params.lat)),
                lon: Math.min(180, Math.max(-180, params.lon)),
                w: params.w,
                h: params.h
            },
            format: params.format,
            getTile: handler.getTile.bind(handler)
        };

        if (!qparams.domain && !qparams.title) {
            // For now returns JPEG without overlays
            return abaculus(abaculusParams);
        }

        if (!downloadMapdata) {
            throw new Err('Snapshot overlays are disabled, conf.allowedDomains is not set').metrics('err.req.stdisabled');
        }
        if (!qparams.domain || !qparams.title) {
            throw new Err('Both domain and title params are required').metrics('err.req.stboth');
        }
        if (params.format !== 'png') {
            throw new Err('Only png format is allowed for images with overlays').metrics('err.req.stnonpng');
        }
        if (qparams.title.indexOf('|') !== -1) {
            throw new Err('title param may not contain pipe "|" symbol').metrics('err.req.stpipe');
        }
        protocol = parseProtocol(qparams.domain);

        return Promise.all([
            downloadMapdata(protocol, qparams.domain, qparams.title, qparams.groups),
            abaculus(abaculusParams)
        ]).spread(function (geojson, bufAndHdr) {
            return addGeoJson(bufAndHdr[0], bufAndHdr[1], abaculusParams, geojson);
        });

    }).spread(function (data, dataHeaders) {
        core.setResponseHeaders(res, source, dataHeaders);

        res.send(data);

        var mx = util.format('req.%s.%s.%s.static', params.src, params.z, params.format);
        if (params.scale) {
            // replace '.' with ',' -- otherwise grafana treats it as a divider
            mx += '.' + (params.scale.toString().replace('.', ','));
        }
        core.metrics.endTiming(mx, start);
    }).catch(function(err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}
