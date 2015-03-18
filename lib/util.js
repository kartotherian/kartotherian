'use strict';


var BBPromise = require('bluebird');
var util = require('util');
var express = require('express');
var uuid = require('node-uuid');
var bunyan = require('bunyan');


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
 * Generates an object suitable for logging out of a request object
 *
 * @param {Request} the request
 * @return {Object} an object containing the key components of the request
 */
function reqForLog(req) {

    return {
        url: req.originalUrl,
        headers: req.headers,
        method: req.method,
        params: req.params,
        query: req.query,
        body: req.body,
        remoteAddress: req.connection.remoteAddress,
        remotePort: req.connection.remotePort
    };

}


/**
 * Serialises an error object in a form suitable for logging
 *
 * @param {Error} the error to serialise
 * @return {Object} the serialised version of the error
 */
function errForLog(err) {

    var ret = bunyan.stdSerializers.err(err);
    ret.status = err.status;
    ret.type = err.type;
    ret.detail = err.detail;

    return ret;

}

/**
 * Generates a unique request ID
 *
 * @return {String} the generated request ID
 */
var reqIdBuff = new Buffer(16);
function generateRequestId() {

    uuid.v4(null, reqIdBuff);
    return reqIdBuff.toString('hex');

}



/**
 * Wraps all of the given router's handler functions with
 * promised try blocks so as to allow catching all errors,
 * regardless of whether a handler returns/uses promises
 * or not.
 *
 * @param {Router} the router object
 * @param {Application} the application object
 */
function wrapRouteHandlers(router, app) {

    router.stack.forEach(function(routerLayer) {
        routerLayer.route.stack.forEach(function(layer) {
            var origHandler = layer.handle;
            layer.handle = function(req, res, next) {
                BBPromise.try(function() {
                    req.headers = req.headers || {};
                    req.headers['x-request-id'] = req.headers['x-request-id'] || generateRequestId();
                    req.logger = app.logger.child({request_id: req.headers['x-request-id']});
                    req.logger.log('trace/req', {req: reqForLog(req), msg: 'incoming request'});
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
        // adjust the log level based on the status code
        var level = 'error';
        if(Number.parseInt(errObj.status) < 400) {
            level = 'trace';
        } else if(Number.parseInt(errObj.status) < 500) {
            level = 'info';
        }
        // log the error
        req.logger.log(level +
                (errObj.component ? '/' + errObj.component : '/' + errObj.status),
                errForLog(errObj));
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


/**
 * Creates a new router with some default options.
 *
 * @param {Object} opts additional options to pass to express.Router()
 * @return {Router} a new router object
 */
function createRouter(opts) {

    var options = {
        mergeParams: true
    };

    if(opts && opts.constructor === Object) {
        Object.keys(opts).forEach(function(key) {
            options[key] = opts[key];
        });
    }

    return express.Router(options);

}


module.exports = {
    HTTPError: HTTPError,
    wrapRouteHandlers: wrapRouteHandlers,
    setErrorHandler: setErrorHandler,
    router: createRouter
};

