'use strict';


var BBPromise = require('bluebird');
var util = require('util');


/**
 * Error instance wrapping HTTP error responses
 */
function HTTPError(response) {

    Error.call(this);
    Error.captureStackTrace(this, HTTPError);

    if(response.constructor !== Object) {
        // just assume this is just the error message
        var msg = response;
        response = {
            status: 500,
            type: 'internal_error',
            title: 'InternalError',
            detail: msg
        };
    }

    this.name = this.constructor.name;
    this.message = response.status + '';
    if(response.type) {
        this.message += ': ' + response.type;
    }

    for (var key in response) {
        this[key] = response[key];
    }

}

util.inherits(HTTPError, Error);


/**
 * Wraps all of the given router's handler functions with
 * promised try blocks so as to allow catching all errors,
 * regardless of whether a handler returns/uses promises
 * or not.
 *
 * @param {Router} the router object
 */
function wrapRouteHandlers(router) {

    router.stack.forEach(function(routerLayer) {
        routerLayer.route.stack.forEach(function(layer) {
            var origHandler = layer.handle;
            layer.handle = function(req, res, next) {
                BBPromise.try(function() {
                    return origHandler(req, res, next);
                })
                .catch(next);
            };
        });
    });

}


/**
 * Generates an error handler for the given applications
 * and installs it. Usage:
 *
 * @param {Application} app the application object to add the handler to
 */
function setErrorHandler(app) {

    app.use(function(err, req, res, next) {
        var errObj;
        // ensure this is an HTTPError object
        if(err.constructor === HTTPError) {
            errObj = err;
        } else if(err instanceof Error) {
            // is this an HTTPError defined elsewhere? (preq)
            if(err.constructor.name === 'HTTPError') {
                var o = { status: err.status };
                if(err.body && err.body.constructor === Object) {
                    Object.keys(err.body).forEach(function(key) {
                        o[key] = err.body[key];
                    });
                } else {
                    o.detail = err.body;
                }
                o.message = err.message;
                errObj = new HTTPError(o);
            } else {
                // this is a standard error, convert it
                errObj = new HTTPError({
                    status: 500,
                    type: 'internal_error',
                    title: err.name,
                    detail: err.message,
                    stack: err.stack
                });
            }
        } else if(err.constructor === Object) {
            // this is a regular object, suppose it's a response
            errObj = new HTTPError(err);
        } else {
            // just assume this is just the error message
            errObj = new HTTPError({
                status: 500,
                type: 'internal_error',
                title: 'InternalError',
                detail: err
            });
        }
        // ensure some important error fields are present
        if(!errObj.status) { errObj.status = 500; }
        if(!errObj.type) { errObj.type = 'internal_error'; }
        // add the offending URI and method as well
        if(!errObj.method) { errObj.method = req.method; }
        if(!errObj.uri) { errObj.uri = req.url; }
        // some set 'message' or 'description' instead of 'detail'
        errObj.detail = errObj.detail || errObj.message || errObj.description || '';
        // log the error
        app.logger.log('error/' + app.info.name +
                (errObj.component ? '/' + errObj.component : '/' + err.status), errObj);
        // let through only non-sensitive info
        var respBody = {
            status: errObj.status,
            type: errObj.type,
            title: errObj.title,
            detail: errObj.detail,
            method: errObj.method,
            uri: errObj.uri
        };
        res.status(errObj.status).json(respBody);
    });

}


module.exports = {
    HTTPError: HTTPError,
    wrapRouteHandlers: wrapRouteHandlers,
    setErrorHandler: setErrorHandler
};

