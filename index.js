'use strict';


var BBPromise = require('bluebird');
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
        app.logger = options.logger,    // the logging device
        app.metrics = options.metrics,  // the metrics
        app.conf = options.config       // this app's config options
        app.info = pkg_info             // this app's package info
        // ensure some sane defaults
        if(!app.conf.port) { app.conf.port = 8888 }
        if(!app.conf.interface) { app.conf.interface = '0.0.0.0' }
        // return a promise which creates an HTTP server,
        // attaches the app to it, and starts accepting
        // incoming client requests
        return new BBPromise(function(resolve) {
            http.createServer(app).listen(
                app.conf.port,
                app.conf.interface,
                resolve
            );
        }).then(function() {
            app.logger.log('info', 'Worker ' + process.pid + ' listening on '
                + app.conf.interface + ':' + app.conf.port);
        });
    });

}


if(module.parent === null) {
    // not included, so run the cluster manager
    var ServiceRunner = require('service-runner');
    return new ServiceRunner().run();
}

