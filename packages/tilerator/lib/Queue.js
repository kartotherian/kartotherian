'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var core = require('kartotherian-core');
var Err = core.Err;

var kue = require('kue');
Promise.promisifyAll(kue.Job);
Promise.promisifyAll(kue.Job.prototype);

var kueui = require('kue-ui');

var jobName = 'generate';
var Job = require('tilerator-jobprocessor').Job;

module.exports = Queue;

/**
 * Init job quing
 * @param {object} app express object
 * @param {object} app.conf
 * @param {string} [app.conf.redisPrefix]
 * @param {boolean} [app.conf.daemonOnly]
 * @param {int} [app.conf.jobTTL]
 * @param {function} [jobHandler] if given - function(job, done), will use to run jobs
 */
function Queue(app, jobHandler) {
    var opts = {jobEvents: false}; // we may have too many jobs, prevent large memory usage
    this._lastInactiveCountReqTime = undefined;
    if (app.conf.redisPrefix) opts.prefix = app.conf.redisPrefix;
    if (app.conf.redis) opts.redis = app.conf.redis;
    this._queue = Promise.promisifyAll(kue.createQueue(opts));

    this._lastInactiveCountReqTime = 0;
    this._lastInactiveCount = 0;

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
    this.jobTTL = app.conf.jobTTL || 15 * 60 * 1000;

    if (jobHandler) {
        this._queue.process(jobName, jobHandler);
    }
}

Queue.prototype.shutdownAsync = function shutdownAsync(timeout) {
    return this._queue.shutdownAsync(timeout);
};

/**
 * Enque job for later processing
 * @param {Job|Job[]} jobs object
 * See the readme file for all available parameters
 * @returns {Promise} expanded array of added job titles
 */
Queue.prototype.addJobAsync = function addJobAsync(jobs) {
    var self = this;

    return Promise.map(Promise.try(function () {
        return _.flatten(_.map(Array.isArray(jobs) ? jobs : [jobs], function (j) {
            return j.expandJobs();
        }), true);
    }), function (j) {
        j.cleanupForQue();
        return self._queue
            .create(jobName, j)
            .priority(j.priority)
            .attempts(10)
            .backoff({delay: 1000, type: 'exponential'})
            .ttl(self.jobTTL)
            .removeOnComplete( !j.keepJob )
            .saveAsync()
            .return(j.title);
    });
};

/**
 * Move all jobs in the active que to inactive if their update time is more than given time
 */
Queue.prototype.cleanup = function cleanup(opts) {
    var self = this;

    core.checkType(opts, 'type', 'string', 'active');
    core.checkType(opts, 'minutesSinceUpdate', 'integer', 60);
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
        jobIds = jobId ? Promise.resolve([jobId]) : self._queue.stateAsync(type);

    return jobIds.map(function (id) {
        return kue.Job.getAsync(id).then(function (job) {
            // If specific job id is given, or if job has not been updated for more than minutesSinceUpdate
            if (jobId ||
                (Date.now() - new Date(parseInt(job.updated_at))) > (opts.minutesSinceUpdate * 60 * 1000)
            ) {
                if (opts.updateSources) {
                    self.setSources(job.data, opts.sources);
                    return job.saveAsync().then(function () {
                        return job.inactiveAsync();
                    }).then(function () {
                        result[id] = 'changedSrcs';
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

Queue.prototype.setSources = function setSources(job, sources) {
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

Queue.prototype.getKue = function getKue() {
    return this._queue;
};

/**
 * Get the number of jobs in the "inactive" (pending) queue
 */
Queue.prototype.getPendingCountAsync = function getPendingCountAsync() {
    return this._queue.inactiveCountAsync();
};
