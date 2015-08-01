'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');

var mapnik = require('mapnik');
var sUtil = require('../lib/util');
var util = require('util');
var queue = require('../lib/queue');

var router = sUtil.router();

var config = {
    // Assume the tile needs to be saved if its compressed size is above this value
    // Skips the Mapnik's isSolid() call
    maxsize: 5 * 1024
};

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    // todo: need to crash if this fails to load
    // todo: implement dynamic configuration reloading
    require('../lib/conf')
        .loadConfigurationAsync(app)
        .then(function(conf) {
            queue.init(app, function (job, done) {
                BBPromise.try(function () {
                    var handler = new JobProcessor(conf, job);
                    return handler.runAsync();
                }).nodeify(done);
            });
        })
        .catch(function (err) {
            console.error((err.body && (err.body.stack || err.body.detail)) || err.stack || err);
            process.exit(1);
        });
}

function JobProcessor(conf, job) {
    if (!(job.data.generatorId in conf)) {
        throw new Error('Uknown generatorId ' + job.data.generatorId);
    }
    if (!(job.data.storageId in conf)) {
        throw new Error('Uknown storageId ' + job.data.storageId);
    }
    this.conf = conf;
    this.job = job;
    this.tileGenerator = conf[job.data.generatorId].handler;
    this.tileStore = conf[job.data.storageId].handler;
}

/**
 * Do the job, resolves promise when the job is complete
 * @returns {*}
 */
