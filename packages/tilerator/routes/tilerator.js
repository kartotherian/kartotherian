'use strict';

var pathLib = require('path');
var Promise = require('bluebird');
var _ = require('underscore');
var express = require('express');
var yaml = require('js-yaml');

var queue = require('../lib/queue');
var core = require('kartotherian-core');
var Err = core.Err;

var info = require('../package.json');

var jplib = require('tilerator-jobprocessor');
var JobProcessor = jplib.JobProcessor;
var fileParser = jplib.fileParser;

var jobProcessor;

function onSetInfo(req, res) {
    reportAsync(res, function () {
        var sources = core.getSources(),
            generator = sources.getHandlerById(req.params.generatorId),
            storage = sources.getHandlerById(req.params.storageId);
        core.checkType(req.query, 'tiles', 'string-array');

        return generator.getInfoAsync().then(function (info) {
            if (req.query.tiles) {
                info.tiles = req.query.tiles;
            }
            return storage.putInfoAsync(info);
        });
    });
}

function updateSourcesFromYaml(sourceYaml) {
    var src = yaml.safeLoad(sourceYaml);
    if (!src) {
        throw new Err('Bad sources value');
    }
    return core.getSources().loadSourcesAsync(src);
}

function onSources(req, res) {
    reportAsync(res, function () {
        if (req.method === 'POST') {
            if (!req.body) {
                throw new Err('No sources given');
            }
            return updateSourcesFromYaml(req.body);
        }
        return core.getSources().getSources();
    }, true);
}

function onVariables(req, res) {
    reportAsync(res, function () {
        return _.keys(core.getSources().getVariables());
    });
}

function onEnque(req, res) {
    reportAsync(res, function () {
        return Promise.try(function() {
            if (typeof req.body === 'string') {
                return updateSourcesFromYaml(req.body);
            }
        }).then(function() {
            var job = {
                storageId: req.query.storageId,
                generatorId: req.query.generatorId,
                zoom: req.query.zoom,
                priority: req.query.priority,
                idxFrom: req.query.idxFrom,
                idxBefore: req.query.idxBefore,
                tiles: req.query.tiles ? JSON.parse(req.query.tiles) : undefined,
                x: req.query.x,
                y: req.query.y,
                parts: req.query.parts,
                deleteEmpty: req.query.deleteEmpty,
                fromZoom: req.query.fromZoom,
                beforeZoom: req.query.beforeZoom,
                fileZoomOverride: req.query.fileZoomOverride
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
            queue.setSources(job, core.getSources());

            if (req.query.filepath) {
                if (req.query.mergeGapsAsBigAs) {
                    job.mergeGapsAsBigAs = req.query.mergeGapsAsBigAs;
                }
                return fileParser(req.query.filepath, job, function(job) {
                    return queue.addJobAsync(job);
                });
            } else {
                return queue.addJobAsync(job);
            }
        });
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
            sources: core.getSources(),
            updateSources: req.query.updateSources
        });
    });
}

function reportAsync(res, task, isYaml) {
    var format, type;
    if (!isYaml) {
        format = function(value) { return JSON.stringify(value, null, '  '); };
        type = 'application/json';
    } else {
        format = function(value) { return yaml.safeDump(value, {skipInvalid: true}); };
        type = 'text/plain';
    }
    return Promise
        .try(task)
        .then(function (val) {
            // we should have a log of all requests's responses, 'warn' is a good level for that
            core.log('warn', val);
            return format(val);
        }, function (err) {
            core.log('warn', err);
            return format({error: err.message, stack: err.stack})
        }).then(function (str) {
            res.type(type).send(str);
        });
}

module.exports = function(app) {

    return Promise.try(function () {
        core.init(app, info.kartotherian, require('path').resolve(__dirname, '..'),
            function (module) {
                return require(module);
            },
            function (module) {
                return require.resolve(module);
            }
        );
        if (app.conf.daemonOnly && app.conf.uiOnly) {
            throw new Err('daemonOnly and uiOnly config params may not be both true');
        }
        core.metrics.increment('init');
        var sources = new core.Sources(app);
        return sources.init(app.conf.variables, app.conf.sources);
    }).then(function (sources) {
        core.setSources(sources);
        var jobHandler;
        if (!app.conf.uiOnly) {
            jobHandler = function (job, callback) {
                Promise.try(function () {
                    if (jobProcessor) {
                        core.log('warn', 'Another handler is already running');
                    }
                    jobProcessor = new JobProcessor(sources, job, core.metrics);
                    return jobProcessor.runAsync();
                }).catch(function (err) {
                    core.metrics.increment('joberror');
                    throw err;
                }).finally(function () {
                    jobProcessor = undefined;
                }).nodeify(callback);
            };
        }
        queue.init(app, jobHandler);

        if (!app.conf.daemonOnly) {
            var textParser = require('body-parser').text();
            app.use('/sources', textParser, onSources);

            var router = express.Router();
            router.post('/add', textParser, onEnque);
            router.post('/stop', onStop);
            router.post('/stop/:seconds(\\d+)', onStop);
            router.post('/cleanup', onCleanup);
            router.post('/cleanup/:type/:minutes(\\d+)', onCleanup);
            router.post('/setinfo/:generatorId/:storageId', onSetInfo);
            router.get('/variables', onVariables);
            app.use('/', router);

            // Init kartotherian web server
            app.use('/', express.static(pathLib.resolve(__dirname, '../static'), {index: 'admin.html'}));
            require('kartotherian-server').init({
                core: core,
                app: app
            });
        }
    }).catch(function (err) {
        core.log('fatal', core.errToStr(err));
        process.exit(1);
    }).return(); // avoid app.js's default route initialization

};
