'use strict';

let util = require('util'),
    Err = require('@kartotherian/err'),
    Promise = require('bluebird'),
    abaculus = Promise.promisify(require('@mapbox/abaculus'), {multiArgs: true}),
    Overlay = require('@mapbox/tilelive-overlay'),
    _ = require('underscore'),
    checkType = require('@kartotherian/input-validator'),
    makeDomainValidator = require('domain-validator'),
    autoPosition = require('./autoPosition');

let core, mapdataLoader, parseProtocol, mapnik;

module.exports = function snapshot(cor, router) {
    core = cor;

    mapnik = core.mapnik;

    let allowedDomains = core.getConfiguration().allowedDomains,
        httpsDomains = makeDomainValidator(allowedDomains ? allowedDomains.https : undefined, true),
        httpDomains = makeDomainValidator(allowedDomains ? allowedDomains.http : undefined, true);

    parseProtocol = domain => {
        if (httpsDomains.test(domain)) {
            return 'https';
        } else if (httpDomains.test(domain)) {
            return 'http';
        } else {
            throw new Err('Domain is not allowed').metrics('err.req.domain');
        }
    };

    if (allowedDomains) {
        mapdataLoader = require('./mapdataLoader');
    }

    // get static image
    router.get('/img/:src(' + core.Sources.sourceIdReStr + '),:zoom(a|\\d+),:lat(a|[-\\d\\.]+),:lon(a|[-\\d\\.]+),:w(\\d+)x:h(\\d+):scale(@[\\.\\d]+x)?.:format([\\w]+)?', requestHandler);
};

/**
 * Create a parameters object for Abaculus
 * @param params
 * @param tileSource
 * @return {{zoom: number, scale: number, center: {y: number, x: number, w: number, h: number}, format: string, getTile: function}}
 */
function makeParams(params, tileSource) {
    return {
        zoom: params.zoom,
        scale: params.scale,
        center: {
            y: Math.min(85, Math.max(-85, params.lat)),
            x: Math.min(180, Math.max(-180, params.lon)),
            w: params.w,
            h: params.h
        },
        format: params.format,
        getTile: function(z, x, y, cb) {
            if ( typeof tileSource.getAsync === 'function' ) {
                const opts = {
                    type: 'tile',
                    z: z,
                    x: x,
                    y: y,
                    lang: params.lang
                };
                return tileSource.getAsync(opts).then(
                    data => cb(undefined, data.data, data.headers)
                ).catch(err => cb(err));
            } else {
                // source is old school and can't receive lang param
                return tileSource.getTile(z, x, y, cb);
            }
        }
    };
}

/**
 * Magical float regex found in http://stackoverflow.com/a/21664614/177275
 * @type {RegExp}
 */
let floatRe = /^-?\d+(?:[.,]\d*?)?$/;

/**
 * Converts value to float if possible, or returns the original
 */
function strToFloat(value) {
    if (typeof value === 'string' && floatRe.test(value)) {
        return parseFloat(value);
    }
    return value;
};

