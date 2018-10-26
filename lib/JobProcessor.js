'use strict';

let Promise = require('bluebird'),
    _ = require('underscore'),
    util = require('util'),
    qidx = require('quadtile-index'),
    Err = require('@kartotherian/err'),
    core = require('@kartotherian/core'),
    promistreamus = require('promistreamus'),
    iterators = require('./iterators'),
    Job = require('./Job');

module.exports = JobProcessor;

/**
 *
 * @param {object} sources
 * @param {Function} sources.loadSourcesAsync
 * @param {Function} sources.getHandlerById
 * @param {object} kueJob Kue job
 * @param {object} kueJob.data job data
 * @param {object} kueJob.progress_data
 * @param {Function} kueJob.log
 * @param {Function} kueJob.progress
 * @param {object} metrics
 * @param {Function} metrics.endTiming
 * @param {Queue} queue
 * @param {?EventService} eventService service for emitting resource change events
 * @constructor
 */
function JobProcessor(sources, kueJob, metrics, queue, eventService, tileTimeOut = null) {
    this.sources = sources;
    this.kueJob = kueJob;
    this.metrics = metrics;
    this.queue = queue;
    this.eventService = eventService;
    this.isShuttingDown = false;
    this.minEstimateHrsToBreak = 2;
    this.disableReportAndRebalance = !queue;
    this.tileTimeOut = tileTimeOut || false;

    let stats = kueJob.progress_data && kueJob.progress_data.index ? kueJob.progress_data : {
        itemsPerSec: 0,
        sizeAvg: 0,
        estimateHrs: -1,
        nosave: 0,
        save: 0,
        tilegen: 0,
        tilegenempty: 0,
        tilegenerr: 0,
        tilegenok: 0,
        tilenodata: 0,
        totalsize: 0,
        smallestSize: undefined,
        smallestTile: undefined,
        largestSize: undefined,
        largestTile: undefined
    };

    this.job = new Job(kueJob.data, stats);

    let metricsPrefix = util.format('gen.%s.%s.z%s.', this.job.generatorId, this.job.storageId,
        this.job.zoom < 10 ? '0' + this.job.zoom : this.job.zoom);

    this.metricsPrefixCreated = metricsPrefix + 'created';
    this.metricsPrefixGenerror = metricsPrefix + 'generror';
    this.metricsPrefixNodata = metricsPrefix + 'nodata';
    this.metricsPrefixSaving = metricsPrefix + 'saving';
    this.metricsPrefixDone = metricsPrefix + 'done';
}

/**
 * Do the job, resolves promise when the job is complete
 * @returns {Promise}
 */
JobProcessor.prototype.runAsync = function() {
    let self = this,
        job = this.job;
    return this.sources.loadSourcesAsync(job.sources).then(() => {
        self.initSources();
        self.iterator = self.createMainIterator();
        return self.jobProcessorAsync().then(() => {
            if (!self.disableReportAndRebalance) {
                return self.reportAndRebalance(true).then(() => {
                    // Until progress info is exposed in the UI, do it here too
                    self.kueJob.log(JSON.stringify(job.stats, null, '  '));
                });
            }
        });
    });
};

/**
 * Initialize tile generator and tile storage sources based on the current job
 */
JobProcessor.prototype.initSources = function initSources () {
    this.tileGenerator = this.sources.getHandlerById(this.job.generatorId);
    this.tileStore = this.sources.getHandlerById(this.job.storageId);
};

/**
 * Once in a while, report job progress, and attempt to re-balance the job
 * by splitting off its some of it into a new job
 * @param {boolean} isDone
 * @return {Promise}
 */
