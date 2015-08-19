'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var util = require('util');

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.VectorTile.prototype);

var core = require('kartotherian-core');
var Err = core.Err;

var promistreamus = require('promistreamus');

var config = {
    // Assume the tile needs to be saved if its compressed size is above this value
    // Skips the Mapnik's isSolid() call
    maxsize: 5 * 1024
};

function JobProcessor(sources, job, metrics) {
    var jd = job.data;
    if (!(jd.generatorId in sources)) {
        throw new Err('Unknown generatorId %s', jd.generatorId);
    }
    if (!(jd.storageId in sources)) {
        throw new Err('Unknown storageId %s', jd.storageId);
    }
    this.job = job;
    this.metrics = metrics;
    this.tileGenerator = sources[jd.generatorId].handler;
    this.tileStore = sources[jd.storageId].handler;
    this.start = new Date();
    this.isShuttingDown = false;
    this.metricsPrefix = util.format('gen.%s.%s.z%s.', jd.generatorId, jd.storageId,
        jd.zoom < 10 ? '0' + jd.zoom : jd.zoom);
}

/**
 * Do the job, resolves promise when the job is complete
 * @returns {*}
 */
JobProcessor.prototype.runAsync = function() {
    var self = this;
    var job = self.job.data;

    return BBPromise.try(function () {
        self.idxFromOriginal = job.idxFrom;
        self.count = job.idxBefore - self.idxFromOriginal;
        if (!self.job.progress_data || !self.job.progress_data.index) {
            self.stats = {
                itemsPerSec: 0,
                sizeAvg: 0,
                estimateHrs: -1,
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
                totalsize: 0
            };
        } else {
            self.stats = self.job.progress_data;
            job.idxFrom = self.stats.index;
        }
        self.retryFromIdx = job.idxFrom;
        // Thread list is used in the generators
        var threadList = _.range(job.threads || 1);
        self.threadIdxState = _.map(threadList, function () {
            return job.idxFrom;
        });

        self.iterator = self.getIterator(job.idxFrom, job.idxBefore, 0);

        var threads = _.map(threadList, function (threadId) {
            return self.jobProcessorThreadAsync(threadId);
        });
        return BBPromise.all(threads).then(function () {
            self.reportProgress();
            // Until progress info is exposed in the UI, do it here too
            self.job.log(JSON.stringify(self.stats, null, '  '));
        });
    });
};

JobProcessor.prototype.reportProgress = function(doneCount) {
    var stats = this.stats;
    var job = this.job.data;
    var time = (new Date() - this.start) / 1000;
    stats.itemsPerSec = time > 0 ? Math.round((stats.index - this.retryFromIdx) / time * 10) / 10 : 0;
    stats.sizeAvg = stats.save > 0 ? Math.round(stats.totalsize / stats.save * 10) / 10 : 0;
    // how long until we are done, in minutes
    if (doneCount !== undefined) {
        stats.estimateHrs = stats.sizeAvg > 0 ? Math.round((job.idxBefore - stats.index) / stats.itemsPerSec / 60 / 60 * 10) / 10 : 0;
    } else {
        delete stats.estimateHrs;
        doneCount = this.count;
    }
    this.job.progress(doneCount, this.count, stats);
};

JobProcessor.prototype.getIterator = function(idxFrom, idxBefore, filterIndex) {
    var job = this.job.data;
    if (job.filters && filterIndex < job.filters.length)
        return this.getExistingTilesIterator(idxFrom, idxBefore, filterIndex);
    else
        return this.getSimpleIterator(idxFrom, idxBefore);
};

