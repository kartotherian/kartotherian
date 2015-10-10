'use strict';

var pathLib = require('path');
var BBPromise = require('bluebird');
var core = require('kartotherian-core');

module.exports = function(app) {

    return BBPromise.try(function () {
        core.init(app.logger, pathLib.resolve(__dirname, '..'), function (module) {
            return require.resolve(module);
        }, require('tilelive'), require('mapnik'));

        core.registerSourceLibs(
            require('tilelive-bridge'),
            require('tilelive-vector'),
            require('kartotherian-autogen'),
            require('kartotherian-demultiplexer'),
            require('kartotherian-overzoom'),
            require('kartotherian-cassandra'),
            require('kartotherian-layermixer')
        );

        var sources = new core.Sources(app);
        return sources.init(app.conf.variables, app.conf.sources);
    }).then(function (sources) {
        return require('kartotherian-server').init({
            core: core,
            app: app,
            sources: sources
        });
    }).return(); // avoid app.js's default route initialization
};
