'use strict';

var pathLib = require('path');
var Promise = require('bluebird');
var core = require('kartotherian-core');
var info = require('../package.json');

module.exports = function(app) {

    return Promise.try(function () {
        core.init(app, info.kartotherian, pathLib.resolve(__dirname, '..'),
            function (module) {
                return require(module);
            },
            function (module) {
                return require.resolve(module);
            }
        );
        var sources = new core.Sources(app);
        return sources.init(app.conf.variables, app.conf.sources);
    }).then(function (sources) {
        core.setSources(sources);
        return require('kartotherian-server').init({
            core: core,
            app: app,
            requestHandlers: core.loadNpmModules('requestHandlers')
        });
    }).return(); // avoid app.js's default route initialization
};