JobProcessor.prototype.getSimpleIterator = function(idxFrom, idxBefore) {
    var idx = idxFrom;
    return function() {
        var result = undefined;
        if (idx < idxBefore) {
            result = idx++;
        }
        return BBPromise.resolve(result);
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

    var job = this.job.data;
    var filter = job.filters[filterIndex];
    var scale = filter.zoom !== undefined ? Math.pow(4, job.zoom - filter.zoom) : false;
    var opts = {
        zoom: scale ? filter.zoom : job.zoom,
        idxFrom: scale ? Math.floor(idxFrom / scale) : idxFrom,
        idxBefore: scale ? Math.ceil(idxBefore / scale) : idxBefore
    };

    if (filter.dateBefore !== undefined) {
        if (!filter.invert)
            opts.dateBefore = filter.dateBefore;
        else
            opts.dateFrom = filter.dateBefore;
    }
    if (filter.dateFrom !== undefined) {
        if (!filter.invert)
            opts.dateFrom = filter.dateFrom;
        else
            opts.dateBefore = filter.dateFrom;
    }
    if (filter.biggerThan !== undefined) {
        if (!filter.invert)
            opts.biggerThan = filter.biggerThan;
        else
            opts.smallerThan = filter.biggerThan;
    }
    if (filter.smallerThan !== undefined) {
        if (!filter.invert)
            opts.smallerThan = filter.smallerThan;
        else
            opts.biggerThan = filter.smallerThan;
    }

    var iterator = promistreamus.select(this.tileStore.query(opts), function (v) {
        return v.idx;
    });

    if (filter.invert) {
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
    if (this.threadIdxState.length > 1) {
        throw new Err('multiple threads are not supported for this job');
    }
    var idxNext = idxFrom,
        nextValP, isDone;
    var getNextValAsync = function () {
        if (isDone) {
            return BBPromise.resolve(undefined);
        } else if (!nextValP) {
            nextValP = iterator();
        }
        return nextValP.then(function (idx) {
            var untilIdx = idx === undefined ? idxBefore : idx;
            if (idxNext < untilIdx) {
                return idxNext++;
            } else if (idx === undefined) {
                isDone = true;
                return idx;
            } else {
                if (idxNext === idx) {
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
    if (this.threadIdxState.length > 1) {
        throw new Err('multiple threads are not supported for this job');
    }
    var self = this;
    var job = self.job.data;
    var firstIdx, lastIdx, isDone;
    scale = scale || 1;
    var getNextValAsync = function () {
        if (isDone) {
            return BBPromise.resolve(undefined);
        }
        return iterator().then(function (idx) {
            if (firstIdx === undefined) {
                firstIdx = lastIdx = idx;
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

JobProcessor.prototype.jobProcessorThreadAsync = function(threadId) {
    var self = this;
    return this.iterator().then(function (idx) {
        if (idx === undefined) {
            return;
        }
        // generate tile and repeat
        return self.generateTileAsync(idx).then(function () {
            self.stats.processed++;
            self.threadIdxState[threadId] = idx;

            // decide if we want to update the progress status
            self.stats.index = _.min(self.threadIdxState);
            var doneCount = self.stats.index - self.idxFromOriginal;
            var progress = doneCount / self.count;
            if (!self.progress || (progress - self.progress) > 0.001 || self.isShuttingDown) {
                self.reportProgress(doneCount);
                self.progress = progress;
            }
            if (self.isShuttingDown) {
                throw new Err('Shutting down');
            }
            return self.jobProcessorThreadAsync(threadId);
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

JobProcessor.prototype.generateTileAsync = function(idx) {
    var start = Date.now(),
        self = this,
        stats = this.stats,
        job = this.job.data,
        xy = core.indexToXY(idx),
        x = xy[0],
        y = xy[1];

    return BBPromise.try(function () {
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
        if (data.length >= config.maxsize) {
            self.metrics.endTiming(self.metricsPrefix + 'big', start);
            self.recordSamples('tiletoobig', idx);
            return data; // generated tile is too big, save
        }
        var vt = new mapnik.VectorTile(job.zoom, x, y);
        return core.uncompressAsync(data)
            .bind(vt)
            .then(function (uncompressed) {
                return this.setDataAsync(uncompressed);
            }).then(function () {
                return this.parseAsync();
            }).then(function () {
                return this.isSolidAsync();
            }).spread(function (solid, key) {
                if (solid) {
                    // Count different types of solid tiles
                    self.recordSamples('solid_' + key, idx);
                    self.metrics.endTiming(self.metricsPrefix + 'solid', start);
                    return null;
                } else {
                    self.metrics.endTiming(self.metricsPrefix + 'saving', start);
                    stats.tilenonsolid++;
                    return data;
                }
            });
    }).then(function (data) {
        if (data) {
            stats.save++;
            stats.totalsize += data.length;
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
