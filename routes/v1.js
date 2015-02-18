'use strict';


var express = require('express');
var fs = BBPromise.promisifyAll(require('fs'));
var yaml = require('js-yaml');


/**
 * The main router object
 */
var router = express.Router();

/**
 * The main application object reported when this module is require()d
 */
var app;


/**
 * GET /conf
 * Reads and returns the configuration file used to
 * start the service. IMPORTANT NOTE: This is a sample
 * only for demostrating promises, you should not
 * expose this endpoint in real services.
 */
router.get('/conf', function(req, res) {

    fs.readFileAsync(__dirname + '/../config.yaml')
    .then(function(src) {
        var config = yaml.safeLoad(src);
        res.json(config);
    });

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/v1',
        router: router
    };

};

