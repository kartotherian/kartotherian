'use strict';

var BBPromise = require('bluebird');
var util = require('util');
var _ = require('underscore');
var core = require('kartotherian-core');
var Err = core.Err;

var kue = require('kue');
BBPromise.promisifyAll(kue.Job.prototype);

var kueui = require('kue-ui');
var queue;

var jobName = 'generate';

module.exports = {};

/**
 * Init job quing
 * @param app if given, adds que UI
 * @param jobHandler if given - function(job, done), will use to run jobs
 */
module.exports.init = function(app, jobHandler) {
    if (!queue) {
        var opts = {};
        if (app.conf.redisPrefix) opts.prefix = app.conf.redisPrefix;
        if (app.conf.redis) opts.redis = app.conf.redis;
        queue = kue.createQueue(opts);
    }

    if (app) {
        var uiConf = {
            apiURL: '/kue/',
            baseURL: '/kue2',
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

module.exports.validateJob = function(job) {
    core.checkType(job, 'storageId', 'string', true, 1);
    core.checkType(job, 'generatorId', 'string', true, 1);
    core.checkType(job, 'zoom', 'integer', true, 0, 32);
    core.checkType(job, 'threads', 'integer', false, 1, 100);
    core.checkType(job, 'parts', 'integer', false, 1, 1000);
    core.checkType(job, 'deleteEmpty', 'boolean');

    var maxCount = Math.pow(4, job.zoom);
    core.checkType(job, 'idxFrom', 'integer', 0, 0, maxCount);
    core.checkType(job, 'idxBefore', 'integer', maxCount, job.idxFrom, maxCount);

    if (core.checkType(job, 'filters', 'object')) {
        if (!Array.isArray(job.filters)) {
            job.filters = [job.filters];
        }
        _.each(job.filters, function(filter, ind, all) {
            // Each filter except last must have its own zoom level. Last is optional
            // Each next zoom level must be bigger than the one before, but less than job's zoom
            core.checkType(filter, 'zoom', 'integer',
                ind < all.length - 1,
                ind === 0 ? 0 : all[ind - 1].zoom + 1,
                job.zoom - 1);
            if (core.checkType(filter, 'dateFrom', '[object Date]') &&
                core.checkType(filter, 'dateBefore', '[object Date]') &&
                filter.dateFrom >= filter.dateBefore
            ) {
                throw new Err('Invalid dates: dateFrom must be less than dateBefore');
            }
            core.checkType(filter, 'biggerThan', 'integer');
            core.checkType(filter, 'smallerThan', 'integer');
            core.checkType(filter, 'invert', 'boolean');
        });
    }
};

/**
 * Enque job for later processing
 * @param job object
 *  Mandatory field:
 *  - storageId - string ID of the tile storage as defined in the configuration
 *  - generatorId - string ID of the tile generator as defined in the configuration
 *  - zoom property (integer)
 *  Optional:
 *  - priority - integer, default 0
 *  - idxFrom - integer index, default 0
 *  - idxBefore - integer index, default 4^zoom
 *  - dateBefore - Date object to process tiles only older than this timestamp, or false to disable. false by default.
 *  - dateFrom - Date object to process tiles only newer than this timestamp, or false to disable. false by default.
 *  - biggerThan - number - only process tiles whose compressed size is bigger than this value (inclusive)
 *  - smallerThan - number - only process tiles whose compressed size is smaller than this value (exclusive)
 *  - invert - boolean - if true, yields all tiles that do not match the filtering fields:
 *                        dateBefore, dateAfter, biggerThan, smallerThan. Otherwise yields only those that match.
 *                        Default false. If no filtering fields are given, this value is ignored.
 *  - checkZoom - tiles of which zoom should be checked with 'check' param. By default, equals to zoom.
 *  - layers    - list of layer IDs (strings) to update
 *  - threads   - number of simultaneous threads (same process) to work on this job. 1 by default
 */
module.exports.addJobAsync = function(job) {
    return BBPromise.try(function() {

        if (job.baseZoom !== undefined || job.zoomFrom !== undefined || job.zoomBefore !== undefined) {
            return module.exports.addPyramidJobsAsync(job);
        }

        module.exports.validateJob(job);

        // Don't check priority before because it can be both a number and a string like 'highest'
        var priority = core.strToInt(job.priority) || 0;
        delete job.priority;

        var count = job.idxBefore - job.idxFrom;
        var parts = Math.min(count, job.parts || 1);
        delete job.parts;
        if (job.layers !== undefined) {
            if (typeof job.layers === 'string') {
                job.layers = [job.layers];
            } else if (!Array.isArray(job.layers) || !_.every(job.layers, function (v) {
                    return typeof v === 'string' && v.length > 0;
                })
            ) {
                throw new Err('Invalid layers value %s, must be a list of nonempty strings', job.layers);
            }
        }

        var result = [];

        // Break the job into parts
        var create = function () {
            if (parts < 1) {
                return BBPromise.resolve(result);
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
            // Create Title
            j.title = 'Z=' + j.zoom;
            if (partCount === Math.pow(4, j.zoom)) {
                j.title = 'All ' + j.title;
            } else {
                j.title += ' ' + j.idxFrom + '-' + j.idxBefore + ' (' + (j.idxBefore - j.idxFrom) + ')';
            }

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
 * Given an x,y (idxFrom) of the baseZoom, enqueue all tiles below them, with zooms >= zoomFrom and < zoomBefore
 */
module.exports.addPyramidJobsAsync = function(options) {
    if (options.baseZoom === undefined || options.zoomFrom === undefined || options.zoomBefore === undefined) {
        throw new Err('Pyramid-add requires baseZoom, zoomFrom, and zoomBefore');
    }

    var opts = _.clone(options);
    delete opts.baseZoom;
    delete opts.zoomFrom;
    delete opts.zoomBefore;
    delete opts.zoom;
    delete opts.idxFrom;
    delete opts.idxBefore;

    var zoom = options.zoomFrom;
    var result = [];

    var addJob = function (res) {
        if (res) {
            result = result.concat(res);
        }
        if (zoom >= options.zoomBefore) {
            return BBPromise.resolve(result);
        }
        var z = zoom++;
        var mult = Math.pow(4, z - options.baseZoom);
        return module.exports.addJobAsync(_.extend({
            zoom: z,
            idxFrom: options.idxFrom === undefined ? undefined : options.idxFrom * mult,
            idxBefore: options.idxBefore === undefined ? undefined : options.idxBefore * mult
        }, opts)).then(addJob);
    };
    return addJob();
};
