'use strict';


var express = require('express');
var preq = require('preq');


/**
 * The main router object
 */
var router = express.Router();

/**
 * The main application object reported when this module is require()d
 */
var app;


/**
 * GET /siteinfo/{uri}{/prop}
 * Fetches site info for a wiki with the given URI, optionally
 * returning only the specified property. This example shows how to:
 * 1) use named URI parameters (by prefixing them with a double colon)
 * 2) use optional URI parameters (by suffixing them with a question mark)
 * 3) extract URI parameters
 * 4) issue external requests
 * 5) use Promises to achieve (4) and return the result
 *
 * There are multiple ways of calling this endpoint:
 * 1) GET /v1/siteinfo/en.wikipedia.org
 * 2) GET /v1/siteinfo/en.wikipedia.org/mainpage (or other props available in
 *      the general siprop, as supported by MWAPI)
 */
router.get('/siteinfo/:uri/:prop?', function(req, res) {

    // construct the request for the MW Action API
    var apiReq = {
        uri: 'http://' + req.params.uri + '/w/api.php' ,
        body: {
            format: 'json',
            action: 'query',
            meta: 'siteinfo',
            continue: ''
        }
    };

    // send it
    // NOTE: preq uses bluebird, so we can safely chain it with a .then() call
    preq.post(apiReq)
    // and then return the result to the caller
    .then(function(apiRes) {
        // preq returns the parsed object
        // check if the query succeeded
        if(apiRes.status !== 200 || !apiRes.body.query) {
            // there was an error in the MW API, propagate that
            res.status(apiRes.status).json(apiRes.body);
            return;  // important for it to be here!
        }
        // do we have to return only one prop?
        if(req.params.prop) {
            // check it exists in the response body
            if(apiRes.body.query.general[req.params.prop] === undefined) {
                // nope, error out
                res.status(404).end('Property ' + req.params.prop + ' not found in MW API response!');
                return;  // watch out not to continue this method!
            }
            // ok, return that prop
            var ret = {};
            ret[req.params.prop] = apiRes.body.query.general[req.params.prop];
            res.status(200).json(ret);
            return;
        }
        // set the response code as returned by the MW API
        // and return the whole response (contained in body.query.general)
        res.status(200).json(apiRes.body.query.general);
    });

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/v1',
        router: router
    };

};

