'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');

var mapnik = require('mapnik');
var sUtil = require('../lib/util');
var util = require('util');
var queue = require('../lib/queue');
var que = new queue.Queue();

var router = sUtil.router();

var config = {
    // Assume the tile needs to be saved if its compressed size is above this value
    // Skips the Mapnik's isSolid() call
    maxsize: 5 * 1024,

    // Logging levels. TODO: remove
    log: 1
};

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    var log = app.logger.log.bind(app.logger);

    // todo: need to crash if this fails to load
    // todo: implement dynamic configuration reloading
    require('../lib/conf')
        .loadConfigurationAsync(app)
        .then(taskProcessorAsync)
        .catch(function (err) {
            console.error((err.body && (err.body.stack || err.body.detail)) || err.stack || err);
            process.exit(1);
        });
}

function taskProcessorAsync(conf) {
    var currentTask;
    return que.getTaskAsync().then(function (task) {
        currentTask = task;
        return (new TaskProcessor(conf, task)).runAsync();
    }).catch(function (err) {
        currentTask.error = err;
        currentTask.errorMsg = err.toString();
        console.log(err);
    }).then(function () {
        currentTask = undefined;
        // loop tasks until interrupted
        return taskProcessorAsync(conf);
    });
}

function TaskProcessor(conf, task) {
    if (!(task.generatorId in conf)) {
        throw new Error(task.generatorId + ' generatorId is not defined');
    }
    if (!(task.storageId in conf)) {
        throw new Error(task.storageId + ' storageId is not defined');
    }
    this.conf = conf;
    this.task = task;
    this.tileGenerator = conf[task.generatorId].handler;
    this.tileStore = conf[task.storageId].handler;
}

/**
 * Do the task, resolves promise when the task is complete
 * @returns {*}
 */
TaskProcessor.prototype.runAsync = function() {
    var self = this;
    var task = self.task;
    return BBPromise.try(function () {
        task.stats = {
            start: new Date(),
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
            log: []
        };
        var iterator = self.getIterator(task);
        self.iterator = function() {
            return iterator().then(function(val) {
                if (val)
                    task.index = val.idx;
                return val;
            });
        };
        var threads = _.map(_.range(task.threads), function (threadId) {
            return self.taskProcessorThreadAsync(threadId);
        });
        return BBPromise.all(threads).then(function () {
            task.stats.finish = new Date();
        });
    });
};

TaskProcessor.prototype.getIterator = function(task) {
    var iter = this.getZoomCheckIterator(task);
    if (!iter)
        iter = this.getExistingTilesIterator(task);
    if (!iter)
        iter = this.getSimpleIterator(task);
    return iter;
};

TaskProcessor.prototype.getSimpleIterator = function(task) {
    var idx = task.idxFrom;
    return function() {
        var result = undefined;
        if (idx < task.idxBefore) {
            result = {zoom: task.zoom, idx: idx++};
        }
        return BBPromise.resolve(result);
    }
};

TaskProcessor.prototype.getExistingTilesIterator = function(task) {
    if (task.dateBefore === false && task.dateFrom === false &&
        task.biggerThan === false && task.smallerThan === false
    ) {
        return false;
    }

    var invert = task.invert;
    var opts = {
        zoom: task.zoom,
        idxFrom: task.idxFrom,
        idxBefore: task.idxBefore
    };
    if (task.dateBefore !== false) {
        if (!invert)
            opts.dateBefore = task.dateBefore;
        else
            opts.dateFrom = task.dateBefore;
    }
    if (task.dateFrom !== false) {
        if (!invert)
            opts.dateFrom = task.dateFrom;
        else
            opts.dateBefore = task.dateFrom;
    }
    if (task.biggerThan !== false) {
        if (!invert)
            opts.biggerThan = task.biggerThan;
        else
            opts.smallerThan = task.biggerThan;
    }
    if (task.smallerThan !== false) {
        if (!invert)
            opts.smallerThan = task.smallerThan;
        else
            opts.biggerThan = task.smallerThan;
    }
    var iterator = this.tileStore.query(opts);
    if (invert)
        iterator = this.getInvertingIterator(task, iterator);
    return iterator;
};

/**
 * Given an iterator, yield only those tiles that the iterator does NOT yield within the given task
 */
