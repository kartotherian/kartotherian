'use strict';

let _ = require('underscore'),
    util = require('util'),
    numeral = require('numeral'),
    core = require('kartotherian-core'),
    Err = core.Err,
    allowedProps = [
        'zoom', 'x', 'y', 'idxFrom', 'idxBefore', 'fromZoom', 'beforeZoom', 'parts', 'sources', 'storageId',
        'generatorId', 'deleteEmpty', 'keepJob', 'filters', 'priority', 'tiles', '_encodedTiles'
    ];


module.exports = Job;

/**
 * @param opts
 * @param {int} opts.zoom
 * @param {int} opts.x
 * @param {int} opts.y
 * @param {int} opts.idxFrom
 * @param {int} opts.idxBefore
 * @param {int} opts.fromZoom
 * @param {int} opts.beforeZoom
 * @param {int} opts.parts
 * @param {object} opts.sources
 * @param {string} opts.storageId
 * @param {string} opts.generatorId
 * @param {bool} opts.deleteEmpty
 * @param {bool} opts.keepJob
 * @param {object[]} opts.filters
 * @param {int|string} opts.priority
 * @param {(int|int[])[]} opts.tiles
 * @param {int[]} opts._encodedTiles
 * @param {object=} stats
 * @constructor
 */
function Job(opts, stats) {

    if (!_.isObject(opts) || (stats !== undefined && !_.isObject(stats))){
        throw new Err('Bad job params');
    }

    let self = this;
    _.each(allowedProps, function (prop) {
        if (opts.hasOwnProperty(prop)) {
            self[prop] = opts[prop];
        }
    });

    core.checkType(this, 'fromZoom', 'zoom');
    core.checkType(this, 'beforeZoom', 'zoom', undefined, this.fromZoom);
    core.checkType(this, 'parts', 'integer', undefined, 1, 1000);
    if (this.parts === 1) {
        delete this.parts;
    }

    if (this.isComplex()) {
        if((this.fromZoom === undefined) !== (this.beforeZoom === undefined)) {
            throw new Err('When present, both fromZoom and beforeZoom must be present');
        }
    }

    core.checkType(this, 'storageId', 'string', true, 1);
    core.checkType(this, 'generatorId', 'string', true, 1);
    core.checkType(this, 'zoom', 'zoom', true);
    core.checkType(this, 'deleteEmpty', 'boolean');
    core.checkType(this, 'keepJob', 'boolean');

    let zoom = this.zoom,
        maxCount = Math.pow(4, zoom);

    // Convert x,y coordinates into idxdFrom & idxBefore
    if (this.x !== undefined || this.y !== undefined ) {
        if (this.idxFrom !== undefined || this.idxBefore !== undefined) {
            throw new Err('idxFrom and idxBefore are not allowed when using x,y');
        }
        if (this.x === undefined || this.y === undefined) {
            throw new Err('Both x and y must be given');
        }
        core.checkType(this, 'x', 'integer', true);
        core.checkType(this, 'y', 'integer', true);
        if (!core.isValidCoordinate(this.x, zoom) || !core.isValidCoordinate(this.y, zoom)) {
            throw new Err('Invalid x,y coordinates for the given zoom');
        }
        this.idxFrom = core.xyToIndex(this.x, this.y);
        this.idxBefore = this.idxFrom + 1;
        delete this.x;
        delete this.y;
    }

    core.checkType(this, 'idxFrom', 'integer', undefined, 0, maxCount);
    core.checkType(this, 'idxBefore', 'integer', undefined, this.idxFrom || 0, maxCount);
    if (this.idxFrom !== undefined || this.idxBefore !== undefined) {
        if (this.tiles || this._encodedTiles) {
            throw new Err('tiles and _encodedTiles must not be present when used with idxFrom, idxBefore, x, y');
        }
        this.tiles = [[this.idxFrom, this.idxBefore]];
        delete this.idxFrom;
        delete this.idxBefore;
    }

    core.checkType(this, 'tiles', 'array');
    core.checkType(this, '_encodedTiles', 'array');

    core.checkType(this, 'sources', 'object');

    // priority can be both a number and a string like 'highest', so don't check
    this.priority = this.priority || 0;

    if (core.checkType(this, 'filters', 'object')) {
        if (!Array.isArray(this.filters)) {
            this.filters = [this.filters];
        }
        _.each(this.filters, function(filter, ind, all) {
            // Each filter except last must have its own zoom level. Last is optional
            // Each next zoom level must be bigger than the one before, but less than or equal to job's zoom
            // Special case - negative zoom implies job's zoom - N
            // Zoom will only be checked after complex jobs are expanded into simple ones
            if (core.checkType(filter, 'zoom', 'integer') && !this.isComplex()) {
                if (filter.zoom < 0) {
                    filter.zoom = this.zoom + filter.zoom;
                }
                core.checkType(filter, 'zoom', 'zoom',
                    ind < all.length - 1,
                    ind === 0 ? 0 : all[ind - 1].zoom + 1,
                    this.zoom);
            }
            let hasDateFrom = core.checkType(filter, 'dateFrom', '[object Date]'),
                hasDateBefore = core.checkType(filter, 'dateBefore', '[object Date]');
            if (hasDateFrom && hasDateBefore && filter.dateFrom >= filter.dateBefore ) {
                throw new Err('Invalid dates: dateFrom must be less than dateBefore');
            }
            core.checkType(filter, 'biggerThan', 'integer');
            core.checkType(filter, 'smallerThan', 'integer');
            core.checkType(filter, 'missing', 'boolean');
            core.checkType(filter, 'sourceId', 'string', false, 1);
        }, this);
    }

    if (this.tiles && this.tiles.length === 0) {
        this.tiles = [[0, 0]]; // epmyt set - simplifies other code
    }
    if (this._encodedTiles && this.tiles) {
        throw new Err('Both tiles and _encodedTiles are set');
    } else if (this._encodedTiles) {
        this._decodeTileList();
    } else if (this.tiles) {
        // validate data and calculate job size by encoding tiles and restoring them
        let tempTiles = this.tiles;
        this._encodeTileList();
        delete this._encodedTiles;
        this.tiles = tempTiles;
    } else {
        // process entire zoom level
        this.tiles = [[0, maxCount]];
        this.size = maxCount;
    }
    this._setJobTitle();

    stats = stats || {};
    stats.jobStart = new Date();
    stats.processed = stats.processed || 0;
    stats.processedAtRestart = stats.processed;
    let minFrom = groupFrom(this.tiles[0]),
        maxBefore = groupBefore(this.tiles[this.tiles.length - 1]);
    if (core.checkType(stats, 'lastCompleteIdx', 'integer', undefined, minFrom, maxBefore - 1)) {
        minFrom = stats.lastCompleteIdx + 1;
    }
    core.checkType(stats, 'jobIdxBefore', 'integer', maxBefore, minFrom, maxBefore);
    this.stats = stats;

    this._currentRange = 0;
}