JobProcessor.prototype.reportAndRebalance = function reportAndRebalance (isDone) {
    let self = this,
        now = new Date();

    // Report if we haven't reported or 15 seconds since last report, or shutting down
    if (!self.isShuttingDown && self.lastProgressReportTime && (now - self.lastProgressReportTime) < 15000) {
        return Promise.resolve();
    }

    let job = self.job,
        stats = job.stats,
        progress, promise;

    if (!isDone) {
        // how long until we are done, in minutes
        progress = job.calculateProgress();
        stats.estimateHrs = stats.itemsPerSec > 0
            ? Math.round((job.size - progress) / stats.itemsPerSec / 60 / 60 * 10) / 10
            : 0;

        // If more than 1 minutes, +/- 3 minutes (random)
        if ((now - (self.lastRebalanceTime || stats.jobStart)) > (1 + Math.random() * 6) * 60 * 1000) {
            self.lastRebalanceTime = now;

            promise = self.queue.getPendingCountAsync().then(pendingCount => {

                if (pendingCount < 10 && stats.estimateHrs > self.minEstimateHrsToBreak) {
                    // next time break if the job is half as long, but not less than 5 minutes
                    self.minEstimateHrsToBreak = Math.max(self.minEstimateHrsToBreak / 2, 1 / 12);
                    // Split current job into 2
                    let newJobs = job.splitJob(2);
                    return self.queue.addJobAsync(newJobs);
                } else {
                    // next time break if the job is twice as long, but not more than 2 hours
                    self.minEstimateHrsToBreak = Math.min(self.minEstimateHrsToBreak * 2, 2);
                }
            });
        }
    } else {
        progress = job.size;
        delete stats.estimateHrs;
    }

    return (promise || Promise.resolve()).then(() => {
        self.kueJob.progress(progress, job.size, stats);
        self.lastProgressReportTime = now;
    });
};

/**
 * This iterator will go through all indexes for the current job
 * @returns {Function}
 */
JobProcessor.prototype.createMainIterator = function createMainIterator() {
    let self = this,
        job = this.job;

    return promistreamus.flatten(() => {
        let range = job.moveNextRange();
        if (range){
            return self.getRangeIterator(range[0], range[1], 0);
        }
        return false;
    });
};

JobProcessor.prototype.getRangeIterator = function(idxFrom, idxBefore, filterIndex) {
    let job = this.job;
    if (_.isFunction(this.tileGenerator.query) && (!job.filters || filterIndex >= job.filters.length)) {
        // tile generator source is capable of iterations - we shouldn't generate one by one
        if (!job.filters) {
            job.filters = [];
        }
        job.filters.push({
            sourceId: job.generatorId,
            zoom: job.zoom
        });
    }
    if (job.filters && filterIndex < job.filters.length) {
        return this.getExistingTilesIterator(idxFrom, idxBefore, filterIndex);
    } else {
        return iterators.getSimpleIterator(idxFrom, idxBefore);
    }
};


/**
 * Iterate over existing tiles in a storage
 * @param idxFrom from which index (in the zoom of the main job)
 * @param idxBefore before which index (in the zoom of the main job)
 * @param filterIndex which filter to apply
 * @returns {*}
 */
JobProcessor.prototype.getExistingTilesIterator = function(idxFrom, idxBefore, filterIndex) {

    let self = this,
        job = self.job,
        filter = job.filters[filterIndex],
        scale = filter.zoom !== undefined && filter.zoom !== job.zoom ? Math.pow(4, job.zoom - filter.zoom) : false,
        source = filter.sourceId ? self.sources.getHandlerById(filter.sourceId) : self.tileStore;

    if (!_.isFunction(source.query)) {
        throw new Err('Tile source %s does not support querying', filter.sourceId || job.storageId);
    }
    let getTiles = (filterIndex === job.filters.length - 1 && source === self.tileGenerator && !filter.missing && scale === false),
        opts = {
            zoom: scale ? filter.zoom : job.zoom,
            idxFrom: scale ? Math.floor(idxFrom / scale) : idxFrom,
            idxBefore: scale ? Math.ceil(idxBefore / scale) : idxBefore,
            getTiles: getTiles
        };

    // If missing is set, invert the meaning of all other filters, and than invert the result

    if (filter.dateBefore !== undefined) {
        if (!filter.missing)
            opts.dateBefore = filter.dateBefore;
        else
            opts.dateFrom = filter.dateBefore;
    }
    if (filter.dateFrom !== undefined) {
        if (!filter.missing)
            opts.dateFrom = filter.dateFrom;
        else
            opts.dateBefore = filter.dateFrom;
    }
    if (filter.biggerThan !== undefined) {
        if (!filter.missing)
            opts.biggerThan = filter.biggerThan;
        else
            opts.smallerThan = filter.biggerThan;
    }
    if (filter.smallerThan !== undefined) {
        if (!filter.missing)
            opts.smallerThan = filter.smallerThan;
        else
            opts.biggerThan = filter.smallerThan;
    }

    let iterator = promistreamus.select(source.query(opts), v => {
        let res = {idx: v.idx};
        if (getTiles) {
            res.tile = v.tile;
            res.headers = v.headers;
        }
        return res;
    });

    if (filter.missing) {
        iterator = iterators.invertIterator(iterator, opts.idxFrom, opts.idxBefore);
    }

    if (filterIndex === job.filters.length - 1 && !scale) {
        // last filter and no need for scaling - return as is
        return iterator;
    }

    return promistreamus.flatten(promistreamus.select(
        iterators.sequenceToRangesIterator(iterator),
        range => self.getRangeIterator(
            Math.max(idxFrom, range[0] * (scale || 1)),
            Math.min(idxBefore, range[1] * (scale || 1)),
            filterIndex + 1)));
};

