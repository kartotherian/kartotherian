'use strict';

var BBPromise = require('bluebird');
var util = require('util');
var _ = require('underscore');
var numeral = require('numeral');
var core = require('kartotherian-core');
var Err = core.Err;

var kue = require('kue');
BBPromise.promisifyAll(kue.Job);
BBPromise.promisifyAll(kue.Job.prototype);

var kueui = require('kue-ui');
var queue;

var jobName = 'generate';

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
    queue = BBPromise.promisifyAll(kue.createQueue(opts));

    var uiConf = {
        apiURL: '/',
        baseURL: '/raw',
        updateInterval: 5000 // Fetches new data every 5000 ms
    };

    kueui.setup(uiConf);
    app.use(uiConf.apiURL, kue.app);
    app.use(uiConf.baseURL, kueui.app);

    if (jobHandler) {
        queue.process(jobName, jobHandler);
    }
};

module.exports.shutdownAsync = function(timeout) {
    return queue.shutdownAsync(timeout);
};

module.exports.validateJob = function(job) {
    core.checkType(job, 'storageId', 'string', true, 1);
    core.checkType(job, 'generatorId', 'string', true, 1);
    core.checkType(job, 'zoom', 'zoom');
    core.checkType(job, 'threads', 'integer', false, 1, 100);
    core.checkType(job, 'parts', 'integer', false, 1, 1000);
    core.checkType(job, 'deleteEmpty', 'boolean');
    core.checkType(job, 'saveSolid', 'boolean');

    var maxCount = Math.pow(4, job.zoom);
    core.checkType(job, 'idxFrom', 'integer', 0, 0, maxCount);
    core.checkType(job, 'idxBefore', 'integer', maxCount, job.idxFrom, maxCount);

    core.checkType(job, 'sources', 'object');

    if (core.checkType(job, 'filters', 'object')) {
        if (!Array.isArray(job.filters)) {
            job.filters = [job.filters];
        }
        _.each(job.filters, function(filter, ind, all) {
            // Each filter except last must have its own zoom level. Last is optional
            // Each next zoom level must be bigger than the one before, but less than or equal to job's zoom
            core.checkType(filter, 'zoom', 'zoom',
                ind < all.length - 1,
                ind === 0 ? 0 : all[ind - 1].zoom + 1,
                job.zoom);
            if (core.checkType(filter, 'dateFrom', '[object Date]') &&
                core.checkType(filter, 'dateBefore', '[object Date]') &&
                filter.dateFrom >= filter.dateBefore
            ) {
                throw new Err('Invalid dates: dateFrom must be less than dateBefore');
            }
            core.checkType(filter, 'biggerThan', 'integer');
            core.checkType(filter, 'smallerThan', 'integer');
            core.checkType(filter, 'missing', 'boolean');
            core.checkType(filter, 'sourceId', 'string', false, 1);
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
 *  - missing - boolean - if true, yields all tiles that do not match the filtering fields:
 *                        dateBefore, dateAfter, biggerThan, smallerThan. Otherwise yields only those that match.
 *                        Default false. If no filtering fields are given, this value is ignored.
 *  - checkZoom - tiles of which zoom should be checked with 'check' param. By default, equals to zoom.
 *  - layers    - list of layer IDs (strings) to update
 *  - threads   - number of simultaneous threads (same process) to work on this job. 1 by default
 */
module.exports.addJobAsync = function(job) {
    return BBPromise.try(function() {
        if (!queue) {
            throw new Err('Still loading');
        }
        // Convert x,y coordinates into idxdFrom & idxBefore
        if (job.x !== undefined || job.y !== undefined ) {
            if (job.idxFrom !== undefined || job.idxBefore !== undefined) {
                throw new Err('idxFrom and idxBefore are not allowed when using x,y');
            }
            if (job.x === undefined || job.y === undefined) {
                throw new Err('Both x and y must be given');
            }
            core.checkType(job, 'x', 'integer', true);
            core.checkType(job, 'y', 'integer', true);
            var zoom = core.strToInt(job.baseZoom !== undefined ? job.baseZoom : job.zoom);
            if (!core.isValidZoom(zoom) || !core.isValidCoordinate(job.x, zoom) || !core.isValidCoordinate(job.y, zoom)) {
                throw new Err('Invalid x,y coordinates for the given zoom');
            }
            job.idxFrom = core.xyToIndex(job.x, job.y);
            job.idxBefore = job.idxFrom + 1;
            delete job.x;
            delete job.y;
        }

        // If this is a pyramid, break it into individual jobs
        if (job.baseZoom !== undefined || job.fromZoom !== undefined || job.beforeZoom !== undefined) {
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
 * Given an x,y (idxFrom) of the baseZoom, enqueue all tiles below them, with zooms >= fromZoom and < beforeZoom
 */
module.exports.addPyramidJobsAsync = function(options) {
    if (options.baseZoom === undefined || options.fromZoom === undefined || options.beforeZoom === undefined) {
        throw new Err('Pyramid-add requires baseZoom, fromZoom, and beforeZoom');
    }

    core.checkType(options, 'baseZoom', 'zoom');
    core.checkType(options, 'fromZoom', 'zoom');
    core.checkType(options, 'beforeZoom', 'zoom', true, options.fromZoom);
    core.checkType(options, 'idxFrom', 'integer');
    core.checkType(options, 'idxBefore', 'integer');

    var opts = _.clone(options);
    delete opts.baseZoom;
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
            return BBPromise.resolve(result);
        }
        var z = zoom++;
        var mult = Math.pow(4, Math.abs(z - options.baseZoom));
        if (z < options.baseZoom) {
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
module.exports.cleanup = function(ms, type, minRebalanceInMinutes, parts, sources) {
    if (!queue) throw new Err('Not started yet');
    switch (type) {
        case undefined:
            type = 'active';
            break;
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
            if (diffMs > ms) {
                if (job.progress_data && (job.progress_data.estimateHrs / 60.0) >= minRebalanceInMinutes) {
                    var from = job.progress_data.index || job.data.idxFrom;
                    var before = job.data.idxBefore;
                    var newBefore = Math.min(before, from + Math.max(1, Math.floor((before - from) * 0.1)));
                    if (newBefore < before) {
                        var newJob = _.clone(job.data);
                        delete newJob.title;
                        newJob.idxFrom = newBefore;
                        newJob.parts = parts || 3;

                        job.data.idxBefore = newBefore;
                        setJobTitle(job.data);
                        if (!job.sources) {
                            module.exports.setSources(job, sources);
                        }

                        return job.saveAsync().then(function () {
                            return job.inactiveAsync();
                        }).then(function () {
                            return module.exports.addJobAsync(newJob);
                        }).then(function (parts) {
                            result[id] = parts;
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
    job.title = util.format('%s→%s; Z=%d;', job.generatorId, job.storageId, job.zoom);
    var zoomMax = Math.pow(4, job.zoom);
    if (job.idxFrom === 0 && job.idxBefore === zoomMax) {
        job.title += util.format(' ALL (%s)', numeral(zoomMax).format('0,0'));
    } else if (job.idxBefore - job.idxFrom === 1) {
        var xy = core.indexToXY(job.idxFrom);
        job.title += util.format(' tile at [%d,%d] (idx=%d)', xy[0], xy[1], job.idxFrom);
    } else {
        var xyFrom = core.indexToXY(job.idxFrom);
        var xyLast = core.indexToXY(job.idxBefore - 1);
        job.title += util.format(' %s‒%s (%s); [%d,%d]‒[%d,%d]',
            numeral(job.idxFrom).format('0,0'),
            numeral(job.idxBefore).format('0,0'),
            numeral(job.idxBefore - job.idxFrom).format('0,0'),
            xyFrom[0], xyFrom[1], xyLast[0], xyLast[1]);
    }
}
