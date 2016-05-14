'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var util = require('util');

var core = require('kartotherian-core');
var Err = core.Err;

var promistreamus = require('promistreamus');
var Job = require('./Job');


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
        job = this.job,
        skipFirstIteration = false;

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
        } else {
            self.stats = self.kueJob.progress_data;
            job.moveNextRange(self.stats.range, self.stats.index);
            skipFirstIteration = true;
        }
        self.processedAtRestart = self.stats.processed;

        
        self.iterator = promistreamus.flatten(function() {
            if (skipFirstIteration) {
                skipFirstIteration = false;
            } else if (!job.moveNextRange()){
                return false;
            }
            self.stats.range = job.currentRange;
            return self.getIterator(job.idxFrom, job.idxBefore, 0);
        });

        return self.jobProcessorAsync().then(function () {
            self.reportProgress(true);
            // Until progress info is exposed in the UI, do it here too
            self.kueJob.log(JSON.stringify(self.stats, null, '  '));
        });
    });
};

JobProcessor.prototype.reportProgress = function reportProgress (isDone) {
    var stats = this.stats,
        job = this.job;

    // decide if we want to update the progress status
    var progress = stats.processed / job.size;
    if (!this.lastProgressReport || (progress - this.lastProgressReport) > 0.001 || this.isShuttingDown) {

        var time = (new Date() - this.start) / 1000;
        stats.itemsPerSec = time > 0 ? Math.round((stats.processed - this.processedAtRestart) / time * 10) / 10 : 0;
        stats.sizeAvg = stats.save > 0 ? Math.round(stats.totalsize / stats.save * 10) / 10 : 0;

        // how long until we are done, in minutes
        if (!isDone) {
            stats.estimateHrs = stats.sizeAvg > 0 ? Math.round((job.size - stats.processed) / stats.itemsPerSec / 60 / 60 * 10) / 10 : 0;
        } else {
            delete stats.estimateHrs;
        }
        this.kueJob.progress(stats.processed, job.size, stats);
        this.lastProgressReport = progress;
    }
};

JobProcessor.prototype.getIterator = function(idxFrom, idxBefore, filterIndex) {
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
        return this.getSimpleIterator(idxFrom, idxBefore);
    }
};

JobProcessor.prototype.getSimpleIterator = function(idxFrom, idxBefore) {
    var idx = idxFrom;
    return function() {
        var result = undefined;
        if (idx < idxBefore) {
            result = {idx: idx++};
        }
        return Promise.resolve(result);
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

    var job = this.job,
        filter = job.filters[filterIndex],
        scale = filter.zoom !== undefined && filter.zoom !== job.zoom ? Math.pow(4, job.zoom - filter.zoom) : false,
        source = filter.sourceId ? this.sources.getHandlerById(filter.sourceId) : this.tileStore;

    if (!_.isFunction(source.query)) {
        throw new Err('Tile source %s does not support querying', filter.sourceId || job.storageId);
    }
    var getTiles = (filterIndex === job.filters.length - 1 && source === this.tileGenerator && !filter.missing && scale === false);
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
        iterator = this.invertIterator(iterator, opts.idxFrom, opts.idxBefore);
    }

    if (filterIndex === job.filters.length - 1 && !scale) {
        // last filter and no need for scaling - return as is
        return iterator;
    }

    iterator = this.generateSubIterators(iterator, idxFrom, idxBefore, scale, filterIndex);

    return promistreamus.flatten(iterator);
};

/**
 * Given an iterator, yield only those tiles that the iterator does NOT yield for the given zoom
 */
JobProcessor.prototype.invertIterator = function(iterator, idxFrom, idxBefore) {
    var idxNext = idxFrom,
        nextValP, isDone;
    var getNextValAsync = function () {
        if (isDone) {
            return Promise.resolve(undefined);
        } else if (!nextValP) {
            nextValP = iterator();
        }
        return nextValP.then(function (iterValue) {
            var untilIdx = iterValue === undefined ? idxBefore : iterValue.idx;
            if (idxNext < untilIdx) {
                return {idx: idxNext++};
            } else if (iterValue === undefined) {
                isDone = true;
                return undefined;
            } else {
                if (idxNext === iterValue.idx) {
                    idxNext++;
                    nextValP = iterator();
                }
                return getNextValAsync();
            }
        });
    };
    return getNextValAsync;
};

/**
 * Given an iterator, find sequential ranges of indexes, and create iterator for each
 */
JobProcessor.prototype.generateSubIterators = function(iterator, idxFrom, idxBefore, scale, filterIndex) {
    var self = this;
    var job = self.job;
    var firstIdx, lastIdx, isDone;
    scale = scale || 1;
    var getNextValAsync = function () {
        if (isDone) {
            return Promise.resolve(undefined);
        }
        return iterator().then(function (iterValue) {
            var idx = iterValue === undefined ? undefined : iterValue.idx;
            if (firstIdx === undefined) {
                if (idx === undefined) {
                    // empty result
                    isDone = true;
                } else {
                    firstIdx = lastIdx = idx;
                }
                return getNextValAsync();
            }
            if (idx === lastIdx + 1) {
                lastIdx = idx;
                return getNextValAsync();
            }

            var res = self.getIterator(
                Math.max(job.idxFrom, firstIdx * scale),
                Math.min(job.idxBefore, (lastIdx + 1) * scale),
                filterIndex + 1);

            firstIdx = lastIdx = idx;
            if (idx === undefined) {
                isDone = true;
            }
            return res;
        });
    };
    return getNextValAsync;
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

JobProcessor.prototype.recordSamples = function(stat, idx) {
    var stats = this.stats;
    if (stat in stats) {
        // todo: remove this if after z13 is done
        if (typeof stats[stat] === 'number') {
            stats[stat] = [stats[stat]];
        }
        stats[stat][0]++;
    } else {
        stats[stat] = [1];
    }
    if (stats[stat].length < 3) {
        // Record the first few tiles of this type
        stats[stat].push(idx)
    }
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
