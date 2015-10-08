'use strict';

var pathLib = require('path');
var BBPromise = require('bluebird');
var core = require('kartotherian-core');
var server = require('kartotherian-server');
var tilelive = require('tilelive');

var Err = core.Err;
BBPromise.promisifyAll(tilelive);


module.exports = function(app) {

    return BBPromise.try(function () {
        core.init(app.logger, pathLib.resolve(__dirname, '..'), function (module) {
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
        return sources.init(app.conf.variables, app.conf.sources);
    }).then(function (sources) {
        return server.init({
            app: app,
            sources: sources
        });
    }).return(); // avoid app.js's default route initialization
};
