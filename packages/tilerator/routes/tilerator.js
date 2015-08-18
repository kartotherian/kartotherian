'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var pathLib = require('path');

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.VectorTile.prototype);

var queue = require('../lib/queue');
var core = require('kartotherian-core');
var Err = core.Err;

var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

var router = require('../lib/util').router();
var JobProcessor = require('../lib/JobProcessor');

var log, jobProcessor, metrics, sources;

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    return BBPromise.try(function () {
        log = app.logger.log.bind(app.logger);
        metrics = app.metrics;
        metrics.increment('init');

        require('tilelive-bridge').registerProtocols(tilelive);
        //require('tilelive-file').registerProtocols(tilelive);
        //require('./dynogen').registerProtocols(tilelive);
        require('kartotherian-overzoom').registerProtocols(tilelive);
        require('kartotherian-cassandra').registerProtocols(tilelive);
        require('tilelive-vector').registerProtocols(tilelive);

        sources = new core.Sources(app, tilelive, function (module) {
            return require.resolve(module);
        }, pathLib.resolve(__dirname, '..'));

        return sources.loadAsync(app.conf);
    }).then(function (sources) {
        var jobHandler;
        if (!app.conf.uiOnly) {
            jobHandler = function (job, callback) {
                BBPromise.try(function () {
                    if (jobProcessor) {
                        log('warn', 'Another handler is already running');
                    }
                    jobProcessor = new JobProcessor(sources, job, metrics);
                    return jobProcessor.runAsync();
                }).catch(function (err) {
                    metrics.increment('joberror');
                    throw err;
                }).finally(function () {
                    jobProcessor = undefined;
                }).nodeify(callback);
            };
        }
        queue.init(app, jobHandler);
    }).catch(function (err) {
        console.error((err.body && (err.body.stack || err.body.detail)) || err.stack || err);
        process.exit(1);
    });
}

function enque(req, res) {
    var job = {
        threads: req.query.threads,
        storageId: req.query.storageId,
        generatorId: req.query.generatorId,
        zoom: req.query.zoom,
        priority: req.query.priority,
        idxFrom: req.query.idxFrom,
        idxBefore: req.query.idxBefore,
        parts: req.query.parts,
        deleteEmpty: req.query.deleteEmpty,
        baseZoom: req.query.baseZoom,
        zoomFrom: req.query.zoomFrom,
        zoomBefore: req.query.zoomBefore
    };

    var filter = {
        dateBefore: req.query.dateBefore,
        dateFrom: req.query.dateFrom,
        biggerThan: req.query.biggerThan,
        smallerThan: req.query.smallerThan,
        invert: req.query.invert ? true : undefined,
        zoom: req.query.checkZoom
    };

    if (_.any(filter)) {
        job.filters = filter;
    }

    reportAsync(res, queue.addJobAsync(job));
}

function stop(req, res) {
    var seconds = (req.params.seconds || 60);
    reportAsync(res, function () {
        if (jobProcessor) {
            // tell the current job processor to stop midway
            jobProcessor.shutdown();
        }
        return queue.shutdownAsync(seconds * 1000);
    }).then(function () {
        log('warn', 'Manual shutdown with timeout=' + seconds);
        process.exit(1);
    });
}

function cleanup(req, res) {
    reportAsync(res, BBPromise.try(function () {
        return queue.cleanup((req.params.minutes || 60) * 60 * 1000, req.params.type, req.params.minhrs);
    }));
}

function reportAsync(res, task) {
    return task.then(toJson, function (err) {
        return toJson({error: err.message, stack: err.stack})
    }).then(function (str) {
        res.type('application/json').send(str);
    });
}

function toJson(value) {
    return JSON.stringify(value, null, '  ');
}

router.post('/add', enque);
router.post('/stop', stop);
router.post('/stop/:seconds(\\d+)', stop);
router.post('/cleanup', cleanup);
router.post('/cleanup/:type/:minutes(\\d+)', cleanup);
router.post('/cleanup/:type/:minutes(\\d+)/:minhrs(\\d+)', cleanup);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
