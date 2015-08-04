'use strict';


var http = require('http');
var BBPromise = require('bluebird');
var express = require('express');
var compression = require('compression');
var bodyParser = require('body-parser');
var fs = BBPromise.promisifyAll(require('fs'));
var sUtil = require('./lib/util');
var packageInfo = require('./package.json');
var yaml = require('js-yaml');


/**
 * Creates an express app and initialises it
 * @param {Object} options the options to initialise the app with
 * @return {bluebird} the promise resolving to the app object
 */
function initApp(options) {

    // the main application object
    var app = express();

    // get the options and make them available in the app
    app.logger = options.logger;    // the logging device
    app.metrics = options.metrics;  // the metrics
    app.conf = options.config;      // this app's config options
    app.info = packageInfo;         // this app's package info

    // ensure some sane defaults
    if(!app.conf.port) { app.conf.port = 8888; }
    if(!app.conf.interface) { app.conf.interface = '0.0.0.0'; }
    if(!app.conf.compression_level) { app.conf.compression_level = 3; }
    if(app.conf.cors === undefined) { app.conf.cors = '*'; }
    if(!app.conf.csp) {
        app.conf.csp =
            "default-src 'self'; object-src 'none'; media-src *; img-src *; style-src *; frame-ancestors 'self'";
    }

    // set outgoing proxy
    if(app.conf.proxy) {
        process.env.HTTP_PROXY = app.conf.proxy;
        // if there is a list of domains which should
        // not be proxied, set it
        if(app.conf.no_proxy_list) {
            if(Array.isArray(app.conf.no_proxy_list)) {
                process.env.NO_PROXY = app.conf.no_proxy_list.join(',');
            } else {
                process.env.NO_PROXY = app.conf.no_proxy_list;
            }
        }
    }

    // set up the spec
    if(!app.conf.spec) {
        app.conf.spec = __dirname + '/spec.yaml';
    }
    if(app.conf.spec.constructor !== Object) {
        try {
            app.conf.spec = yaml.safeLoad(fs.readFileSync(app.conf.spec));
        } catch(e) {
            app.logger.log('warn/spec', 'Could not load the spec: ' + e);
            app.conf.spec = {};
        }
    }
    if(!app.conf.spec.swagger) {
        app.conf.spec.swagger = '2.0';
    }
    if(!app.conf.spec.info) {
        app.conf.spec.info = {
            version: app.info.version,
            title: app.info.name,
            description: app.info.description
        };
    }
    app.conf.spec.info.version = app.info.version;
    if(!app.conf.spec.paths) {
        app.conf.spec.paths = {};
    }

    // set the CORS and CSP headers
    app.all('*', function(req, res, next) {
        if(app.conf.cors !== false) {
            res.header('Access-Control-Allow-Origin', app.conf.cors);
            res.header('Access-Control-Allow-Headers', 'Accept, X-Requested-With, Content-Type');
        }
        res.header('X-XSS-Protection', '1; mode=block');
        res.header('X-Content-Type-Options', 'nosniff');
        res.header('X-Frame-Options', 'SAMEORIGIN');
        res.header('Content-Security-Policy', app.conf.csp);
        res.header('X-Content-Security-Policy', app.conf.csp);
        res.header('X-WebKit-CSP', app.conf.csp);
        next();
    });

    // disable the X-Powered-By header
    app.set('x-powered-by', false);
    // disable the ETag header - users should provide them!
    app.set('etag', false);
    // enable compression
    app.use(compression({level: app.conf.compression_level}));
    // use the JSON body parser
    app.use(bodyParser.json());
    // use the application/x-www-form-urlencoded parser
    app.use(bodyParser.urlencoded({extended: true}));
    // serve static files from static/
    app.use('/static', express.static(__dirname + '/static'));

    return BBPromise.resolve(app);

}


/**
 * Loads all routes declared in routes/ into the app
 * @param {Application} app the application object to load routes into
 * @returns {bluebird} a promise resolving to the app object
 */
function loadRoutes (app) {

    // get the list of files in routes/
    return fs.readdirAsync(__dirname + '/routes')
    .map(function (fname) {
        // ... and then load each route
        // but only if it's a js file
        if(!/\.js$/.test(fname)) {
            return;
        }
        // import the route file
        var route = require(__dirname + '/routes/' + fname);
        route = route(app);
        // check that the route exports the object we need
        if(route.constructor !== Object || !route.path || !route.router || !(route.api_version || route.skip_domain)) {
            throw new TypeError('routes/' + fname + ' does not export the correct object!');
        }
        // wrap the route handlers with Promise.try() blocks
        sUtil.wrapRouteHandlers(route.router, app);
        // determine the path prefix
        var prefix = '';
        if(!route.skip_domain) {
            prefix = '/:domain/v' + route.api_version;
        }
        // all good, use that route
        app.use(prefix + route.path, route.router);
    }).then(function () {
        // catch errors
        sUtil.setErrorHandler(app);
        // route loading is now complete, return the app object
        return BBPromise.resolve(app);
    });

}

/**
 * Creates and start the service's web server
 * @param {Application} app the app object to use in the service
 * @returns {bluebird} a promise creating the web server
 */
function createServer(app) {

    // return a promise which creates an HTTP server,
    // attaches the app to it, and starts accepting
    // incoming client requests
    var server;
    return new BBPromise(function (resolve) {
        server = http.createServer(app).listen(
            app.conf.port,
            app.conf.interface,
            resolve
        );
    }).then(function () {
        app.logger.log('info',
            'Worker ' + process.pid + ' listening on ' + app.conf.interface + ':' + app.conf.port);
        return server;
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

