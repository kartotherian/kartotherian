'use strict';


var express = require('express');
var fs = BBPromise.promisifyAll(require('fs'));

/**
 * The main application object
 */
var app = express();


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

