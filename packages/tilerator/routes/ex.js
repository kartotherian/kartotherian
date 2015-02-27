'use strict';


var BBPromise = require('bluebird');
var preq = require('preq');
var sUtil = require('../lib/util');
var fs = BBPromise.promisifyAll(require('fs'));

// shortcut
var HTTPError = sUtil.HTTPError;


/**
 * The main router object
 */
var router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
var app;


/********************
 *  ERROR EXAMPLES  *
 ********************/


/**
 * GET /err/array
 * An example route creating an invalid array to show generic,
 * direct error handling
 */
router.get('/err/array', function(req, res) {

    // let's create an array with -1 elems!
    var arr = new Array(-1);
    // this is never reached
    res.send(arr.join());

});


/**
 * GET /err/file
 * Showcases promise error handling. The function is trying to
 * read a non-existent file, which will produce an error,
 * automatically handled by the template.
 */
router.get('/err/file', function(req, res) {

    // NOTE the return statement here, the promise
    // must be returned!
    // read the file
    return fs.readFileAsync('../mushrooms.txt')
    // and then send it back to the caller
    .then(function(text) {
        // note that this point is never reached
        res.send(text);
    });

});


/**
 * GET /err/manual/error
 * Throws a generic error manually
 */
router.get('/err/manual/error', function(req, res) {

    // simulate a constraint check
    var max = 50;
    if(max > 10) {
        throw new Error('A maximum value of 10 is expected, ' + max + ' given!');
    }

});


/**
 * GET /err/manual/deny
 * Denies access to this resource endpoint
 */
router.get('/err/manual/deny', function(req, res) {

    // don't allow access
    throw new HTTPError({
        status: 403,
        type: 'access_denied',
        title: 'Access denied',
        detail: 'No access is allowed to this endpoint'
    });

});


/**
 * GET /err/manual/auth
 */
router.get('/err/manual/auth', function(req, res) {

    // pretend to read a token file
    // again, note the return statement
    return fs.readFileAsync(__dirname + '/../static/index.html')
    // and pretend to compare it with what the user sent
    .then(function(token) {
        if(!req.params || req.params.token !== token) {
            // nope, not authorised to be here, sorry
            throw new HTTPError({
                status: 401,
                type: 'unauthorized',
                title: 'Unauthorized',
                detail: 'You are not authorized to fetch this endpoint!'
            });
        }
    });

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/ex',
        skip_domain: true,
        router: router
    };

};

