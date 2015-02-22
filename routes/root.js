'use strict';

var router = require('express').Router();

/**
 * GET /robots.txt
 * no indexing
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
        router: router
    };

};
