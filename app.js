'use strict';


var BBPromise = require('bluebird');
var express = require('express');
var compression = require('compression');
var bodyParser = require('body-parser');
var multer = require('multer');

var fs = BBPromise.promisifyAll(require('fs'));


/**
 * The main application object
 */
var app = express();

/* Basic configuration */

// disable the X-Powered-By header
app.set('x-powered-by', false);
// disable the ETag header - users should provide them!
app.set('etag', false);
// enable compression
app.use(compression({level: 3}));
// use the JSON body parser
app.use(bodyParser.json());
// use the application/x-www-form-urlencoded parser
app.use(bodyParser.urlencoded({ extended: true }));
// use the multipart/form-data
app.use(multer());

/*** More configuration of app comes here ***/


module.exports = function() {

    // get the list of files in routes/
    return fs.readdirAsync(__dirname + '/routes')
    .map(function(fname) {
        // ... and then load each route
        // but only if it's a js file
        if(!/\.js$/.test(fname)) {
            return;
        }
        // import the route file
        var route = require(__dirname + '/routes/' + fname);
        route = route(app);
        // check that the route exports the object we need
        if(route.constructor !== Object || !route.path || !route.router) {
            throw new Error('routes/' + fname + ' does not export the correct object!');
        }
        // all good, use that route
        app.use(route.path, route.router);
    }).then(function() {
        // route loading is now complete, return the app object
        return app;
    });

};

