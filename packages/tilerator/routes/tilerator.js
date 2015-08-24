'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.VectorTile.prototype);

var queue = require('../lib/queue');
var core = require('kartotherian-core');
var Err = core.Err;

var tilelive = require('tilelive');
BBPromise.promisifyAll(tilelive);

var router = require('../lib/util').router();
var JobProcessor = require('../lib/JobProcessor');

var jobProcessor, metrics, sources;

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    return BBPromise.try(function () {
        core.init(app.logger, require('path').resolve(__dirname, '..'), function (module) {
            return require.resolve(module);
        });
        metrics = app.metrics;
        metrics.increment('init');
        core.safeLoadAndRegister([
            'tilelive-bridge',
            'tilelive-file',
            'tilelive-vector',
            'kartotherian-autogen',
            'kartotherian-overzoom',
            'kartotherian-cassandra',
            'kartotherian-layermixer'
        ], tilelive);
        sources = new core.Sources(app, tilelive);

        return sources.loadAsync(app.conf);
    }).then(function (sources) {
        var jobHandler;
        if (!app.conf.uiOnly) {
            jobHandler = function (job, callback) {
                BBPromise.try(function () {
                    if (jobProcessor) {
                        core.log('warn', 'Another handler is already running');
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
        core.log('fatal', core.errToStr(err));
        process.exit(1);
    });
}

function setinfo(req, res) {
    reportAsync(res, function () {
        var generator = sources.getSourceById(req.params.generatorId).handler;
        var storage = sources.getSourceById(req.params.storageId).handler;
        core.checkType(req.query, 'tiles', 'string-array');

        return generator.getInfoAsync().then(function (info) {
            if (req.query.tiles) {
                info.tiles = req.query.tiles;
            }
            return storage.putInfoAsync(info)
        });
    });
}

function enque(req, res) {
    reportAsync(res, function () {
        var job = {
            threads: req.query.threads,
            storageId: req.query.storageId,
            generatorId: req.query.generatorId,
            zoom: req.query.zoom,
            priority: req.query.priority,
            idxFrom: req.query.idxFrom,
            idxBefore: req.query.idxBefore,
            x: req.query.x,
            y: req.query.y,
            parts: req.query.parts,
            deleteEmpty: req.query.deleteEmpty,
            baseZoom: req.query.baseZoom,
            fromZoom: req.query.fromZoom,
            beforeZoom: req.query.beforeZoom
        };

        var filter1 = {
            dateBefore: req.query.dateBefore,
            dateFrom: req.query.dateFrom,
            biggerThan: req.query.biggerThan,
            smallerThan: req.query.smallerThan,
            missing: req.query.missing ? true : undefined,
            zoom: req.query.checkZoom
        };
        filter1 = _.any(filter1) ? filter1 : false;

        var filter2 = {
            dateBefore: req.query.dateBefore2,
            dateFrom: req.query.dateFrom2,
            biggerThan: req.query.biggerThan2,
            smallerThan: req.query.smallerThan2,
            missing: req.query.missing2 ? true : undefined,
            zoom: req.query.checkZoom2
        };
        filter2 = _.any(filter2) ? filter2 : false;

        if (filter2 && !filter1) {
            throw new Err('Cannot set second filter unless the first filter is also set');
        }
        if (filter1 && filter2) {
            job.filters = [filter1, filter2];
        } else if (filter1) {
            job.filters = filter1;
        }

        return queue.addJobAsync(job);
    });
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
        core.log('warn', 'Manual shutdown with timeout=' + seconds);
        process.exit(1);
    });
}

function cleanup(req, res) {
    reportAsync(res, function () {
        return queue.cleanup((req.params.minutes || 60) * 60 * 1000, req.params.type, req.params.minRebalanceInMinutes);
    });
}

function reportAsync(res, task) {
    return BBPromise
        .try(task)
        .then(toJson, function (err) {
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
router.post('/cleanup/:type/:minutes(\\d+)/:minRebalanceInMinutes(\\d+)', cleanup);
router.post('/setinfo/:generatorId/:storageId', setinfo);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