JobProcessor.prototype.jobProcessorAsync = function() {
    let self = this,
        job = self.job;
    return self.iterator().then(iterValue => {
        if (iterValue === undefined || !job.isValidIndex(iterValue.idx)) {
            return;
        }
        // generate tile and repeat
        // if timeout is 0 or not specified, e.g. null, keep old behavior
        if (!this.tileTimeOut){
            return self.processOneTileAsync(iterValue).then(() => {
                if (self.isShuttingDown) {
                    throw new Err('Shutting down');
                }
                return self.jobProcessorAsync();
            });
        } else {
            // set timeout for tile process in case mapnik get stucked
            return self.processOneTileAsync(iterValue).timeout(this.tileTimeOut).then(() => {
                if (self.isShuttingDown) {
                    throw new Err('Shutting down');
                }
                return self.jobProcessorAsync();
            }).catch(Promise.TimeoutError, function(e) {
                throw new Err("Tile processing timed out");
            });;
        }
    });
};

JobProcessor.prototype.processOneTileAsync = function(iterValue) {
    let start = Date.now(),
        self = this,
        idx = iterValue.idx,
        tile = iterValue.tile,
        job = this.job,
        stats = job.stats,
        xy = qidx.indexToXY(idx),
        x = xy[0],
        y = xy[1],
        promise;

    // Generate tile or get it from the iterator
    if (!tile) {
        promise = Promise.try(() => {
            stats.tilegen++;
            return self.tileGenerator.getTileAsync(job.zoom, x, y);
        }).then(dataAndHeader => {
            self.metrics.endTiming(self.metricsPrefixCreated, start);
            stats.tilegenok++;
            return dataAndHeader[0];
        }, err => {
            if (core.isNoTileError(err)) {
                stats.tilegenempty++;
                return null;
            } else {
                self.metrics.endTiming(self.metricsPrefixGenerror, start);
                stats.tilegenerr++;
                throw err;
            }
        }).then(data => {
            if (!data || !data.length) {
                self.metrics.endTiming(self.metricsPrefixNodata, start);
                stats.tilenodata++;
                return null; // empty tile generated, no need to save
            }
            return data;
        });
    } else {
        promise = Promise.resolve(tile);
    }

    return promise.then(data => {
        if (data) {
            self.metrics.endTiming(self.metricsPrefixSaving, start);
            stats.save++;
            stats.totalsize += data.length;
            // double negative to treat "undefined" as true
            if (!(stats.smallestSize <= data.length)) {
                stats.smallestSize = data.length;
                stats.smallestTile = idx;
            }
            if (!(stats.largestSize >= data.length)) {
                stats.largestSize = data.length;
                stats.largestTile = idx;
            }
        } else {
            stats.nosave++;
            if (!job.deleteEmpty) {
                return;
            }
        }
        return self.tileStore.putTileAsync(job.zoom, x, y, data);
    }).then(() => {
        self.metrics.endTiming(self.metricsPrefixDone, start);
        job.completeIndex(idx);
        if (self.eventService) self.eventService.notifyTileChanged(job.zoom, x, y);
        return self.disableReportAndRebalance ? undefined : self.reportAndRebalance();
    });
};

JobProcessor.prototype.shutdown = function() {
    this.isShuttingDown = true;
};