TaskProcessor.prototype.getInvertingIterator = function(task, iterator) {
    var idxNext = task.idxFrom,
        nextValP, isDone;
    var getNextValAsync = function () {
        if (isDone) {
            return BBPromise.resolve(undefined);
        } else if (!nextValP) {
            nextValP = iterator();
        }
        return nextValP.then(function (val) {
            var untilIdx = val === undefined ? task.idxBefore : val.idx;
            if (idxNext < untilIdx) {
                return {zoom: task.zoom, idx: idxNext++};
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
 * Iterate over all existing tiles in the task.checkZoom level, and for each found tile, perform regular sub-iteration
 * @param task
 */
TaskProcessor.prototype.getZoomCheckIterator = function(task) {
    if (task.checkZoom === false)
        return false;
    var scale = Math.pow(4, task.zoom - task.checkZoom);
    var opts = {
        zoom: task.checkZoom,
        idxFrom: task.idxFrom / scale,
        idxBefore: task.idxBefore / scale
    };
    var ozIter = this.tileStore.query(opts);
    var iter = false;
    var isDone = false;
    var getNextValAsync = function() {
        if (isDone)
            return BBPromise.resolve(undefined);
        if (!iter) {
            iter = ozIter().then(function (res) {
                if (res === undefined) {
                    isDone = true;
                    return res; // done iterating
                }
                var t = _.clone(task);
                delete t.checkZoom;
                t.idxFrom = Math.max(task.idxFrom, res.idx * scale);
                t.idxBefore = Math.min(task.idxBefore, (res.idx + 1) * scale);
                t.count = t.idxBefore - t.idxFrom;
                return self.getIterator(t);
            });
        }
        return iter.then(function(val) {
            if (val === undefined) {
                iter = false;
                return getNextValAsync();
            }
            return val;
        });
    };
    return getNextValAsync;
};

TaskProcessor.prototype.taskProcessorThreadAsync = function(threadId) {
    var self = this;
    return this.iterator().then(function (loc) {
        if (loc) {
            // generate tile and repeat
            //self.task.stats.log.push(util.format('%d: Thread #%d: %d %d',
            //    self.task.stats.log.length, threadId, loc.zoom, loc.idx));
            return self.generateTileAsync(loc).then(function () {
                self.task.stats.processed++;
                return self.taskProcessorThreadAsync(threadId);
            });
        }
        console.log('Task %s: thread %d finished', self.task.id, threadId);
    });
};

TaskProcessor.prototype.generateTileAsync = function(tile) {
    var self = this,
        task = self.task,
        xy = sUtil.indexToXY(tile.idx),
        loc = {z: tile.zoom, x: xy[0], y: xy[1]};

    return BBPromise.try(function () {
        task.stats.tilegen++;
        return self.tileGenerator.getTileAsync(loc.z, loc.x, loc.y);
    }).then(function (tile) {
        task.stats.tilegenok++;
        loc.data = tile[0];
        loc.headers = tile[1];
        return loc;
    }, function (err) {
        if (err.message === 'Tile does not exist') {
            task.stats.tilegenempty++;
            loc.data = null;
            return loc;
        } else {
            task.stats.tilegenerr++;
            throw err;
        }
    }).then(function (loc) {
        if (!loc.data || !loc.data.length) {
            task.stats.tilenodata++;
            return false; // empty tile generated, no need to save
        }
        if (loc.data.length >= config.maxsize) {
            task.stats.tiletoobig++;
            return true; // generated tile is too big, save
        }
        var vt = new mapnik.VectorTile(loc.z, loc.x, loc.y);
        return sUtil.uncompressAsync(loc.data)
            .bind(vt)
            .then(function (uncompressed) {
                return this.setDataAsync(uncompressed);
            }).then(function () {
                return this.parseAsync();
            }).then(function () {
                return this.isSolidAsync();
            }).spread(function (solid, key) {
                if (solid) {
                    var stat = 'solid_' + key;
                    task.stats[stat] = (stat in task.stats) ? task.stats[stat] + 1 : 1;
                    if (config.log > 0 && key !== 'water' && key !== 'landuse')
                        console.log('%d,%d,%d is solid %s', loc.z, loc.x, loc.y, key);
                    return false;
                } else {
                    task.stats.tilenonsolid++;
                    return true;
                }
            });
    }).then(function (save) {
        if (save) {
            task.stats.save++;
            task.stats.totalsize += loc.data.length;
            return self.tileStore.putTileAsync(loc.z, loc.x, loc.y, loc.data);
        } else {
            task.stats.nosave++;
            return self.tileStore.putTileAsync(loc.z, loc.x, loc.y, null);
        }
    });
};

/**
 * Web server (express) route handler to show current que
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function status(req, res, next) {
    res.type('application/json').send('Done:\n' + JSON.stringify(que.done, null, '  ') +
        '\n\nPending:\n' + JSON.stringify(que.que, null, '  '));
}

/**
 * Web server (express) route handler to show current que
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function enque(req, res, next) {
    que.addTask({
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
        checkZoom: req.query.checkZoom
    });
    next();
}

/**
 * Web server (express) route handler to show current que
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function deque(req, res, next) {
    que.getTaskAsync().then(function(loc) {
        next();
    });
}

/**
 * Web server (express) route handler to delete que item
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function delQueItem(req, res, next) {
    que.removeTask(req.params.id);
    next();
}

router.get('/que', status);
router.get('/add', enque, status);
router.get('/deq', deque, status);
router.get('/del/:id(\\d+)', delQueItem, status);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
