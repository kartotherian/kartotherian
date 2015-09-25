'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var yaml = require('js-yaml');

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
            'kartotherian-demultiplexer',
            'kartotherian-overzoom',
            'kartotherian-cassandra',
            'kartotherian-layermixer'
        ], tilelive);
        sources = new core.Sources(app, tilelive);
        return sources.loadVariablesAsync(app.conf.variables);
    }).then(function () {
        return sources.loadSourcesAsync(app.conf.sources);
    }).then(function () {
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

function onSetInfo(req, res) {
    reportAsync(res, function () {
        var generator = sources.getHandlerById(req.params.generatorId);
        var storage = sources.getHandlerById(req.params.storageId);
        core.checkType(req.query, 'tiles', 'string-array');

        return generator.getInfoAsync().then(function (info) {
            if (req.query.tiles) {
                info.tiles = req.query.tiles;
            }
            return storage.putInfoAsync(info);
        });
    });
}

function onSources(req, res) {
    reportAsync(res, function () {
        if (req.method === 'POST') {
            if (!req.body) {
                throw new Err('No sources given');
            }
            var src = yaml.safeLoad(req.body);
            if (!src) {
                throw new Err('Bad sources value');
            }
            return sources.loadSourcesAsync(src);
        }
        return sources.getSources();
    });
}

function onVariables(req, res) {
    reportAsync(res, function () {
        return _.keys(sources.getVariables());
    });
}

function onEnque(req, res) {
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
            saveSolid: req.query.saveSolid,
            fromZoom: req.query.fromZoom,
            beforeZoom: req.query.beforeZoom
        };

        var filter1 = {
            sourceId: req.query.sourceId,
            dateBefore: req.query.dateBefore,
            dateFrom: req.query.dateFrom,
            biggerThan: req.query.biggerThan,
            smallerThan: req.query.smallerThan,
            missing: req.query.missing ? true : undefined,
            zoom: req.query.checkZoom
        };
        filter1 = _.any(filter1) ? filter1 : false;

        var filter2 = {
            sourceId: req.query.sourceId2,
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

        queue.setSources(job, sources);
        return queue.addJobAsync(job);
    });
}

function onStop(req, res) {
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

function onCleanup(req, res) {
    reportAsync(res, function () {
        return queue.cleanup({
            type: req.params.type,
            minutesSinceUpdate: req.params.minutes,
            breakIfLongerThan: req.query.breakIfLongerThan,
            breakIntoParts: req.query.breakIntoParts,
            sources: sources,
            updateSources: req.query.updateSources
        });
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

router.post('/add', onEnque);
router.post('/stop', onStop);
router.post('/stop/:seconds(\\d+)', onStop);
router.post('/cleanup', onCleanup);
router.post('/cleanup/:type/:minutes(\\d+)', onCleanup);
router.post('/setinfo/:generatorId/:storageId', onSetInfo);
router.get('/variables', onVariables);
router.get('/sources', onSources);
router.post('/sources', onSources);

module.exports = function(app) {

    init(app);
    app.use('/sources', require('body-parser').text());

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
