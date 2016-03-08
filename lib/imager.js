'use strict';

var BBPromise = require('bluebird');
var abaculus = BBPromise.promisify(require('abaculus'), {multiArgs: true});

module.exports = {};

var core, metrics, app, Err, reportRequestError;

module.exports.init = function init(opts) {
    core = opts.core;
    Err = core.Err;
    app = opts.app;
    metrics = app.metrics;
    reportRequestError = opts.reportRequestError;
};

module.exports.render = function render(source, format, req, z, scale, handler) {
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
};
