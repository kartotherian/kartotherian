'use strict';

var router = require('express').Router();

/**
 * GET /robots.txt
 * no indexing
 */
router.get('/robots.txt', function(req, res) {
    res.end( 'User-agent: *\nDisallow: /\n' );
});

module.exports = function(appObj) {

    return {
        path: '/',
        router: router
    };

};
