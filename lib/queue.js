'use strict';

var BBPromise = require('bluebird');
var util = require('./util');

module.exports = {};

module.exports.Queue = function() {
    this.que = [];
    this.done = [];
};

/**
 * Utility method to convert any string parameter into a number, or leave it as is if the number is not valid/reversable
 * @param task
 * @param prop
 */
function strToInt(task, prop) {
    if (task.hasOwnProperty(prop)) {
        var v = task[prop];
        if (typeof v === 'string') {
            var v2 = parseInt(v);
            if (v2.toString() === v) {
                task[prop] = v2;
            }
        }
    }
}

/**
 * Enque task for later processing
 * @param task object
 *  Mandatory field:
 *  - storageId - string ID of the tile storage as defined in the configuration
 *  - generatorId - string ID of the tile generator as defined in the configuration
 *  - zoom property (integer)
 *  Optional:
 *  - priority - integer, default 5
 *  - idxFrom - integer index, default 0
 *  - idxBefore - integer index, default 4^zoom, cannot be used with 'count'
 *  - count - integer, defaults to (4^zoom-idxFrom), cannot be used with 'idxBefore'
 *  - dateBefore - Date object to process tiles only older than this timestamp, or false to disable. false by default.
 *  - dateFrom - Date object to process tiles only newer than this timestamp, or false to disable. false by default.
 *  - biggerThan - number - only process tiles whose compressed size is bigger than this value (inclusive)
 *  - smallerThan - number - only process tiles whose compressed size is smaller than this value (exclusive)
 *  - invert - boolean - if true, yields all tiles that do not match the filtering fields:
 *                        dateBefore, dateAfter, biggerThan, smallerThan. Otherwise yields only those that match.
 *                        Default false. If no filtering fields are given, this value is ignored.
 *  - checkZoom - tiles of which zoom should be checked with 'check' param. By default, equals to zoom.
 *  - layers    - list of layer IDs (strings) to update
 *  - threads   - number of simultaneous threads (same process) to work on this task. 1 by default
 * @returns {module.exports.Queue}
 */
