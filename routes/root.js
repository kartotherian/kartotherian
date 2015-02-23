'use strict';


var express = require('express');


/**
 * The main router object
 */
var router = express.Router();


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
        router: router
    };

};

