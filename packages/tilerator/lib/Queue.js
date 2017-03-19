'use strict';

let Promise = require('bluebird'),
    _ = require('underscore'),
    Err = require('kartotherian-err'),
    core = require('kartotherian-core'),
    common = require('../lib/common'),
    kue = require('kue'),
    kueui = require('kue-ui'),
    Job = require('tilerator-jobprocessor').Job;

Promise.promisifyAll(kue.Job);
Promise.promisifyAll(kue.Job.prototype);

let jobName = 'generate';

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
    let opts = {jobEvents: false}; // we may have too many jobs, prevent large memory usage
    this._lastInactiveCountReqTime = undefined;
    if (app.conf.redisPrefix) opts.prefix = app.conf.redisPrefix;
    if (app.conf.redis) opts.redis = app.conf.redis;
    this._queue = Promise.promisifyAll(kue.createQueue(opts));

    this._lastInactiveCountReqTime = 0;
    this._lastInactiveCount = 0;

    if (!app.conf.daemonOnly) {
        let uiConf = {
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
    let self = this;

    return Promise.map(
        Promise.try(() => _.flatten(
            _.map(Array.isArray(jobs) ? jobs : [jobs], j => j.expandJobs()),
            true)),
        j => {
            j.cleanupForQue();
            return self._queue
                .create(jobName, j)
                .priority(j.priority)
                .attempts(10)
                .backoff({delay: 1000, type: 'exponential'})
                .ttl(self.jobTTL)
                .removeOnComplete(!j.keepJob)
                .saveAsync()
                .return(j.title);
        });
};

/**
 * Move all jobs in the active que to inactive if their update time is more than given time
 */
Queue.prototype.cleanup = function cleanup(opts) {
    let self = this;

    core.checkType(opts, 'type', 'string', 'active');
    core.checkType(opts, 'minutesSinceUpdate', 'integer', 60);
    core.checkType(opts, 'sources', 'object', true);
    core.checkType(opts, 'updateSources', 'boolean');
    let jobId = core.checkType(opts, 'jobId', 'integer', false, 1, Math.pow(2, 50)) ? opts.jobId : false;

    let type = opts.type;
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
    let result = {},
        jobIds = jobId ? Promise.resolve([jobId]) : self._queue.stateAsync(type);

    return jobIds.map(id => kue.Job.getAsync(id).then(job => {
        // If specific job id is given, or if job has not been updated for more than minutesSinceUpdate
        if (jobId ||
            (Date.now() - new Date(parseInt(job.updated_at))) > (opts.minutesSinceUpdate * 60 * 1000)
        ) {
            if (opts.updateSources) {
                common.setSources(job.data, opts.sources);
                return job.saveAsync().then(() => job.inactiveAsync()).then(() => {
                    result[id] = 'changedSrcs';
                });
            }
            return job.inactiveAsync().then(() => {
                result[id] = 'queued';
            });
        } else {
            result[id] = 'nochange';
        }
    }), {concurrency: 50}).return(result);
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
