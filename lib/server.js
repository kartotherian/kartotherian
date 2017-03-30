'use strict';

let Promise = require('bluebird'),
    pathLib = require('path'),
    express = require('express'),
    compression = require('compression');

module.exports.init = function(opts) {

    return Promise.try(function () {
        let router = express.Router(),
            handlers = opts.requestHandlers || [];

        handlers.unshift(require('./tiles'), require('./info'));
        return Promise.mapSeries(handlers, function (reqHandler) {
            return reqHandler(opts.core, router);
        }).return(router);

    }).then(function (router) {
        // Add before static to prevent disk IO on each tile request
        let app = opts.app,
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

        // Compression is nativelly handled by the tiles, so only statics need its
        app.use(compression());
        app.use('/', express.static(pathLib.resolve(__dirname, '../static'), staticOpts));
        app.use('/leaflet', express.static(pathLib.dirname(require.resolve('leaflet')), staticOpts));

        opts.core.metrics.increment('init');
    });
};
