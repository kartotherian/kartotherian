'use strict';

var Promise = require('bluebird');
var util = require('util');
var _ = require('underscore');
var numeral = require('numeral');
var core = require('kartotherian-core');
var Err = core.Err;

var kue = require('kue');
Promise.promisifyAll(kue.Job);
Promise.promisifyAll(kue.Job.prototype);

var kueui = require('kue-ui');
var queue;

var jobName = 'generate';
var Job = require('./Job');


module.exports = {};

/**
 * Init job quing
 * @param app express object
 * @param jobHandler if given - function(job, done), will use to run jobs
 */
module.exports.init = function(app, jobHandler) {
    var opts = {};
    if (app.conf.redisPrefix) opts.prefix = app.conf.redisPrefix;
    if (app.conf.redis) opts.redis = app.conf.redis;
    queue = Promise.promisifyAll(kue.createQueue(opts));

    if (!app.conf.daemonOnly) {
        var uiConf = {
            // these values must either equal, or end in a '/'
            apiURL: '/jobs/',
            baseURL: '/raw/',
            updateInterval: 5000 // Fetches new data every 5000 ms
        };

        kueui.setup(uiConf);
        app.use(uiConf.apiURL, kue.app);
        app.use(uiConf.baseURL, kueui.app);
    }

    if (jobHandler) {
        queue.process(jobName, jobHandler);
    }
};

module.exports.shutdownAsync = function(timeout) {
    return queue.shutdownAsync(timeout);
};

/**
 * Enque job for later processing
 * @param opts object
 * See the readme file for all available parameters
 */
module.exports.addJobAsync = function(opts) {
    return Promise.try(function() {
        if (!queue) {
            throw new Err('Still loading');
        }

        var job = new Job(opts);

        // If this is a pyramid, break it into individual jobs
        if (job.isPyramid) {
            return module.exports.addPyramidJobsAsync(job);
        }

        var count = job.size;
        var parts = Math.min(count, job.parts || 1);
        delete job.parts;

        var result = [];

        // Break the job into parts
        var create = function () {
            if (parts < 1) {
                return Promise.resolve(result);
            }
            var j;
            if (parts === 1) {
                j = job;
            } else {
                j = _.clone(job);
                var partCount = Math.floor(count / parts);
                j.idxBefore = j.idxFrom + partCount;
                count -= partCount;
                job.idxFrom += partCount;
            }
            parts--;
            setJobTitle(j);
            var kueJob = queue
                .create(jobName, j)
                .priority(priority)
                .attempts(10)
                .backoff({delay: 5 * 1000, type: 'exponential'});
                //.ttl(30*1000);  -- this does not work because it is based on job completion, not progress update
            return kueJob
                .saveAsync()
                .then(function () {
                    result.push(_.extend({id: kueJob.id, title: kueJob.data.title}, kueJob.data));
                })
                .then(create);
        };
        return create();
    });
};

/**
 * Given an x,y (idxFrom) of the zoom, enqueue all tiles below them, with zooms >= fromZoom and < beforeZoom
 */
module.exports.addPyramidJobsAsync = function(options) {
    var opts = _.clone(options);
    delete opts.fromZoom;
    delete opts.beforeZoom;
    delete opts.zoom;
    delete opts.idxFrom;
    delete opts.idxBefore;

    var zoom = options.fromZoom;
    var result = [];

    var addJob = function (res) {
        if (res) {
            result = result.concat(res);
        }
        if (zoom >= options.beforeZoom) {
            return Promise.resolve(result);
        }
        var z = zoom++;
        var mult = Math.pow(4, Math.abs(z - options.zoom));
        if (z < options.zoom) {
            mult = 1/mult;
        }
        return module.exports.addJobAsync(_.extend({
            zoom: z,
            idxFrom: options.idxFrom === undefined ? undefined : Math.floor(options.idxFrom * mult),
            idxBefore: options.idxBefore === undefined ? undefined : Math.ceil(options.idxBefore * mult)
        }, opts)).then(addJob);
    };
    return addJob();
};

/**
 * Move all jobs in the active que to inactive if their update time is more than given time
 */
