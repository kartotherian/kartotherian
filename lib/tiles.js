'use strict';

let util = require('util'),
    Promise = require('bluebird'),
    _ = require('underscore');

let core, Err;

module.exports = function tiles(coreV, router) {
    core = coreV;
    Err = core.Err;

    // get tile
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w]+)', requestHandler);
    router.get('/:src(' + core.Sources.sourceIdReStr + ')/:z(\\d+)/:x(\\d+)/:y(\\d+)@:scale([\\.\\d]+)x.:format([\\w]+)', requestHandler);
};

/**
 * Web server (express) route handler to get requested tile
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function requestHandler(req, res, next) {

    let source,
        params = req && req.params,
        start = Date.now();

    return Promise.try(function () {
        source = core.getPublicSource(params.src);

        if (!_.contains(source.formats, params.format)) {
            throw new Err('Format %s is not known', params.format).metrics('err.req.format');
        }

        params.z = core.validateZoom(params.z, source);
        params.scale = core.validateScale(params.scale, source);

        params.x = core.strToInt(params.x);
        params.y = core.strToInt(params.y);
        if (!core.isValidCoordinate(params.x, params.z) || !core.isValidCoordinate(params.y, params.z)) {
            throw new Err('x,y coordinates are not valid, or not allowed for this zoom').metrics('err.req.coords');
        }

        let opts;
        if (params.format !== 'pbf') {
            opts = {format: params.format};
            if (params.scale) {
                opts.scale = params.scale;
            }
        }

        return core.getTitleWithParamsAsync(source.getHandler(), params.z, params.x, params.y, opts);

    }).spread(function (data, dataHeaders) {
        core.setResponseHeaders(res, source, dataHeaders);

        if (params.format === 'json') {
            // Allow JSON to be shortened to simplify debugging
            res.json(filterJson(req.query, data));
        } else {
            res.send(data);
        }

        let mx = util.format('req.%s.%s.%s', params.src, params.z, params.format);
        if (params.scale) {
            // replace '.' with ',' -- otherwise grafana treats it as a divider
            mx += '.' + (params.scale.toString().replace('.', ','));
        }
        core.metrics.endTiming(mx, start);
    }).catch(function(err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}

function filterJson(query, data) {
    if ('summary' in query) {
        data = _(data).reduce(function (memo, layer) {
            memo[layer.name] = {
                features: layer.features.length,
                jsonsize: JSON.stringify(layer).length
            };
            return memo;
        }, {});
    } else if ('nogeo' in query) {
        // Recursively remove all "geometry" fields, replacing them with geometry's size
        let filter = function (val, key) {
            if (key === 'geometry') {
                return val.length;
            } else if (_.isArray(val)) {
                return _.map(val, filter);
            } else if (_.isObject(val)) {
                _.each(val, function (v, k) {
                    val[k] = filter(v, k);
                });
            }
            return val;
        };
        data = _.map(data, filter);
    }
    return data;
}
