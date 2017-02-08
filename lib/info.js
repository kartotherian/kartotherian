'use strict';

let util = require('util'),
    Promise = require('bluebird');

let core, Err,
    infoHeaders = {};

module.exports = function info(coreV, router) {
    core = coreV;
    Err = core.Err;

    // get source info (json)
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/info.json', requestHandler);
};

/**
 * Web server (express) route handler to get requested tile or info
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function requestHandler(req, res, next) {
    let source,
        start = Date.now();

    return Promise.try(function () {
        source = core.getPublicSource(req.params.src);
        return source.getHandler().getInfoAsync().then(function (info) {
            return [info, infoHeaders];
        });
    }).spread(function (data, dataHeaders) {
        core.setResponseHeaders(res, source, dataHeaders);

        if (req.query && req.query.format) {
            let escapedText = JSON.stringify(data, null, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;');
            res.send('<pre>' + escapedText + '</pre>');
        } else {
            res.json(data);
        }

        let mx = util.format('req.%s.info', req.params.src);
        core.metrics.endTiming(mx, start);
    }).catch(function (err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}