module.exports.cleanup = function(opts) {
    if (!queue) throw new Err('Not started yet');

    core.checkType(opts, 'type', 'string', 'active');
    core.checkType(opts, 'minutesSinceUpdate', 'integer', 60);
    core.checkType(opts, 'breakIntoParts', 'integer', false, 2, 100);
    core.checkType(opts, 'breakIfLongerThan', 'number', 0.16);
    core.checkType(opts, 'sources', 'object', true);
    core.checkType(opts, 'updateSources', 'boolean');

    var type = opts.type;
    switch (type) {
        case 'inactive':
        case 'active':
        case 'failed':
        case 'complete':
        case 'delayed':
            break;
        default:
            throw new Err('Unknown que type');
    }
    var result = {};
    return queue.stateAsync(type).map(function (id) {
        return kue.Job.getAsync(id).then(function (job) {
            var diffMs = Date.now() - new Date(parseInt(job.updated_at));
            if (diffMs > (opts.minutesSinceUpdate * 60 * 1000)) {
                if (opts.updateSources) {
                    module.exports.setSources(job.data, opts.sources);
                    return job.saveAsync().then(function () {
                        return job.inactiveAsync();
                    }).then(function () {
                        result[id] = 'changedSrcs';
                    });
                }
                if (opts.breakIntoParts && (opts.breakIfLongerThan <= 0 || (job.progress_data && job.progress_data.estimateHrs >= opts.breakIfLongerThan))) {
                    var from = job.progress_data ? job.progress_data.index : job.data.idxFrom;
                    var before = job.data.idxBefore;
                    var newBefore = Math.min(before, from + Math.max(1, Math.floor((before - from) * 0.1)));
                    if (newBefore < before) {
                        var newJob = _.clone(job.data);
                        delete newJob.title;
                        newJob.idxFrom = newBefore;
                        newJob.parts = opts.breakIntoParts;

                        job.data.idxBefore = newBefore;
                        setJobTitle(job.data);

                        return job.saveAsync().then(function () {
                            return job.inactiveAsync();
                        }).then(function () {
                            return module.exports.addJobAsync(newJob);
                        }).then(function (res) {
                            result[id] = res;
                        });
                    }
                }
                return job.inactiveAsync().then(function () {
                    result[id] = 'queued';
                });
            } else {
                result[id] = 'nochange';
            }
        })
    }, {concurrency: 50}).return(result);
};

module.exports.setSources = function(job, sources) {
    // Add only the referenced sources to the job
    var ids =  _.unique(_.filter(_.pluck(job.filters, 'sourceId').concat([job.storageId, job.generatorId])));
    var recursiveIter = function (obj) {
        if (_.isObject(obj)) {
            if (Object.keys(obj).length === 1 && typeof obj.ref === 'string' && !_.contains(ids, obj.ref)) {
                ids.push(obj.ref);
            } else {
                _.each(obj, recursiveIter);
            }
        }
    };

    var i = 0;
    var allSources = sources.getSources();
    job.sources = {};
    while (i < ids.length) {
        var id = ids[i++];
        if (!allSources[id])
            throw new Err('Source ID %s is not defined', id);
        job.sources[id] = allSources[id];
        _.each(allSources[id], recursiveIter);
    }
};

function setJobTitle(job) {
    job.title = util.format('Z=%d', job.zoom);
    var zoomMax = Math.pow(4, job.zoom);
    if (job.idxFrom === 0 && job.idxBefore === zoomMax) {
        job.title += util.format('; ALL (%s)', numeral(zoomMax).format('0,0'));
    } else if (job.idxBefore - job.idxFrom === 1) {
        var xy = core.indexToXY(job.idxFrom);
        job.title += util.format('; 1 tile at [%d,%d] (idx=%d)', xy[0], xy[1], job.idxFrom);
    } else {
        var xyFrom = core.indexToXY(job.idxFrom);
        var xyLast = core.indexToXY(job.idxBefore - 1);
        job.title += util.format('; %s tiles (%s‒%s; [%d,%d]‒[%d,%d])',
            numeral(job.idxBefore - job.idxFrom).format('0,0'),
            numeral(job.idxFrom).format('0,0'),
            numeral(job.idxBefore).format('0,0'),
            xyFrom[0], xyFrom[1], xyLast[0], xyLast[1]);
    }
    job.title += util.format('; %s→%s', job.generatorId, job.storageId);
}