/**
 * Get [idxFrom, idxBefore] to the values of the next valid range to be processed
 * @returns {boolean|int[]} when false, no more ranges, or returns a range
 */
Job.prototype.moveNextRange = function moveNextRange () {

    var result = undefined;

    this._assertSimple();
    this._currentRange = this.iterateOverRanges(this._currentRange, function(idxFrom, idxBefore) {
        result = [idxFrom, idxBefore];
        return false;
    });

    return result;
};

/**
 * Iterate over all ranges left to do, and call the callback for each. If callback returns false, stops iteration
 * @param {int} startRange index of the range to start iterating from
 * @param {Function} callback
 * @return {int} current range index
 */
Job.prototype.iterateOverRanges = function iterateOverRanges(startRange, callback) {
    let range = startRange,
        jobIdxFrom = this.stats.lastCompleteIdx === undefined
            ? groupFrom(this.tiles[0])
            : this.stats.lastCompleteIdx + 1;

    while (range < this.tiles.length) {
        let val = this.tiles[range++],
            idxFrom = groupFrom(val),
            idxBefore = groupBefore(val);

        if (idxFrom > this.stats.jobIdxBefore) {
            break; // done iterating - job has been shrunk
        } else if (idxFrom < jobIdxFrom) {
            idxFrom = jobIdxFrom;
        }
        if (idxBefore <= jobIdxFrom) {
            continue; // skip this range
        } else if (idxBefore > this.stats.jobIdxBefore) {
            idxBefore = this.stats.jobIdxBefore;
        }
        if (!callback(idxFrom, idxBefore)) {
            break;
        }
    }
    return range;
};

function addRange(tiles, rng) {
    if (rng) {
        let count = rng[1] - rng[0];
        tiles.push(count === 1 ? rng[0] : rng);
        return count;
    } else {
        return 0;
    }
}

/**
 * Split current job into N parts
 * @returns {Job[]}
 */
Job.prototype.splitJob = function splitJob(parts) {
    this._assertSimple();
    if (parts < 1) {
        throw new Err('Invalid parts count');
    } else if (parts === 1) {
        return [];
    }
    let subJobs = this.expandJobs(parts);
    if (subJobs.length > 1) {
        // Reduce current tile count left to do
        let newTiles = subJobs[0].tiles;
        this.stats.jobIdxBefore = groupBefore(newTiles[newTiles.length - 1]);
        subJobs.shift();
        this.size -= subJobs.reduce(function(acc, sj) {
            return acc + sj.size;
        }, 0);
        this._setJobTitle();

        return subJobs;
    } else {
        return [];
    }
};

