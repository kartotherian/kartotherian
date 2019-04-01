const Promise = require('bluebird');
const pathLib = require('path');
const express = require('express');
const compression = require('compression');
const tiles = require('./tiles');
const info = require('./info');

module.exports.init = function init(opts) {
  return Promise.try(() => {
    const router = express.Router();
    const handlers = opts.requestHandlers || [];

    handlers.unshift(tiles, info);
    return Promise.mapSeries(handlers, reqHandler => reqHandler(opts.core, router)).return(router);
  }).then((router) => {
    // Add before static to prevent disk IO on each tile request
    const { app } = opts;
    const staticOpts = {
      setHeaders(res) {
        if (app.conf.cache) {
          res.header('Cache-Control', app.conf.cache);
        }
        if (res.req.originalUrl.endsWith('.pbf')) {
          res.header('Content-Encoding', 'gzip');
        }
      },
    };

    app.use('/', router);

    // Compression is nativelly handled by the tiles, so only statics need its
    app.use(compression({ threshold: 0 }));
    app.use('/', express.static(pathLib.resolve(__dirname, '../static'), staticOpts));
    app.use('/leaflet', express.static(pathLib.dirname(require.resolve('leaflet')), staticOpts));

    opts.core.metrics.increment('init');
  });
};
