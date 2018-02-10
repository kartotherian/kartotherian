'use strict';

let pathLib = require('path'),
    Promise = require('bluebird'),
    core = require('@kartotherian/core'),
    info = require('../package.json');

module.exports = startup;

function startup(app) {

    return startup.bootstrap(app).then(function() {
        let sources = new core.Sources();
        return sources.init(app.conf.variables, app.conf.sources);
    }).then(function (sources) {
        var sourceKey, sourceConfig, sourceConfigs, frontendConfig = {};
        core.setSources(sources);

        sourceConfigs = sources.getSourceConfigs();

        for ( sourceKey in sourceConfigs ) {
            sourceConfig = sourceConfigs[sourceKey];
            if ( sourceConfig.public ) {
                frontendConfig[sourceKey] = {
                    maxZoom: sourceConfig.maxzoom
                };
            }
        }

        return require('@kartotherian/server').init({
            core: core,
            app: app,
            requestHandlers: core.loadNpmModules('requestHandlers'),
            config: frontendConfig
        });
    }).return(); // avoid app.js's default route initialization
}

startup.bootstrap = function bootstrap(app) {
    return Promise.try(function () {
        core.init(app, info.kartotherian, pathLib.resolve(__dirname, '..'),
            function (module) {
                return require(module);
            },
            function (module) {
                return require.resolve(module);
            }
        );
    });
};
