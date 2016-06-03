'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var core = require('kartotherian-core');
var Err = core.Err;

var kue = require('kue');
Promise.promisifyAll(kue.Job);
Promise.promisifyAll(kue.Job.prototype);

var kueui = require('kue-ui');

/** @type Queue */
var queue;

var jobName = 'generate';
var Job = require('tilerator-jobprocessor').Job;

/** @type int */
var jobTTL;

/**
 * Init job quing
 * @param {object} app express object
 * @param {object} app.conf
 * @param {string} [app.conf.redisPrefix]
 * @param {boolean} [app.conf.daemonOnly]
 * @param {int} [app.conf.jobTTL]
 * @param {function} [jobHandler] if given - function(job, done), will use to run jobs
 */
module.exports.init = function(app, jobHandler) {
    var opts = {jobEvents: false}; // we may have too many jobs, prevent large memory usage
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

    // Default: 15 minutes ought to be enough for a single tile generation
    jobTTL = app.conf.jobTTL || 15 * 60 * 1000;

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
    return Promise.try(function () {
        return addJobAsyncImpl(new Job(opts));
    });
};

function addJobAsyncImpl(job) {
    if (!queue) {
        throw new Err('Still loading');
    }
    return Promise.all(
        _.map(job.expandJobs(), function (j) {
            j.cleanupForQue();
            var kueJob = queue
                .create(jobName, j)
                .priority(j.priority)
                .attempts(10)
                .backoff({delay: 5 * 1000, type: 'exponential'})
                .ttl(jobTTL);
            return kueJob
                .saveAsync()
                .then(function () {
                    return _.extend({id: kueJob.id, title: kueJob.data.title}, kueJob.data);
                }).return(j.title);
        }));
}

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
    var jobId = core.checkType(opts, 'jobId', 'integer', false, 1, Math.pow(2,50)) ? opts.jobId : false;

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
    var result = {},
        jobIds = jobId ? Promise.resolve([jobId]) : queue.stateAsync(type);

    return jobIds.map(function (id) {
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
                    var newJob = new Job(job.data);
                    if (job.progress_data) {
                        newJob.moveNextRange(job.progress_data.range, job.progress_data.index);
                    }
                    newJob.parts = opts.breakIntoParts;

                    return job.completeAsync().then(function () {
                        return addJobAsyncImpl(newJob);
                    }).then(function (res) {
                        result[id] = res;
                    });
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
