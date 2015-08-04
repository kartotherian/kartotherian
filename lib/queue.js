'use strict';

var BBPromise = require('bluebird');
var util = require('util');
var _ = require('underscore');
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
    if (!queue)
        queue = kue.createQueue();

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
    checkType(job, 'storageId', 'string', true, 1);
    checkType(job, 'generatorId', 'string', true, 1);
    checkType(job, 'zoom', 'number', true, 0, 32);
    checkType(job, 'threads', 'number', false, 1, 100);
    checkType(job, 'parts', 'number', false, 1, 1000);
    checkType(job, 'deleteEmpty', 'boolean');

    var maxCount = Math.pow(4, job.zoom);
    checkType(job, 'idxFrom', 'number', 0, 0, maxCount);
    checkType(job, 'idxBefore', 'number', maxCount, job.idxFrom, maxCount);

    if (checkType(job, 'filters', 'object')) {
        if (!Array.isArray(job.filters)) {
            job.filters = [job.filters];
        }
        _.each(job.filters, function(filter, ind, all) {
            // Each filter except last must have its own zoom level. Last is optional
            // Each next zoom level must be bigger than the one before, but less than job's zoom
            checkType(filter, 'zoom', 'number',
                ind < all.length - 1,
                ind === 0 ? 0 : all[ind - 1].zoom + 1,
                job.zoom - 1);
            if (checkType(filter, 'dateFrom', '[object Date]') &&
                checkType(filter, 'dateBefore', '[object Date]') &&
                filter.dateFrom >= filter.dateBefore
            ) {
                throw new Error('Invalid dates: dateFrom must be less than dateBefore');
            }
            checkType(filter, 'biggerThan', 'number');
            checkType(filter, 'smallerThan', 'number');
            checkType(filter, 'invert', 'boolean');
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
    module.exports.validateJob(job);

    var priority = strToInt(job.priority) || 0;
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
            throw new Error('Invalid layers value %s, must be a list of nonempty strings', job.layers);
        }
    }

    var result = [];

    if (count === 0) {
        return BBPromise.resolve(result);
    }

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
            .priority(priority);
        return kueJob
            .saveAsync()
            .then(function () {
                result.push(_.extend({id: kueJob.id, title: kueJob.data.title}, kueJob.data));
            })
            .then(create);
    };
    return create();
};

/**
 * Given an x,y (idxFrom) of the baseZoom, enqueue all tiles below them, with zooms >= zoomFrom and < zoomBefore
 */
module.exports.addPyramidJobsAsync = function(baseZoom, idxFrom, idxBefore, zoomFrom, zoomBefore, options) {
    var opts = _.clone(options);
    delete opts.zoom;
    delete opts.idxFrom;
    delete opts.idxBefore;
    if (opts.dateBefore === undefined) {
        opts.dateBefore = new Date();
    }

    return BBPromise.all(_.map(_.range(zoomFrom, zoomBefore), function (z) {
        var mult = Math.pow(4, z - baseZoom);
        return module.exports.addJob(_.extend({
            zoom: z,
            idxFrom: idxFrom * mult,
            idxBefore: idxBefore * mult
        }, opts));
    }));
};

/**
 * Utility method to check the type of the job's value
 */
function checkType(job, field, expType, mustHave, min, max) {
    var value = job[field];
    if (value === undefined && mustHave !== true) {
        if (mustHave === false) {
            delete job[field];
        } else {
            job[field] = mustHave;
        }
        return false;
    }
    var type = expType[0] === '[' ? Object.prototype.toString.call(value) : typeof value;
    if (type === 'string') {
        switch (expType) {
            case 'number':
                job[field] = value = strToInt(value);
                type = typeof value;
                break;
            case 'boolean':
                job[field] = value = (value ? true : false);
                type = typeof value;
                break;
        }
    }
    if (type !== expType) {
        throw new Error(
            util.format('Invalid %s param type %s given, but %s expected', field, type, expType));
    }
    switch (expType) {
        case 'number':
            if (min !== undefined && value < min) {
                throw new Error(
                    util.format('Invalid %s param - must be at least %d, but given %d', field, min, val));
            }
            if (max !== undefined && value > max) {
                throw new Error(
                    util.format('Invalid %s param - must be at most %d, but given %d', field, max, val));
            }
            break;
        case 'string':
            if (min !== undefined && job.storageId.length < min) {
                throw new Error(
                    util.format('Invalid %s param - the string must be at least %d symbols', field, min));
            }
            break;
        case 'boolean':
            if (value === false) {
                // convert false into undefined
                delete job[field];
                return false;
            }
    }
    return true;
}

/**
 * Converts value to integer if possibble, or returns the original
 */
function strToInt(v) {
    if (typeof v === 'string') {
        var v2 = parseInt(v);
        if (v2.toString() === v) {
            return v2;
        }
    }
    return v;
}
