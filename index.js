'use strict';


var http = require('http');
var pkg_info = require('./package.json');
var appModule = require('./app');


/**
 * The service's entry point. It takes over the configuration
 * options and the logger- and metrics-reporting objects from
 * servisor and starts an HTTP server, attaching the application
 * object to it.
 */
module.exports = function(options) {

    var app;

    // get the application object
    return appModule()
    .then(function(appObj) {
        app = appObj;
        // get the options and make them available in the app
        app.locals.logger = options.logger,    // the logging device
        app.locals.metrics = options.metrics,  // the metrics
        app.locals.conf = options.config       // this app's config options
        app.locals.info = pkg_info             // this app's package info
        // for convenience:
        app.locals.name = pkg_info.name;
        app.locals.version = pkg_info.version;
        app.locals.description = pkg_info.description;
        app.locals.homepage = pkg_info.homepage;
        // ensure some sane defaults
        if(!app.locals.conf.port) { app.locals.conf.port = 8888 }
        if(!app.locals.conf.interface) { app.locals.conf.interface = '0.0.0.0' }
        // return a promise which creates an HTTP server,
        // attaches the app to it, and starts accepting
        // incoming client requests
        return new Promise(function(resolve) {
            http.createServer(app).listen(
                app.locals.conf.port,
                app.locals.conf.interface,
                resolve
            );
        }).then(function() {
            app.locals.logger.log('info', 'Worker ' + process.pid + ' listening on '
                + app.locals.conf.interface + ':' + app.locals.conf.port);
        });
    });

}


if(module.parent === null) {
    // not included, so run the cluster manager
    var Servisor = require('servisor');
    return new Servisor().run();
}

