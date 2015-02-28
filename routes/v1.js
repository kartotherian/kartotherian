'use strict';


var BBPromise = require('bluebird');
var preq = require('preq');
var domino = require('domino');
var sUtil = require('../lib/util');

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


/**
 * GET /siteinfo{/prop}
 * Fetches site info for the given domain, optionally
 * returning only the specified property. This example shows how to:
 * 1) use named URI parameters (by prefixing them with a colon)
 * 2) use optional URI parameters (by suffixing them with a question mark)
 * 3) extract URI parameters
 * 4) issue external requests
 * 5) use Promises to achieve (4) and return the result
 *
 * For more info about routing see http://expressjs.com/guide/routing.html
 *
 * There are multiple ways of calling this endpoint:
 * 1) GET /{domain}/v1/siteinfo/
 * 2) GET /{domain}/v1/siteinfo/mainpage (or other props available in
 *      the general siprop, as supported by MWAPI)
 */
router.get('/siteinfo/:prop?', function(req, res) {

    // construct the request for the MW Action API
    var apiReq = {
        uri: 'http://' + req.params.domain + '/w/api.php' ,
        body: {
            format: 'json',
            action: 'query',
            meta: 'siteinfo',
            continue: ''
        }
    };

    // send it
    // NOTE: preq uses bluebird, so we can safely chain it with a .then() call
    return preq.post(apiReq)
    // and then return the result to the caller
    .then(function(apiRes) {
        // preq returns the parsed object
        // check if the query succeeded
        if(apiRes.status !== 200 || !apiRes.body.query) {
            // there was an error in the MW API, propagate that
            throw new HTTPError({
                status: apiRes.status,
                type: 'api_error',
                title: 'MW API error',
                detail: apiRes.body
            });
        }
        // do we have to return only one prop?
        if(req.params.prop) {
            // check it exists in the response body
            if(apiRes.body.query.general[req.params.prop] === undefined) {
                // nope, error out
                throw new HTTPError({
                    status: 404,
                    type: 'not_found',
                    title: 'No such property',
                    detail: 'Property ' + req.params.prop + ' not found in MW API response!'
                });
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


/****************************
 *  PAGE MASSAGING SECTION  *
 ****************************/

/**
 * A helper function that obtains the HTML for a given title and
 * loads it into a domino DOM document instance.
 *
 * @param {String} domain the domain to contact
 * @param {String} title the title of the page to get
 * @return {Promise} a promise resolving as the HTML element object
 */
function getBody(domain, title) {

    // get the page
    return preq.get({
        uri: 'http://' + domain + '/w/index.php',
        query: {
            title: title
        }
    }).then(function(callRes) {
        // and then load and parse the page
        return BBPromise.resolve(domino.createDocument(callRes.body));
    });

}


/**
 * GET /page/{title}
 * Gets the body of a given page.
 */
router.get('/page/:title', function(req, res) {

    // get the page's HTML directly
    return getBody(req.params.domain, req.params.title)
    // and then return it
    .then(function(doc) {
        res.status(200).type('html').end(doc.body.innerHTML);
    });

});


/**
 * GET /page/{title}/lead
 * Gets the leading section of a given page.
 */
router.get('/page/:title/lead', function(req, res) {

    // get the page's HTML directly
    return getBody(req.params.domain, req.params.title)
    // and then find the leading section and return it
    .then(function(doc) {
        var leadSec = '';
        // find all paragraphs directly under the content div
        var ps = doc.querySelectorAll('#mw-content-text > p') || [];
        for(var idx = 0; idx < ps.length; idx++) {
            var child = ps[idx];
            // find the first paragraph that is not empty
            if(!/^\s*$/.test(child.innerHTML) ) {
                // that must be our leading section
                // so enclose it in a <div>
                leadSec = '<div id="lead_section">' + child.innerHTML + '</div>';
                break;
            }
        }
        res.status(200).type('html').end(leadSec);
    });

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/',
        api_version: 1,
        router: router
    };

};

