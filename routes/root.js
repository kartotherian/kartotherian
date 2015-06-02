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
 * GET /_spec
 * Retrieves the service's specification JSON
 */
router.get('/_spec', function(req, res) {

    res.json(app.conf.spec);

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/',
        skip_domain: true,
        router: router
    };

};

