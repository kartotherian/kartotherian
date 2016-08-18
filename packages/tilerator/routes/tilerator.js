'use strict';

var pathLib = require('path');
var Promise = require('bluebird');
var _ = require('underscore');
var express = require('express');
var yaml = require('js-yaml');

var Queue = require('../lib/Queue');
var core = require('kartotherian-core');
var Err = core.Err;

var info = require('../package.json');

var jplib = require('tilerator-jobprocessor');
var JobProcessor = jplib.JobProcessor;
var fileParser = jplib.fileParser;
var processAll = jplib.processAll;
var Job = jplib.Job;

var jobProcessor, queue;

module.exports = startup;

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
        return core.getSources().getSourceConfigs();
    }, true);
}

function onVariables(req, res) {
    reportAsync(res, function () {
        return _.keys(core.getSources().getVariables());
    });
}

function onEnque(req, res) {
    reportAsync(res, function () {
        return Promise.try(function () {
            if (typeof req.body === 'string') {
                return updateSourcesFromYaml(req.body);
            }
        }).then(function () {
            let params = req.query;
            let job = queue.paramsToJob(params);

            let addJobAsync = function (job) {
                return queue.addJobAsync(new Job(job));
            };
            if (params.expdirpath || params.statefile || params.expmask) {
                if (!params.expdirpath || !params.statefile || !params.expmask) {
                    throw new Err('All three params - expdirpath, statefile, expmask must be present')
                }
                return processAll(params.expdirpath, params.statefile, params.expmask, job, addJobAsync);
            } else if (params.filepath) {
                return fileParser(params.filepath, job, addJobAsync);
            } else {
                return queue.addJobAsync(new Job(job));
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
            jobId: req.params.jobId,
            minutesSinceUpdate: req.params.minutes,
            sources: core.getSources(),
            updateSources: req.query.updateSources
        });
    });
}

function reportAsync(res, task, isYaml) {
    var format, type;
    if (!isYaml) {
        format = function (value) {
            return JSON.stringify(value, null, '  ');
        };
        type = 'application/json';
    } else {
        format = function (value) {
            return yaml.safeDump(value, {skipInvalid: true});
        };
        type = 'text/plain';
    }
    return Promise
        .try(function () {
            if (!queue) {
                throw new Err('Tilerator has not yet initialized');
            }
        })
        .then(task)
        .then(function (val) {
            // we should have a log of all requests's responses, 'warn' is a good level for that
            core.log('warn', val);
            return format(val);
        }, function (err) {
            core.log('warn', err);
            return format({error: err.message, stack: err.stack})
        })
        .then(function (str) {
            res.type(type).send(str);
        });
}

function startup(app) {

    return startup.bootstrap(app).then(function() {
        if (app.conf.daemonOnly && app.conf.uiOnly) {
            throw new Err('daemonOnly and uiOnly config params may not be both true');
        }
        core.metrics.increment('init');
        var sources = new core.Sources();
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
                    jobProcessor = new JobProcessor(sources, job, core.metrics, queue);
                    return jobProcessor.runAsync();
                }).catch(function (err) {
                    core.metrics.increment('joberror');
                    throw err;
                }).finally(function () {
                    jobProcessor = undefined;
                }).nodeify(callback);
            };
        }
        queue = new Queue(app, jobHandler);

        if (!app.conf.daemonOnly) {
            var textParser = require('body-parser').text();
            app.use('/sources', textParser, onSources);

            var router = express.Router();
            router.post('/add', textParser, onEnque);
            router.post('/stop', onStop);
            router.post('/stop/:seconds(\\d+)', onStop);
            router.post('/cleanup', onCleanup);
            router.post('/cleanup/:jobId(\\d+)', onCleanup);
            router.post('/cleanup/:type/:minutes(\\d+)', onCleanup);
            router.post('/setinfo/:generatorId/:storageId', onSetInfo);
            router.get('/variables', onVariables);
            app.use('/', router);

            // Init kartotherian web server
            app.use('/', express.static(pathLib.resolve(__dirname, '../static'), {index: 'admin.html'}));
            return require('kartotherian-server').init({
                core: core,
                app: app
            });
        }
    }).catch(function (err) {
        core.log('fatal', core.errToStr(err));
        process.exit(1);
    }).return(); // avoid app.js's default route initialization

}

startup.bootstrap = function bootstrap(app) {
    return Promise.try(function () {
        core.init(app, info.kartotherian, pathLib.resolve(__dirname, '..'),
            function (module) {
                return require(module);
            },
            function (module) {
                return require.resolve(module);
            }
        );
    });
};
