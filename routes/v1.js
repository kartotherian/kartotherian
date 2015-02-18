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
 * GET/POST/HEAD /wiki{/url}
 * Fetches site info for a wiki with the given URI. This example shows how to:
 * 1) manage multiple methods for the same URI (using router.all)
 * 2) use named URI parameters (by prefixing them with a double colon)
 * 3) use optional URI parameters (by suffixing them with a question mark)
 * 4) extract URI and query parameters, as well as body data
 * 5) issue external requests
 * 6) use Promises to achieve (5) and return the result
 *
 * There are multiple ways of calling this endpoint:
 * 1) GET /v1/wiki/en.wikipedia.org
 * 2) GET /v1/wiki?uri=en.wikipedia.org
 * 3) POST /v1/wiki (with body: uri=en.wikipedia.org)
 * 4) HEAD (with the URI as in (1) or (2))
 */
router.all('/wiki/:uri?', function(req, res) {

    var uri;
    var method = req.method.toLowerCase();

    // first, allow only GET, POST and HEAD methods, and
    // response with a 200 for HEAD right away
    if(method === 'head') {
        res.status(200).set('Connection', 'Close').end();
        return; // needs to be here!
    } else if(!/^(get|post)$/.test(method)) {
        res.status(404).end();
        return; // needs to be here!
    }

    // let's try to find out how did the user supply the parameter
    if(req.params && req.params.uri) {
        // the caller used the optional path segment
        uri = req.params.uri;
    } else if(req.query && req.query.uri) {
        // the user supplied the URI in the query parameter
        uri = req.query.uri;
    } else if(req.body && req.body.uri) {
        // the users issued a POST request and put the URI in the body
        uri = req.body.uri;
    } else {
        // nothing of the above, error out
        res.status(400).end();
        return; // don't forget this one!
    }

    // construct the request
    var apiReq = {
        uri: 'http://' + uri + '/w/api.php' ,
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
        // preq returns the parsed object, so we can use res.json
        // to send the response body back to the client
        // set the response code as returned by the MW API
        res.status(apiRes.status).json(apiRes.body);
    });

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/v1',
        router: router
    };

};

