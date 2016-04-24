'use strict';

var BBPromise = require('bluebird');
var makizushi = BBPromise.promisify(require('makizushi'));

module.exports = {};

var metrics, app, Err, reportRequestError;

module.exports.init = function init(opts, router) {
    Err = opts.core.Err;
    app = opts.app;
    metrics = app.metrics;
    reportRequestError = opts.reportRequestError;

    // marker icon generator  (base, size, symbol, color, scale), with the symbol being optional
    // /v4/marker/pin-m-cafe+7e7e7e@2x.png -- the format matches that of mapbox to simplify their library usage
    router.get('/v4/marker/:base([\\w]+)-:size([sml])\\+:color([a-f0-9]+).png', markerHandler);
    router.get('/v4/marker/:base([\\w]+)-:size([sml])\\+:color([a-f0-9]+)@:scale([\\.\\d]+)x.png', markerHandler);
    router.get('/v4/marker/:base([\\w]+)-:size([sml])-:symbol([-\\w]+)\\+:color([a-f0-9]+).png', markerHandler);
    router.get('/v4/marker/:base([\\w]+)-:size([sml])-:symbol([-\\w]+)\\+:color([a-f0-9]+)@:scale([\\.\\d]+)x.png', markerHandler);
};

/**
 * Web server (express) route handler to get a marker icon
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function markerHandler(req, res, next) {

    var start = Date.now(),
        params = req.params,
        metric = ['marker'];

    return BBPromise.try(function () {

        metric.push(params.base);
        metric.push(params.size);
        metric.push(params.symbol ? params.symbol : '-');

        if (params.color.length !== 3 && params.color.length !== 6) {
            throw new Err('Bad color').metrics('err.marker.color');
        }
        metric.push(params.color);

        var isRetina;
        if (params.scale === undefined) {
            isRetina = false;
        } else if (params.scale === '2') {
            metric.push(params.scale);
            isRetina = true;
        } else {
            throw new Err('Only retina @2x scaling is allowed for marks').metrics('err.marker.scale');
        }

        return makizushi({
            base: params.base, // "pin"
            size: params.size, // s|m|l
            symbol: params.symbol, // undefined, digit, letter, or maki symol name - https://www.mapbox.com/maki/
            tint: params.color, // in hex - "abc" or "aabbcc"
            retina: isRetina // true|false
        });
    }).then(function (data) {
        if (app.conf.defaultHeaders) res.set(app.conf.defaultHeaders);
        if (app.conf.overrideHeaders) res.set(app.conf.overrideHeaders);
        res.type('png').send(data);
        metrics.endTiming(metric.join('.'), start);
    }).catch(function(err) {
        return reportRequestError(err, res);
    }).catch(next);
}
