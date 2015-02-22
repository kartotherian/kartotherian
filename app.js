'use strict';

var http = require('http');
var BBPromise = require('bluebird');
var express = require('express');
var compression = require('compression');
var bodyParser = require('body-parser');
var multer = require('multer');
var fs = BBPromise.promisifyAll(require('fs'));


/**
 * Promise create an express app and initialize it
 * @param options
 * @returns {bluebird}
 */
function initApp(options) {
    // The main application object
    return BBPromise.resolve(express()).then(function(app){

        // get the options and make them available in the app
        app.logger = options.logger;    // the logging device
        app.metrics = options.metrics;  // the metrics
        app.conf = options.config;      // this app's config options
        app.info = require('./package.json'); // this app's package info

        // ensure some sane defaults
        if (!app.conf.hasOwnProperty('port')) { app.conf.port = 8888; }
        if (!app.conf.hasOwnProperty('interface')) { app.conf.interface = '0.0.0.0'; }
        if (!app.conf.hasOwnProperty('compressionLevel')) { app.conf.compressionLevel = 3; }

        // disable the X-Powered-By header
        app.set('x-powered-by', false);
        // disable the ETag header - users should provide them!
        app.set('etag', false);
        // enable compression
        app.use(compression({level: app.conf.compressionLevel}));
        // use the JSON body parser
        app.use(bodyParser.json());
        // use the application/x-www-form-urlencoded parser
        app.use(bodyParser.urlencoded({extended: true}));
        // use the multipart/form-data
        app.use(multer());
        // serve static files from static/
        app.use('/static', express.static(__dirname + '/static'));

        return app;
    });
}

/**
 * Async load all routes for the app
 * @param app
 * @returns {bluebird}
 */
function loadRoutes (app) {
    // get the list of files in routes/
    return fs
        .readdirAsync(__dirname + '/routes')
        .map(function (fname) {
            // ... and then load each route
            // but only if it's a js file
            if (!/\.js$/.test(fname)) {
                return;
            }
            // import the route file
            var route = require(__dirname + '/routes/' + fname);
            route = route(app);
            // check that the route exports the object we need
            if (route.constructor !== Object || !route.path || !route.router) {
                throw new Error('routes/' + fname + ' does not export the correct object!');
            }
            // all good, use that route
            app.use(route.path, route.router);
        }).then(function () {
            // route loading is now complete, return the app object
            return app;
        });
}

/**
 * Async create a web server
 * @param app
 * @returns {bluebird}
 */
function createServer(app) {
    // return a promise which creates an HTTP server,
    // attaches the app to it, and starts accepting
    // incoming client requests
    return new BBPromise(function (resolve) {
        http.createServer(app).listen(
            app.conf.port,
            app.conf.interface,
            resolve
        );
    }).then(function () {
        app.logger.log('info',
            'Worker ' + process.pid + ' listening on ' + app.conf.interface + ':' + app.conf.port);
    });
}

/**
 * The service's entry point. It takes over the configuration
 * options and the logger- and metrics-reporting objects from
 * service-runner and starts an HTTP server, attaching the application
 * object to it.
 */
module.exports = function(options) {
    return initApp(options)
        .then(loadRoutes)
        .then(createServer);
};