/**
 * Web server (express) route handler to get a snapshot image
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function requestHandler(req, res, next) {

    let source, protocol,
        params = req && req.params,
        qparams = req && req.query,
        start = Date.now();

    return Promise.try(() => {
        source = core.getPublicSource(params.src);

        if (qparams.lang) {
            params.lang = qparams.lang;
        }

        if (params.scale !== undefined) {
            // From "@2x", remove first and last characters
            params.scale = params.scale.substring(1, params.scale.length - 1);
        }
        params.scale = core.validateScale(params.scale, source);

        // Overlays only support 2x scaling, so if scale is less than <1.5x, drop to 1x, otherwise - 2x
        params.scale = (!params.scale || params.scale < 1.5) ? 1 : 2;

        // Abaculus(?) doesn't position images with scale != 1
        params.scale = 1;

        if (!source.static) {
            throw new Err('Static snapshot images are not enabled for this source').metrics('err.req.static');
        }
        if (params.format !== 'png' && params.format !== 'jpeg' || !_.contains(source.formats, params.format)) {
            throw new Err('Format %s is not allowed for static images', params.format).metrics('err.req.stformat');
        }
        params.w = checkType.strToInt(params.w);
        params.h = checkType.strToInt(params.h);

        if (!Number.isInteger(params.w) || !Number.isInteger(params.h)) {
            throw new Err('The width and height params must be integers for static images').metrics('err.req.stsize');
        }
        if (params.w > source.maxwidth || params.h > source.maxheight) {
            throw new Err('Requested image is too big').metrics('err.req.stsizebig');
        }

        let noOverlay = !qparams.domain && !qparams.title,
            useAutoCentering = params.lat === 'a' || params.lon === 'a',
            useAutoZooming = params.zoom === 'a',
            useAutoPositioning = useAutoCentering || useAutoZooming;

        if (useAutoCentering && params.lat !== params.lon) { // `lat` and `lon` should be set to `a`
            throw new Err('Both latitude and longitude must be numbers, or they must both be set to the letter "a" for auto positioning').metrics('err.req.stauto');
        }

        if (noOverlay) {
            if (useAutoPositioning) {
                throw new Err('Auto zoom or positioning is only allowed when both domain and title are present').metrics('err.req.stauto');
            }

            // For now returns JPEG without overlays
            params.lat = strToFloat(params.lat);
            params.lon = strToFloat(params.lon);
            params.zoom = core.validateZoom(params.zoom, source);
            if (typeof params.lat !== 'number' || typeof params.lon !== 'number') {
                throw new Err('The lat and lon coordinates must be numeric for static images').metrics('err.req.stcoords');
            }
            return abaculus(makeParams(params, source.getHandler()));
        }

        if (!mapdataLoader) {
            throw new Err('Snapshot overlays are disabled, conf.allowedDomains is not set').metrics('err.req.stdisabled');
        }
        if (!qparams.domain || !qparams.title) {
            throw new Err('Both domain and title params are required').metrics('err.req.stboth');
        }
        if (qparams.groups) {
            qparams.groups = qparams.groups.split(',');
        } else {
            throw new Err('A comma-separated list of groups is required').metrics('err.req.stgroups');
        }
        if (params.format !== 'png') {
            throw new Err('Only png format is allowed for images with overlays').metrics('err.req.stnonpng');
        }
        if (qparams.title.indexOf('|') !== -1) {
            throw new Err('title param may not contain pipe "|" symbol').metrics('err.req.stpipe');
        }
        protocol = parseProtocol(qparams.domain);

        let baseMapHdrs = {};

        return mapdataLoader(
            protocol, qparams.domain, qparams.title, qparams.groups
        ).then(geojson => {
            let mapPosition;

            if (useAutoPositioning) {
                mapPosition = autoPosition(params, geojson);
                params.lon = mapPosition.longitude;
                params.lat = mapPosition.latitude;
                params.zoom = mapPosition.zoom;
            } else {
                params.lat = strToFloat(params.lat);
                params.lon = strToFloat(params.lon);
            }
            params.zoom = core.validateZoom(params.zoom, source);

            let renderBaseMap = abaculus(makeParams(params, source.getHandler())).spread((data, headers) => {
                baseMapHdrs = headers;
                return mapnik.Image.fromBytesAsync(data);
            }).then(
                image => image.premultiplyAsync()
            );


            // This is far from ideal - we should be using geojson-mapnikify directly
            let renderOverlayMap = Promise.try(() => new Promise((accept, reject) => {

                // Render overlay layer
                let url = 'overlaydata://' + (params.scale === 2 ? '2x:' : '') + JSON.stringify( geojson );
                new Overlay( url, (err, overlay) => {
                    if ( err ) reject( err );
                    accept( overlay );
                })
            })).then(
                overlay => abaculus(makeParams(params, overlay))
            ).then(
                overlayBuf => mapnik.Image.fromBytesAsync(overlayBuf[0])
            ).then(
                image => image.premultiplyAsync()
            );

            return Promise.join(
                renderBaseMap,
                renderOverlayMap,
                (baseImage, overlayImage) => {

                    return baseImage.compositeAsync(overlayImage);
                    // }).then(image => {
                    //     // Not sure if this step is needed - result appears identical
                    //     return image.demultiplyAsync();
                }
            );
        })
        .then(
            image => image.encodeAsync('png8:m=h:z=9')
        ).then(
            image => [image, baseMapHdrs]
        );

    }).spread((data, dataHeaders) => {
        core.setResponseHeaders(res, source, dataHeaders);

        res.send(data);

        let mx = util.format('req.%s.%s.%s.static', params.src, params.zoom, params.format);
        if (params.scale) {
            // replace '.' with ',' -- otherwise grafana treats it as a divider
            mx += '.' + (params.scale.toString().replace('.', ','));
        }
        core.metrics.endTiming(mx, start);
    }).catch(
        err => core.reportRequestError(err, res)
    ).catch(next);
}