JobProcessor.prototype.runAsync = function() {
    var self = this;
    var job = self.job.data;
    return BBPromise.try(function () {
        self.started = new Date();
        self.stats = {
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
        self.iterator = self.getIterator(job);
        var threads = _.map(_.range(job.threads || 1), function (threadId) {
            return self.jobProcessorThreadAsync(threadId);
        });
        return BBPromise.all(threads).then(function () {
            var time = (new Date() - self.start) / 1000;
            var stats = self.stats;
            stats.itemAvg = time > 0 ? Math.round(stats.processed / time * 10) / 10 : 0;
            stats.sizeAvg = stats.save > 0 ? Math.round(stats.totalsize / stats.save * 10) / 10 : 0;
            self.job.progress(job.count, job.count, stats);
        });
    });
};

JobProcessor.prototype.getIterator = function(job) {
    var iter = this.getZoomCheckIterator(job);
    if (!iter)
        iter = this.getExistingTilesIterator(job);
    if (!iter)
        iter = this.getSimpleIterator(job);
    return iter;
};

JobProcessor.prototype.getSimpleIterator = function(job) {
    var idx = job.idxFrom;
    return function() {
        var result = undefined;
        if (idx < job.idxBefore) {
            result = {zoom: job.zoom, idx: idx++};
        }
        return BBPromise.resolve(result);
    }
};

JobProcessor.prototype.getExistingTilesIterator = function(job) {
    if (job.dateBefore === undefined && job.dateFrom === undefined &&
        job.biggerThan === undefined && job.smallerThan === undefined
    ) {
        return false;
    }

    var invert = job.invert;
    var opts = {
        zoom: job.zoom,
        idxFrom: job.idxFrom,
        idxBefore: job.idxBefore
    };
    if (job.dateBefore !== undefined) {
        if (!invert)
            opts.dateBefore = job.dateBefore;
        else
            opts.dateFrom = job.dateBefore;
    }
    if (job.dateFrom !== undefined) {
        if (!invert)
            opts.dateFrom = job.dateFrom;
        else
            opts.dateBefore = job.dateFrom;
    }
    if (job.biggerThan !== undefined) {
        if (!invert)
            opts.biggerThan = job.biggerThan;
        else
            opts.smallerThan = job.biggerThan;
    }
    if (job.smallerThan !== undefined) {
        if (!invert)
            opts.smallerThan = job.smallerThan;
        else
            opts.biggerThan = job.smallerThan;
    }
    var iterator = this.tileStore.query(opts);
    if (invert)
        iterator = this.getInvertingIterator(job, iterator);
    return iterator;
};

/**
 * Given an iterator, yield only those tiles that the iterator does NOT yield within the given job
 */
JobProcessor.prototype.getInvertingIterator = function(job, iterator) {
    var idxNext = job.idxFrom,
        nextValP, isDone;
    var getNextValAsync = function () {
        if (isDone) {
            return BBPromise.resolve(undefined);
        } else if (!nextValP) {
            nextValP = iterator();
        }
        return nextValP.then(function (val) {
            var untilIdx = val === undefined ? job.idxBefore : val.idx;
            if (idxNext < untilIdx) {
                return {zoom: job.zoom, idx: idxNext++};
            } else if (val === undefined) {
                isDone = true;
                return val;
            } else {
                if (idxNext === val.idx) {
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
 * Iterate over all existing tiles in the job.checkZoom level, and for each found tile, perform regular sub-iteration
 * @param job
 */
JobProcessor.prototype.getZoomCheckIterator = function(job) {
    if (!job.checkZoom)
        return false;
    var scale = Math.pow(4, job.zoom - job.checkZoom);
    var opts = {
        zoom: job.checkZoom,
        idxFrom: job.idxFrom / scale,
        idxBefore: job.idxBefore / scale
    };
    var self = this;
    var ozIter = this.tileStore.query(opts);
    var subIterP = false;
    var isDone = false;
    var getNextValAsync = function() {
        if (isDone)
            return BBPromise.resolve(undefined);
        if (!subIterP) {
            subIterP = ozIter().then(function (res) {
                if (res === undefined) {
                    isDone = true;
                    return res; // done iterating
                }
                var t = _.clone(job);
                delete t.checkZoom;
                t.idxFrom = Math.max(job.idxFrom, res.idx * scale);
                t.idxBefore = Math.min(job.idxBefore, (res.idx + 1) * scale);
                t.count = t.idxBefore - t.idxFrom;
                return self.getIterator(t);
            });
        }
        return subIterP.then(function(iter) {
            if (!iter) return undefined;
            return iter().then(function(val) {
                if (val === undefined) {
                    subIterP = false;
                    return getNextValAsync();
                }
                return val;
            });
        });
    };
    return getNextValAsync;
};

JobProcessor.prototype.jobProcessorThreadAsync = function(threadId) {
    var self = this;
    return this.iterator().then(function (tile) {
        if (tile) {
            // generate tile and repeat
            return self.generateTileAsync(tile).then(function () {
                self.stats.processed++;
                self.job.progress(tile.idx - self.job.data.idxFrom, self.job.data.count, self.stats);
                return self.jobProcessorThreadAsync(threadId);
            });
        }
        self.job.log('Thread %d finished', threadId);
    });
};

JobProcessor.prototype.generateTileAsync = function(tile) {
    var self = this,
        stats = self.stats,
        xy = sUtil.indexToXY(tile.idx),
        x = xy[0],
        y = xy[1];

    return BBPromise.try(function () {
        stats.tilegen++;
        return self.tileGenerator.getTileAsync(tile.zoom, x, y);
    }).then(function (dataAndHeader) {
        stats.tilegenok++;
        return dataAndHeader[0];
    }, function (err) {
        if (err.message === 'Tile does not exist') {
            stats.tilegenempty++;
            return null;
        } else {
            stats.tilegenerr++;
            throw err;
        }
    }).then(function (data) {
        if (!data || !data.length) {
            stats.tilenodata++;
            return false; // empty tile generated, no need to save
        }
        if (data.length >= config.maxsize) {
            stats.tiletoobig++;
            return true; // generated tile is too big, save
        }
        var vt = new mapnik.VectorTile(tile.zoom, x, y);
        return sUtil.uncompressAsync(data)
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
                    var stat = 'solid_' + key;
                    if (stat in stats) {
                        stats[stat][0]++;
                    } else {
                        stats[stat] = [1];
                    }
                    if (stats[stat].length < 3) {
                        // Record the first few tiles of this type
                        stats[stat].push(tile.idx)
                    }
                    return null;
                } else {
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
        }
        return self.tileStore.putTileAsync(tile.zoom, x, y, data);
    });
};

/**
 * Web server (express) route handler to show current queue
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function enque(req, res, next) {
    queue.addJobAsync({
        threads: req.query.threads,
        storageId: req.query.storageId,
        generatorId: req.query.generatorId,
        zoom: req.query.zoom,
        priority: req.query.priority,
        idxFrom: req.query.idxFrom,
        idxBefore: req.query.idxBefore,
        count: req.query.count,
        dateBefore: req.query.dateBefore,
        dateFrom: req.query.dateFrom,
        biggerThan: req.query.biggerThan,
        smallerThan: req.query.smallerThan,
        invert: req.query.invert ? true : false,
        checkZoom: req.query.checkZoom,
        parts: req.query.parts
    }).then(function(job) {
        res.type('application/json').send(JSON.stringify(job, null, '  '));
    }, function(err) {
        res.type('application/json').send(JSON.stringify(err, null, '  '));
    });
}

router.get('/add', enque);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
