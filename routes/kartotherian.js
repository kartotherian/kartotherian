'use strict';

var pathLib = require('path');
var Promise = require('bluebird');
var core = require('kartotherian-core');

module.exports = function(app) {

    return Promise.try(function () {
        core.init(app, pathLib.resolve(__dirname, '..'), function (module) {
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
        core.setSources(sources);
        return require('kartotherian-server').init({
            core: core,
            app: app,
            requestHandlers: [
                require('kartotherian-maki'),
                require('kartotherian-snapshot')
            ]
        });
    }).return(); // avoid app.js's default route initialization
};
