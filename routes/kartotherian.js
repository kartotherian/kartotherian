'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var express = require('express');
var router = require('../lib/util').router();
var pathLib = require('path');

var core = require('kartotherian-core');
var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

var conf;
//var vectorHeaders = {'Content-Encoding': 'gzip'};
//var rasterHeaders = {}; // {'Content-Type': 'image/png'};

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    //var log = app.logger.log.bind(app.logger);

    core.registerProtocols(require('tilelive-bridge'), tilelive);
    core.registerProtocols(require('tilelive-file'), tilelive);
    //core.registerProtocols(require('./dynogen'), tilelive);
    core.registerProtocols(require('kartotherian-overzoom'), tilelive);
    core.registerProtocols(require('kartotherian-cassandra'), tilelive);
    core.registerProtocols(require('tilelive-vector'), tilelive);

    var resolver = function (module) {
        return require.resolve(module);
    };

    app.use('/static/leaflet', express.static(core.getModulePath('leaflet', resolver), core.getStaticOpts(app.conf)));

    core.sources
        .initAsync(app, tilelive, resolver, pathLib.resolve(__dirname, '..'))
        .then(function (c) {
            conf = c;
        })
        .catch(function (err) {
            console.error((err.body && (err.body.stack || err.body.detail)) || err.stack || err);
            process.exit(1);
        });
}

/**
 * Web server (express) route handler to get requested tile
 * @param req request object
 * @param res response object
 */
function getTile(req, res) {

    if (conf.cache) {
        res.header('Cache-Control', conf.cache);
    }

    var srcId = req.params.src;
    if (!conf.hasOwnProperty(srcId)) {
        throw new Error('Unknown source ' + srcId);
    }
    var source = conf[srcId];
    if (!source.public) {
        throw new Error('Source ' + srcId + ' not public');
    }

    var opts;
    if (source.uri.protocol === 'style:') {
        switch(req.params.format) {
            case 'json':
            case 'headers':
            case 'svg':
            case 'png':
            case 'jpeg':
                opts = {format: req.params.format};
                break;
            default:
                throw new Error('Format ' + req.params.format + ' is not known');
        }
        var scale = req.params.scale ? req.params.scale[1] | 0 : undefined;
        scale = scale > 4 ? 4 : scale; // limits scale to 4x (1024 x 1024 tiles or 288dpi)
        if (scale) {
            opts.scale = scale;
        }
    }

    return core
        .getTitleWithParamsAsync(source.handler, req.params.z | 0, req.params.x | 0, req.params.y | 0, opts)
        .spread(function(data, headers) {
            if (opts && opts.format === 'json') {
                if ('summary' in req.query) {
                    data = _(data).reduce(function (memo, layer) {
                        memo[layer.name] = {
                            features: layer.features.length,
                            jsonsize: JSON.stringify(layer).length
                        };
                        return memo;
                    }, {});
                } else if ('nogeo' in req.query) {
                    var filter = function (val, key) {
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
            }
            res.set(headers);
            res.send(data);
        });
}

router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w\\.]+)', getTile);
router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x).:format([\\w\\.]+)', getTile);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
