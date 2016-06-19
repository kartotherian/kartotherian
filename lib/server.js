'use strict';

var Promise = require('bluebird');
var pathLib = require('path');
var express = require('express');

module.exports.init = function(opts) {

    return Promise.try(function () {
        var router = express.Router();

        var handlers = opts.requestHandlers || [];
        handlers.unshift(require('./tiles'), require('./info'));
        return Promise.mapSeries(handlers, function (reqHandler) {
            return reqHandler(opts.core, router);
        }).return(router);

    }).then(function (router) {
        // Add before static to prevent disk IO on each tile request
        var app = opts.app,
            staticOpts = {
                setHeaders: function (res) {
                    if (app.conf.cache) {
                        res.header('Cache-Control', app.conf.cache);
                    }
                    if (res.req.originalUrl.endsWith('.pbf')) {
                        res.header('Content-Encoding', 'gzip');
                    }
                }
            };

        app.use('/', router);
        app.use('/', express.static(pathLib.resolve(__dirname, '../static'), staticOpts));
        app.use('/leaflet', express.static(pathLib.dirname(require.resolve('leaflet')), staticOpts));

        opts.core.metrics.increment('init');
    });
};
