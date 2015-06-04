'use strict';


var sUtil = require('../lib/util');


/**
 * The main router object
 */
var router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
var app;


/**
 * GET /robots.txt
 * Instructs robots no indexing should occur on this domain.
 */
router.get('/robots.txt', function(req, res) {

    res.set({
        'User-agent': '*',
        'Disallow': '/'
    }).end();

});


/**
 * GET /
 * Main entry point. Currently it only responds if the spec query
 * parameter is given, otherwise lets the next middleware handle it
 */
router.get('/', function(req, res, next) {

    if(!(req.query || {}).hasOwnProperty('spec')) {
        next();
    } else {
        res.json(app.conf.spec);
    }

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/',
        skip_domain: true,
        router: router
    };

};

