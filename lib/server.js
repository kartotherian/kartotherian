'use strict';

var util = require('util');
var pathLib = require('path');
var _ = require('underscore');
var express = require('express');

var core, Err, app;

module.exports.init = function(opts) {

    core = opts.core;
    Err = core.Err;
    app = opts.app;

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
    var handlers = opts.requestHandlers || [];
    handlers.unshift(require('./tiles'), require('./info'));

    _.each(handlers, function(reqHandler) {
        reqHandler(core, router);
    });

    // Add before static to prevent disk IO on each tile request
    app.use('/', router);
    app.use('/', express.static(pathLib.resolve(__dirname, '../static'), staticOpts));
    app.use('/leaflet', express.static(pathLib.dirname(require.resolve('leaflet')), staticOpts));

    core.metrics.increment('init');
};
