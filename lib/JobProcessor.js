'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var util = require('util');

var core = require('kartotherian-core');
var Err = core.Err;

var promistreamus = require('promistreamus');
var iterators = require('./iterators');
var Job = require('./Job');

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
 * @constructor
 */
function JobProcessor(sources, kueJob, metrics) {
    this.sources = sources;
    this.kueJob = kueJob;
    this.metrics = metrics;
    this.job = new Job(kueJob.data);
}

/**
 * Do the job, resolves promise when the job is complete
 * @returns {Promise}
 */
JobProcessor.prototype.runAsync = function() {
    var self = this,
        job = this.job;

    return this.sources.loadSourcesAsync(job.sources).then(function () {
        self.tileGenerator = self.sources.getHandlerById(job.generatorId);
        self.tileStore = self.sources.getHandlerById(job.storageId);
        self.start = new Date();
        self.isShuttingDown = false;
        self.metricsPrefix = util.format('gen.%s.%s.z%s.', job.generatorId, job.storageId,
            job.zoom < 10 ? '0' + job.zoom : job.zoom);
        if (!self.kueJob.progress_data || !self.kueJob.progress_data.index) {
            self.stats = {
                itemsPerSec: 0,
                sizeAvg: 0,
                estimateHrs: -1,
                range: job.currentRange,
                index: job.idxFrom,
                processed: 0,
                nosave: 0,
                save: 0,
                tilegen: 0,
                tilegenempty: 0,
                tilegenerr: 0,
                tilegenok: 0,
                tilenodata: 0,
                tilenonsolid: 0,
                tiletoobig: 0,
                totalsize: 0,
                smallestSize: undefined,
                smallestTile: undefined,
                largestSize: undefined,
                largestTile: undefined
            };
            self.iterator = self.getIterator();
        } else {
            self.stats = self.kueJob.progress_data;
            self.iterator = self.getIterator(self.stats.range, self.stats.index);
        }
        self.processedAtRestart = self.stats.processed;

        return self.jobProcessorAsync().then(function () {
            self.reportProgress(true);
            // Until progress info is exposed in the UI, do it here too
            self.kueJob.log(JSON.stringify(self.stats, null, '  '));
        });
    });
};

JobProcessor.prototype.reportProgress = function reportProgress (isDone) {
    let stats = this.stats,
        job = this.job,
        now = new Date();

    // Report if we haven't reported or 15 seconds since last report, or shutting down
    if (!this.lastProgressReportTime || this.isShuttingDown || ((now - this.lastProgressReportTime) / 1000) > 15) {

        let progress,
            execTime = (now - this.start) / 1000;

        stats.itemsPerSec = execTime > 0 ? Math.round((stats.processed - this.processedAtRestart) / execTime * 10) / 10 : 0;
        stats.sizeAvg = stats.save > 0 ? Math.round(stats.totalsize / stats.save * 10) / 10 : 0;

        // how long until we are done, in minutes
        if (!isDone) {
            // number of processed items is tricky because some could have been skipped by filtering iterators
            // do it the slow way here, by figuring out the position of the index in the job tiles
            progress = job.indexToPos(stats.index) + 1;
            stats.estimateHrs = stats.itemsPerSec > 0
                ? Math.round((job.size - progress) / stats.itemsPerSec / 60 / 60 * 10) / 10
                : 0;
        } else {
            progress = job.size;
            delete stats.estimateHrs;
        }
        this.kueJob.progress(progress, job.size, stats);
        this.lastProgressReportTime = now;
    }
};

/**
 * Create main iterator function, with optional starting values
 * @param range
 * @param startIdx
 * @returns {Function}
 */
JobProcessor.prototype.getIterator = function(range, startIdx) {
    var self = this,
        job = this.job;

    return promistreamus.flatten(function() {
        var hasMore = job.moveNextRange(range, startIdx);
        range = startIdx = undefined;
        if (hasMore){
            self.stats.range = job.currentRange;
            return self.getRangeIterator(job.idxFrom, job.idxBefore, 0);
        }
        return false;
    });
};

JobProcessor.prototype.getRangeIterator = function(idxFrom, idxBefore, filterIndex) {
    var job = this.job;
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

    var self = this,
        job = self.job,
        filter = job.filters[filterIndex],
        scale = filter.zoom !== undefined && filter.zoom !== job.zoom ? Math.pow(4, job.zoom - filter.zoom) : false,
        source = filter.sourceId ? self.sources.getHandlerById(filter.sourceId) : self.tileStore;

    if (!_.isFunction(source.query)) {
        throw new Err('Tile source %s does not support querying', filter.sourceId || job.storageId);
    }
    var getTiles = (filterIndex === job.filters.length - 1 && source === self.tileGenerator && !filter.missing && scale === false);
    var opts = {
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

    var iterator = promistreamus.select(source.query(opts), function (v) {
        var res = {idx: v.idx};
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
        function (range) {
            return self.getRangeIterator(
                Math.max(idxFrom, range[0] * (scale || 1)),
                Math.min(idxBefore, range[1] * (scale || 1)),
                filterIndex + 1);
        }));
};

JobProcessor.prototype.jobProcessorAsync = function() {
    var self = this;
    return this.iterator().then(function (iterValue) {
        if (iterValue === undefined) {
            return;
        }
        // generate tile and repeat
        return self.generateTileAsync(iterValue).then(function () {
            self.stats.processed++;
            self.stats.index = iterValue.idx;
            self.reportProgress();
            if (self.isShuttingDown) {
                throw new Err('Shutting down');
            }
            return self.jobProcessorAsync();
        });
    });
};

JobProcessor.prototype.generateTileAsync = function(iterValue) {
    var start = Date.now(),
        self = this,
        idx = iterValue.idx,
        tile = iterValue.tile,
        stats = this.stats,
        job = this.job,
        xy = core.indexToXY(idx),
        x = xy[0],
        y = xy[1],
        promise;

    // Generate tile or get it from the iterator
    if (!tile) {
        promise = Promise.try(function () {
            stats.tilegen++;
            return self.tileGenerator.getTileAsync(job.zoom, x, y);
        }).then(function (dataAndHeader) {
            self.metrics.endTiming(self.metricsPrefix + 'created', start);
            stats.tilegenok++;
            return dataAndHeader[0];
        }, function (err) {
            if (core.isNoTileError(err)) {
                stats.tilegenempty++;
                return null;
            } else {
                self.metrics.endTiming(self.metricsPrefix + 'generror', start);
                stats.tilegenerr++;
                throw err;
            }
        }).then(function (data) {
            if (!data || !data.length) {
                self.metrics.endTiming(self.metricsPrefix + 'nodata', start);
                stats.tilenodata++;
                return null; // empty tile generated, no need to save
            }
            return data;
        });
    } else {
        promise = Promise.resolve(tile);
    }

    return promise.then(function (data) {
        if (data) {
            self.metrics.endTiming(self.metricsPrefix + 'saving', start);
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
    }).then(function() {
        self.metrics.endTiming(self.metricsPrefix + 'done', start);
    });
};

JobProcessor.prototype.shutdown = function() {
    this.isShuttingDown = true;
};

module.exports = JobProcessor;
