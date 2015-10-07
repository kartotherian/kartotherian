'use strict';

var BBPromise = require('bluebird');

var core = require('kartotherian-core');
var Err = core.Err;

var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

module.exports = function(app) {

    return BBPromise.try(function () {
        core.init(app.logger, require('path').resolve(__dirname, '..'), function (module) {
            return require.resolve(module);
        });

        core.safeLoadAndRegister([
            'tilelive-bridge',
            'tilelive-file',
            'tilelive-vector',
            'kartotherian-autogen',
            'kartotherian-demultiplexer',
            'kartotherian-overzoom',
            'kartotherian-cassandra',
            'kartotherian-layermixer'
        ], tilelive);

        var sources = new core.Sources(app, tilelive);
        return sources.loadVariablesAsync(app.conf.variables).return(sources);
    }).then(function (sources) {
        return sources.loadSourcesAsync(app.conf.sources).return(sources);
    }).then(function (sources) {
        return require('kartotherian-server').init({
            app: app,
            sources: sources,
            metrics: app.metrics,
            defaultHeaders: app.conf.defaultHeaders,
            overrideHeaders: app.conf.headers,
            staticCacheHeaders: app.conf.cache
        }).return(); // avoid app.js's default route initialization
    });
};
