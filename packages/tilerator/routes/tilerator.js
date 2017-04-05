'use strict';

let pathLib = require('path'),
    Promise = require('bluebird'),
    _ = require('underscore'),
    express = require('express'),
    yaml = require('js-yaml'),
    Queue = require('../lib/Queue'),
    common = require('../lib/common'),
    checkType = require('@kartotherian/input-validator'),
    Err = require('@kartotherian/err'),
    core = require('@kartotherian/core'),
    server = require('@kartotherian/server'),
    info = require('../package.json'),
    JobProcessor = require('@kartotherian/jobprocessor').JobProcessor;

let jobProcessor, queue;

module.exports = startup;

function onSetInfo(req, res) {
    reportAsync(res, () => {
        let sources = core.getSources(),
            generator = sources.getHandlerById(req.params.generatorId),
            storage = sources.getHandlerById(req.params.storageId);
        checkType(req.query, 'tiles', 'string-array');

        return generator.getInfoAsync().then(info => {
            if (req.query.tiles) {
                info.tiles = req.query.tiles;
            }
            return storage.putInfoAsync(info);
        });
    });
}

function updateSourcesFromYaml(sourceYaml) {
    let src = yaml.safeLoad(sourceYaml);
    if (!src) {
        throw new Err('Bad sources value');
    }
    return core.getSources().loadSourcesAsync(src);
}

function onSources(req, res) {
    reportAsync(res, () => {
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
    reportAsync(res, () => _.keys(core.getSources().getVariables()));
}

function onEnque(req, res) {
    reportAsync(res, () => Promise.try(() => {
        if (typeof req.body === 'string') {
            return updateSourcesFromYaml(req.body);
        }
    }).then(() => {
        let params = req.query,
            job = common.paramsToJob(params, core.getSources());
        return common.enqueJob(queue, job, params);
    }));
}

function onStop(req, res) {
    let seconds = (req.params.seconds || 60);
    reportAsync(res, () => {
        if (jobProcessor) {
            // tell the current job processor to stop midway
            jobProcessor.shutdown();
        }
        return queue.shutdownAsync(seconds * 1000);
    }).then(() => {
        core.log('warn', 'Manual shutdown with timeout=' + seconds);
        process.exit(1);
    });
}

function onCleanup(req, res) {
    reportAsync(res, () => queue.cleanup({
        type: req.params.type,
        jobId: req.params.jobId,
        minutesSinceUpdate: req.params.minutes,
        sources: core.getSources(),
        updateSources: req.query.updateSources
    }));
}

function reportAsync(res, task, isYaml) {
    let format, type;
    if (!isYaml) {
        format = value => JSON.stringify(value, null, '  ');
        type = 'application/json';
    } else {
        format = value => yaml.safeDump(value, {skipInvalid: true});
        type = 'text/plain';
    }
    return Promise
        .try(() => {
            if (!queue) {
                throw new Err('Tilerator has not yet initialized');
            }
        })
        .then(task)
        .then(val => {
            // we should have a log of all requests's responses, 'warn' is a good level for that
            core.log('warn', val);
            return format(val);
        }, err => {
            core.log('warn', err);
            return format({error: err.message, stack: err.stack})
        })
        .then(str => {
            res.type(type).send(str);
        });
}

function startup(app) {

    return startup.bootstrap(app).then(() => {
        if (app.conf.daemonOnly && app.conf.uiOnly) {
            throw new Err('daemonOnly and uiOnly config params may not be both true');
        }
        core.metrics.increment('init');
        let sources = new core.Sources();
        return sources.init(app.conf.variables, app.conf.sources);
    }).then(sources => {
        core.setSources(sources);
        let jobHandler;
        if (!app.conf.uiOnly) {
            jobHandler = (job, callback) => {
                Promise.try(() => {
                    if (jobProcessor) {
                        core.log('warn', 'Another handler is already running');
                    }
                    jobProcessor = new JobProcessor(sources, job, core.metrics, queue);
                    return jobProcessor.runAsync();
                }).catch(err => {
                    core.metrics.increment('joberror');
                    throw err;
                }).finally(() => {
                    jobProcessor = undefined;
                }).nodeify(callback);
            };
        }
        queue = new Queue(app, jobHandler);

        if (!app.conf.daemonOnly) {
            let textParser = require('body-parser').text();
            app.use('/sources', textParser, onSources);

            let router = express.Router();
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
            return server.init({
                core: core,
                app: app
            });
        }
    }).catch(err => {
        core.log('fatal', core.errToStr(err));
        process.exit(1);
    }).return(); // avoid app.js's default route initialization

}

startup.bootstrap = function bootstrap(app) {
    return Promise.try(() => {
        core.init(app, info.kartotherian, pathLib.resolve(__dirname, '..'),
            module => require(module),
            module => require.resolve(module)
        );
    });
};