module.exports.Queue.prototype.addTask = function(task) {
    strToInt(task, 'zoom');
    strToInt(task, 'priority');
    strToInt(task, 'idxFrom');
    strToInt(task, 'idxBefore');
    strToInt(task, 'count');
    strToInt(task, 'biggerThan');
    strToInt(task, 'smallerThan');
    strToInt(task, 'checkZoom');
    strToInt(task, 'threads');

    var tmp;
    if (typeof task.storageId !== 'string' || task.storageId.length === 0) {
        throw new Error('Invalid storageId parameter');
    }
    if (typeof task.generatorId !== 'string' || task.generatorId.length === 0) {
        throw new Error('Invalid generatorId parameter');
    }
    if (typeof task.zoom !== 'number' || task.zoom < 0 || task.zoom > 32) {
        throw new Error('Invalid params: zoom=%d', task.zoom);
    }
    var maxCount = Math.pow(4, task.zoom);
    if (!task.priority) {
        task.priority = 5;
    }
    if (typeof task.idxFrom === 'undefined') {
        task.idxFrom = 0;
    } else if (typeof task.idxFrom !== 'number' || task.idxFrom < 0) {
        throw new Error('Invalid params: idxFrom=%d', task.idxFrom);
    }
    if (typeof task.count !== 'undefined') {
        if (typeof task.idxBefore !== 'undefined') {
            throw new Error('Both idxBefore and count cannot be set at the same time');
        }
        if (typeof task.count !== 'number' || task.count < 0 || task.idxFrom + task.count > maxCount) {
            throw new Error('Invalid params: zoom=%d, idxFrom=%d, count=%d', task.zoom, task.idxFrom, task.count);
        }
        task.idxBefore = task.idxFrom + task.count;
    } else {
        if (typeof task.idxBefore !== 'undefined') {
            if (typeof task.idxBefore !== 'number' || task.idxBefore < 0 || task.idxBefore > maxCount) {
                throw new Error('Invalid params: zoom=%d, idxFrom=%d, idxBefore=%d', task.zoom, task.idxFrom, task.idxBefore);
            }
        } else {
            task.idxBefore = maxCount;
        }
        task.count = task.idxBefore - task.idxFrom;
    }
    if (task.dateBefore !== false) {
        if (typeof task.dateBefore === 'undefined') {
            task.dateBefore = false;
        } else {
            tmp = Object.prototype.toString.call(task.dateBefore);
            if (tmp !== '[object Date]') {
                throw new Error('Invalid dateBefore param type %s given, but [object Date] expected', tmp);
            }
        }
    }
    if (task.dateFrom !== false) {
        if (typeof task.dateFrom === 'undefined') {
            task.dateFrom = false;
        } else {
            tmp = Object.prototype.toString.call(task.dateFrom);
            if (tmp !== '[object Date]') {
                throw new Error('Invalid dateFrom param type %s given, but [object Date] expected', tmp);
            }
            if (task.dateBefore && task.dateFrom >= task.dateBefore) {
                throw new Error('Invalid dates: dateFrom must be less than dateBefore');
            }
        }
    }
    if (task.biggerThan !== false) {
        if (typeof task.biggerThan === 'undefined') {
            task.biggerThan = false;
        } else if (typeof task.biggerThan !== 'number') {
            throw new Error('Invalid biggerThan value %s, expected a number', task.biggerThan);
        }
    }
    if (task.smallerThan !== false) {
        if (typeof task.smallerThan === 'undefined') {
            task.smallerThan = false;
        } else if (typeof task.smallerThan !== 'number') {
            throw new Error('Invalid smallerThan value %s, expected a number', task.smallerThan);
        }
    }
    if (typeof task.invert !== 'undefined' && typeof task.invert !== 'boolean') {
        throw new Error('Invalid invert value %s, expected boolean', task.invert);
    }
    if (typeof task.checkZoom === 'undefined' || task.checkZoom === false) {
        task.checkZoom = false;
    } else if (typeof task.checkZoom !== 'number' || task.checkZoom < 0 || task.checkZoom >= task.zoom) {
        throw new Error('Invalid checkZoom value %s, expected a valid 0 <= zoom < %d', task.checkZoom, task.zoom);
    }
    if (typeof task.layers !== 'undefined') {
        if (typeof task.layers === 'string') {
            task.layers = [task.layers];
        } else if (!Array.isArray(task.layers) ||
            !_.every(task.layers, function(v) { return typeof v === 'string' && v.length > 0; })
        ) {
            throw new Error('Invalid layers value %s, must be a list of nonempty strings', task.layers);
        }
    }
    if (typeof task.threads === 'undefined') {
        task.threads = 1;
    } else if (typeof task.threads !== 'number' || task.threads < 1 || task.threads > 100) {
        throw new Error('Invalid params: threads=%d', task.threads);
    }
    task.id = Math.floor(Math.random() * 1000000);
    if (task.count > 0)
        this.que.push(task);
    return this;
};

/**
 * Given an x,y (startIdx) of the baseZoom, enqueue all tiles below them, with zooms >= zoomFrom and < zoomBefore
 */
module.exports.Queue.prototype.addPyramidTasks = function(baseZoom, startIdx, count, zoomFrom, zoomBefore, options) {
    var opts = _.clone(options);
    delete opts.zoom;
    delete opts.idxFrom;
    delete opts.idxBefore;
    delete opts.count;
    if (typeof opts.dateBefore === 'undefined') {
        opts.dateBefore = new Date();
    }
    for (var z = zoomFrom; z < zoomBefore; z++) {
        var mult = Math.pow(4, z - baseZoom);
        this.addTask(_.extend({
            zoom: z,
            idxFrom: startIdx * mult,
            count: count * mult
        }, opts));
    }
    return this;
};

/**
 * Get an unfinished task, or waits until it gets enqueued
 * @returns {*}
 */
module.exports.Queue.prototype.removeTask = function(id) {
    var self = this;
    this.que = _.filter(this.que, function (v) {
        if (v.id === id) {
            self.done.push(v);
            return false;
        } else {
            return true;
        }
    });
};

/**
 * Get a task to work on, if unavailable, waits until it gets enqueued
 * @returns {*}
 */
module.exports.Queue.prototype.getTaskAsync = function() {
    var task = this.que.shift();
    if (!task) {
        // TODO: polling is evil
        return BBPromise.delay(300).bind(this).then(this.getTaskAsync);
    }
    this.done.push(task);
    return BBPromise.resolve(task);
};
