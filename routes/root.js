'use strict';


var sUtil = require('../lib/util');


/**
 * The main router object
 */
var router = sUtil.router();


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


module.exports = function(appObj) {

    return {
        path: '/',
        skip_domain: true,
        router: router
    };

};

