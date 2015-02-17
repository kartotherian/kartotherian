'use strict';


var express = require('express');


/**
 * The main router object
 */
var router = express.Router();

/**
 * The main application object reported when this module is require()d
 */
var app;


/** 
 * GET /
 * Gets some basic info about this service
 */
router.get('/', function(req, res) {

    // simple sync return
    res.json({
        name: app.locals.name,
        version: app.locals.version,
        description: app.locals.description,
        homepage: app.locals.homepage
    });

});


/**
 * GET /name
 * Gets the service's name as defined in package.json
 */
router.get('/name', function(req, res) {

    // simple return
    res.json({ name: app.locals.name });

});


/** 
 * GET /version
 * Gets the service's version as defined in package.json
 */
router.get('/version', function(req, res) {

    // simple return
    res.json({ version: app.locals.version });

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/_info',
        router: router
    };

};