/**
 * If the current job has a range of zooms (pyramid), returns a list of corresponding single zoom jobs.
 * If the current job has multiple parts (parts !== undefined), break it into that number of parts.
 * If nothing can be split, wraps current job in an array and returns it
 * @returns {Job[]}
 */
Job.prototype.expandJobs = function expandJobs(partsOverride) {
    if (!this.isComplex() && partsOverride === 1) {
        return [this];
    }

    let self = this,
        fromZoom = self.fromZoom === undefined ? self.zoom : self.fromZoom,
        beforeZoom = self.beforeZoom === undefined ? self.zoom + 1 : self.beforeZoom,
        result = [];

    for (let zoom = fromZoom; zoom < beforeZoom; zoom ++) {
        let mult = Math.pow(4, Math.abs(zoom - self.zoom)),
            opts = _.clone(self),
            size = 0,
            tiles = [],
            lastRange = undefined;

        if (zoom < self.zoom) mult = 1 / mult;

        delete opts.fromZoom;
        delete opts.beforeZoom;
        delete opts.parts;
        delete opts.tiles;
        delete opts.size;
        opts.zoom = zoom;

        // To split properly, calculate job size at this zoom level, and scale to the needed zoom
        this.iterateOverRanges(0, function(idxFrom, idxBefore) {
            let frm = Math.floor(idxFrom * mult),
                bfr = Math.ceil(idxBefore * mult);
            if (lastRange && lastRange[1] >= frm) {
                lastRange[1] = bfr;
            } else {
                size += addRange(tiles, lastRange);
                lastRange = [frm, bfr];
            }
            return true;
        });
        size += addRange(tiles, lastRange);

        let parts = partsOverride || self.parts || 1;
        if (parts > 1) {
            // must use ceiling to exhaust all tiles before we reach the end
            let partMaxSize = Math.ceil(size / parts),
                chunkSize = 0,
                chunkTiles = [];
            tiles.forEach(function (v, vInd, tiles) {
                let isLastValue = vInd + 1 === tiles.length,
                    frm = groupFrom(v),
                    bfr = groupBefore(v);

                    while (frm < bfr) {
                        let add = Math.min(partMaxSize - chunkSize, bfr - frm);
                        chunkTiles.push(add > 1 ? [frm, frm + add] : frm);
                        chunkSize += add;
                        frm += add;
                        if (chunkSize === partMaxSize || (isLastValue && frm >= bfr)) {
                            opts.tiles = chunkTiles;
                            result.push(new Job(opts));
                            chunkTiles = [];
                            size -= chunkSize;
                            parts--;
                            partMaxSize = parts ? Math.ceil(size / parts) : 0;
                            chunkSize = 0;
                        }
                    }
            });
            if (chunkSize > 0) {
                throw new Err('Logic error - chunkSize > 0');
            }
        } else {
            opts.tiles = tiles;
            result.push(new Job(opts));
        }
    }

    return result;
};

/**
 * Tiles value is an array of integers. Each non-negative integer represents the delta
 * from the last index minus one. So a sequence [0, 0, 0, 1] represents indexes [0, 1, 2, 4].
 * Negative integer represents a range of indexes starting with the next index, of abs of that length plus one.
 * For example, [0,0,2,-2,1] would mean [0, 1, 3, 4, 5, 7]
 * @returns {number[]}
 */
Job.prototype._decodeTileList = function _decodeTileList() {
    let size = 0,
        last = -1,
        maxCount = Math.pow(4, this.zoom),
        result = [],
        rangeSize = 0;

    if (!_.all(this._encodedTiles, function (v) {
                if (!core.isInteger(v)) {
                    return false;
                }
                if (rangeSize === 0) {
                    if (v >= 0) {
                        // Individual tile index
                        size++;
                        last += (v + 1);
                        result.push(last);
                    } else {
                        // This is the range size
                        rangeSize = -v + 1;
                    }
                } else {
                    if (v < 0) {
                        return false;
                    }
                    size += rangeSize;
                    result.push([last + v + 1, last + v + rangeSize + 1]);
                    last += v + rangeSize;
                    rangeSize = 0;
                }

                return last < maxCount;
            }
        ) || rangeSize !== 0
    ) {
        throw new Err('Invalid _encodedTiles parameter');
    }

    this._updateSize(size);
    this.tiles = result;
    delete this._encodedTiles;
};

