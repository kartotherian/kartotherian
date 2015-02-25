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
 * GET /
 * Gets some basic info about this service
 */
router.get('/', function(req, res) {

    // simple sync return
    res.json({
        name: app.info.name,
        version: app.info.version,
        description: app.info.description,
        home: app.info.homepage
    });

});


/**
 * GET /name
 * Gets the service's name as defined in package.json
 */
router.get('/name', function(req, res) {

    // simple return
    res.json({ name: app.info.name });

});


/**
 * GET /version
 * Gets the service's version as defined in package.json
 */
router.get('/version', function(req, res) {

    // simple return
    res.json({ version: app.info.version });

});


/**
 * ALL /home
 * Redirects to the service's home page if one is given,
 * returns a 404 otherwise
 */
router.all('/home', function(req, res) {

    var home = app.info.homepage;
    if(home && /^http/.test(home)) {
        // we have a home page URI defined, so send it
        res.redirect(301, home);
        return;
    } else {
        // no URI defined for the home page, error out
        res.status(404).end('No home page URL defined for ' + app.info.name);
    }

});


module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/_info',
        skip_domain: true,
        router: router
    };

};

