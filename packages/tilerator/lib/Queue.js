const Promise = require('bluebird');
const _ = require('underscore');
const Err = require('@kartotherian/err');
const checkType = require('@kartotherian/input-validator');
const common = require('../lib/common');
const kue = require('kue');
const kueui = require('kue-ui');

const jobName = 'generate';

Promise.promisifyAll(kue.Job);
Promise.promisifyAll(kue.Job.prototype);

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
  const opts = { jobEvents: false }; // we may have too many jobs, prevent large memory usage
  this._lastInactiveCountReqTime = undefined;
  if (app.conf.redisPrefix) opts.prefix = app.conf.redisPrefix;
  if (app.conf.redis) opts.redis = app.conf.redis;
  this._queue = Promise.promisifyAll(kue.createQueue(opts));

  this._lastInactiveCountReqTime = 0;
  this._lastInactiveCount = 0;

  if (!app.conf.daemonOnly) {
    const uiConf = {
      // these values must either equal, or end in a '/'
      apiURL: '/jobs/',
      baseURL: '/raw/',
      updateInterval: 5000, // Fetches new data every 5000 ms
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
  const self = this;

  return Promise.map(
    Promise.try(() => _.flatten(
      _.map(Array.isArray(jobs) ? jobs : [jobs], j => j.expandJobs()),
      true
    )),
    (j) => {
      j.cleanupForQue();
      return self._queue
        .create(jobName, j)
        .priority(j.priority)
        .attempts(10)
        .backoff({ delay: 1000, type: 'exponential' })
        .ttl(self.jobTTL)
        .removeOnComplete(!j.keepJob)
        .saveAsync()
        .return(j.title);
    }
  );
};

/**
 * Move all jobs in the active que to inactive if their update time is more than given time
 */
Queue.prototype.cleanup = function cleanup(opts) {
  const self = this;

  checkType(opts, 'type', 'string', 'active');
  checkType(opts, 'minutesSinceUpdate', 'integer', 60);
  checkType(opts, 'sources', 'object', true);
  checkType(opts, 'updateSources', 'boolean');
  // eslint-disable-next-line no-restricted-properties
  const jobId = checkType(opts, 'jobId', 'integer', false, 1, Math.pow(2, 50)) ? opts.jobId : false;
  const { type } = opts;
  const result = {};

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
  const jobIds = jobId ? Promise.resolve([jobId]) : self._queue.stateAsync(type);

  // TODO: Fix this return method to be consistent with return values
  // eslint-disable-next-line consistent-return
  return jobIds.map(id => kue.Job.getAsync(id).then((job) => {
    // If specific job id is given, or if job has not been updated for more than minutesSinceUpdate
    if (
      jobId ||
      (Date.now() - new Date(parseInt(job.updated_at, 10))) > (opts.minutesSinceUpdate * 60 * 1000)
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
    }
    result[id] = 'nochange';
  }), { concurrency: 50 }).return(result);
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

module.exports = Queue;