Job.prototype._encodeTileList = function _encodeTileList() {
    let size = 0,
        last = -1,
        maxCount = Math.pow(4, this.zoom),
        result = [],
        checkIdx = function (v, min, max) {
            return core.isInteger(v) && v > min && v < max;
        };

    if (!_.all(this.tiles, function (v) {
            if (checkIdx(v, last, maxCount)) {
                result.push(v - last - 1);
                size++;
                last = v;
            } else if (Array.isArray(v) && v.length === 2 &&
                checkIdx(v[0], last, maxCount) &&
                checkIdx(v[1], v[0] - 1, maxCount + 1)
            ) {
                let count = v[1] - v[0];
                if (count > 0) { // skip empty ranges
                    if (count > 1) {
                        result.push(-(count - 1)); // negative of the range size - 1
                    }
                    result.push(v[0] - last - 1); // range start as a delta from last index
                    size += count;
                    last = v[1] - 1;
                }
            } else {
                return false;
            }
            return true;
        })
    ) {
        throw new Err('Invalid tiles parameter');
    }

    this._updateSize(size);
    this._encodedTiles = result;
    delete this.tiles;
};

Job.prototype._updateSize = function _updateSize(size) {
    if (this.size == undefined) {
        this.size = size;
    } else if (size !== this.size) {
        throw new Err('Tile list size does not match expected size');
    }
};

Job.prototype._setJobTitle = function _setJobTitle() {
    this.title = util.format('Z=%d', this.zoom);
    let zoomMax = Math.pow(4, this.zoom),
        idxFrom = groupFrom(this.tiles[0]),
        idxBefore = groupBefore(this.tiles[this.tiles.length - 1]);

    if (this.size === 0) {
        this.title += '; EMPTY'
    } else if (this.size === zoomMax) {
        this.title += util.format('; ALL (%s)', numeral(zoomMax).format('0,0'));
    } else if (this.size === 1) {
        let xy = core.indexToXY(idxFrom);
        this.title += util.format('; 1 tile at [%d,%d] (idx=%d)', xy[0], xy[1], idxFrom);
    } else {
        let xyFrom = core.indexToXY(idxFrom),
            xyLast = core.indexToXY(idxBefore - 1);
        this.title += util.format('; %s tiles (%s%s‒%s; [%d,%d]‒[%d,%d])',
            numeral(this.size).format('0,0'),
            this.tiles.length > 1 ? numeral(this.tiles.length).format('0,0') + ' groups; ' : '',
            numeral(idxFrom).format('0,0'),
            numeral(idxBefore).format('0,0'),
            xyFrom[0], xyFrom[1], xyLast[0], xyLast[1]);
    }
    this.title += util.format('; %s→%s', this.generatorId, this.storageId);
};

function groupFrom(group) {
    return Array.isArray(group) ? group[0] : group;
}

function groupBefore(group) {
    return Array.isArray(group) ? group[1] : group + 1;
}

Job.prototype.isComplex = function _assertSimple() {
    return this.fromZoom !== undefined || this.beforeZoom !== undefined || this.parts !== undefined;
};

Job.prototype._assertSimple = function _assertSimple() {
    if (this.isComplex()) {
        throw new Err('Pyramid or multi-part job is not supported');
    }
};

Job.prototype.cleanupForQue = function cleanupForQue() {
    this._assertSimple();
    if (this._currentRange !== 0) {
        throw new Err('Started job cannot be saved');
    }
    delete this.stats;
    this._encodeTileList();
};

/**
 * Figure out the position of it within the tiles
 * For example, if tiles are [[10,20], [40,60]], index 10 is 0, index 60 is the same as size - 30, etc.
 * If index is not within valid ranges, an error is thrown
 */
Job.prototype.calculateProgress = function calculateProgress() {
    let pos = 0,
        index = this.stats.lastCompleteIdx;
    if (index === undefined) {
        return 0;
    }

    this._assertSimple();
    for (let v of this.tiles) {
        let frm = groupFrom(v),
            bfr = groupBefore(v);
        if (index < frm) {
            break;
        } else if (index >= bfr) {
            pos += bfr - frm;
        } else {
            return pos + (index - frm) + 1;
        }
    }
    throw new Err('index is not within this job');
};

/**
 * Notify the job that the a tile has been processed
 * @param {int} index
 */
Job.prototype.completeIndex = function completeIndex(index) {
    if (!this.isValidIndex(index)) {
        throw new Err('Index outside of valid range');
    }
    var stats = this.stats,
        execTime = (new Date() - stats.jobStart) / 1000;
    stats.processed++;
    stats.lastCompleteIdx = index;
    stats.itemsPerSec = execTime > 0 ? Math.round((stats.processed - stats.processedAtRestart) / execTime * 10) / 10 : 0;
    stats.sizeAvg = stats.save > 0 ? Math.round(stats.totalsize / stats.save * 10) / 10 : 0;

};

/**
 * Is index within the range of the whole job
 * @param {int} index
 * @returns {boolean}
 */
Job.prototype.isValidIndex = function isValidIndex(index) {
    return index < this.stats.jobIdxBefore &&
        (this.stats.lastCompleteIdx === undefined
            ? groupFrom(this.tiles[0]) <= index
            : this.stats.lastCompleteIdx < index);
};
