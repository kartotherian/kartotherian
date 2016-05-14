'use strict';

var _ = require('underscore');
var util = require('util');
var numeral = require('numeral');
var core = require('kartotherian-core');
var Err = core.Err;

module.exports = Job;

var allowedProps = [
    'beforeZoom', 'currentRange', 'deleteEmpty', 'encodedTiles', 'filters', 'fromZoom', 'generatorId',
    'idxBefore', 'idxFrom', 'isComplex', 'isIterating', 'layers', 'parts', 'priority', 'size', 'sources',
    'storageId', 'tiles', 'title', 'x', 'y', 'zoom'
];

function Job(opts) {

    var self = this;
    _.each(allowedProps, function (prop) {
        if (opts.hasOwnProperty(prop)) {
            self[prop] = opts[prop];
        }
    });

    core.checkType(this, 'fromZoom', 'zoom');
    core.checkType(this, 'beforeZoom', 'zoom', undefined, this.fromZoom);
    core.checkType(this, 'parts', 'integer', 1, 1, 1000);

    this.isComplex = this.fromZoom !== undefined || this.beforeZoom !== undefined || this.parts !== 1;
    if (this.isComplex) {
        if((this.fromZoom === undefined) !== (this.beforeZoom === undefined)) {
            throw new Err('When present, both fromZoom and beforeZoom must be present');
        }
    }

    core.checkType(this, 'storageId', 'string', true, 1);
    core.checkType(this, 'generatorId', 'string', true, 1);
    core.checkType(this, 'zoom', 'zoom', true);
    core.checkType(this, 'deleteEmpty', 'boolean');

    var zoom = this.zoom,
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

    if (core.checkType(this, 'idxFrom', 'integer', 0, 0, maxCount) ||
        core.checkType(this, 'idxBefore', 'integer', maxCount, this.idxFrom, maxCount)
    ) {
        if (this.tiles || this.encodedTiles) {
            throw new Err('tiles and encodedTiles must not be present when used with idxFrom, idxBefore, x, y');
        }
        this.tiles = [[this.idxFrom, this.idxBefore]];
        delete this.idxFrom;
        delete this.idxBefore;
    }

    core.checkType(this, 'tiles', 'array');
    core.checkType(this, 'encodedTiles', 'array');

    core.checkType(this, 'sources', 'object');
    core.checkType(this, 'layers', 'string-array');

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
            if (core.checkType(filter, 'zoom', 'integer')) {
                if (filter.zoom < 0) {
                    filter.zoom = this.zoom + filter.zoom;
                }
                core.checkType(filter, 'zoom', 'zoom',
                    ind < all.length - 1,
                    ind === 0 ? 0 : all[ind - 1].zoom + 1,
                    this.zoom);
            }
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
        }, this);
    }

    if (this.encodedTiles && this.tiles) {
        var tmp = this.encodedTiles;
        this._encodeTileList();
        if (!_.isEqual(tmp, this.encodedTiles)) {
            throw new Err('Both tiles and encodedTiles are set, and they do not match');
        }
    } else if (this.tiles) {
        this._encodeTileList();
    } else if (this.encodedTiles) {
        this._decodeTileList();
    } else {
        throw new Err('tiles parameter not set');
    }
    this.currentRange = undefined;
    this._setJobTitle();
}

/**
 * Update idxFrom, idxBefore, and currentRange to the values of the next valid range to be processed
 * if range and startIdx are given, overrides the current state
 * @returns {boolean} when false, no more ranges
 */
Job.prototype.moveNextRange = function moveNextRange (range, startIdx) {

    this._assertSimple();

    if (range !== undefined) {
        if (!core.isInteger(range) || range < 0 || range >= this.tiles.length) {
            throw new Err('range does not exist');
        }
        this.currentRange = range;
    } else {
        this.currentRange = this.currentRange === undefined ? 0 : this.currentRange + 1;
    }
    if (this.currentRange < this.tiles.length) {
        var val = this.tiles[this.currentRange];
        this.idxFrom = groupFrom(val);
        this.idxBefore = groupBefore(val);
        if (startIdx !== undefined) {
            if (startIdx < this.idxFrom || startIdx >= this.idxBefore) {
                throw new Err('startIdx is outside of the range');
            }
            this.idxFrom = startIdx;
        }
        return true;
    } else {
        this.currentRange = this.idxFrom = this.idxBefore = undefined;
        return false;
    }
};

Job.prototype.isIterating = function isIterating () {
    return this.currentRange !== undefined;
};

function addRange(tiles, rng) {
    if (rng) {
        var count = rng[1] - rng[0];
        tiles.push(count === 1 ? rng[0] : rng);
        return count;
    } else {
        return 0;
    }
}

/**
 * If the current job has a range of zooms (pyramid), returns a list of corresponding single zoom jobs.
 * If the current job has multiple parts (parts !== 1 or undefined), break it into that number of parts.
 * If nothing can be split, wraps current job in an array and returns it
 * @returns {array}
 */
Job.prototype.expandJobs = function expandJobs(opts) {
    if (this.isIterating()) {
        throw new Err('Cannot expand jobs while iterating');
    }
    var forcePartition = opts && opts.forcePartitions && opts.indexAfter;
    if (this.isComplex && forcePartition) {
        throw new Err('Cannot force partition a job with partitions or a pyramid');
    } else if (!this.isComplex && !forcePartition) {
        return [this];
    }

    var fromZoom = this.fromZoom === undefined ? this.zoom : this.fromZoom,
        beforeZoom = this.beforeZoom === undefined ? this.zoom + 1 : this.beforeZoom,
        result = [];

    _.range(fromZoom, beforeZoom).map(function (zoom) {
        var mult = Math.pow(4, Math.abs(zoom - this.zoom)),
            opts = _.clone(this),
            size = 0,
            tiles = [],
            lastRange = undefined;

        if (zoom < this.zoom) mult = 1 / mult;

        delete opts.fromZoom;
        delete opts.beforeZoom;
        delete opts.parts;
        delete opts.idxFrom;
        delete opts.idxBefore;
        delete opts.isComplex;
        delete opts.tiles;
        delete opts.encodedTiles;
        delete opts.size;
        opts.zoom = zoom;

        this.tiles.forEach(function (v) {
            var frm = Math.floor(groupFrom(v) * mult),
                bfr = Math.ceil(groupBefore(v) * mult);
            if (lastRange && lastRange[1] >= frm) {
                lastRange[1] = bfr;
            } else {
                size += addRange(tiles, lastRange);
                lastRange = [frm, bfr];
            }
        });
        size += addRange(tiles, lastRange);

        if (this.parts > 1) {
            // must use ceiling to exhaust all tiles before we reach the end
            var partMaxSize = Math.ceil(size / this.parts),
                chunkSize = 0,
                chunkTiles = [];
            tiles.forEach(function (v, vInd, tiles) {
                var isLastValue = vInd + 1 === tiles.length,
                    frm = groupFrom(v),
                    bfr = groupBefore(v);

                    while (frm < bfr) {
                        var add = Math.min(partMaxSize - chunkSize, bfr - frm);
                        chunkTiles.push(add > 1 ? [frm, frm + add] : frm);
                        chunkSize += add;
                        frm += add;
                        if (chunkSize === partMaxSize || (isLastValue && frm >= bfr)) {
                            opts.tiles = chunkTiles;
                            result.push(new Job(opts));
                            chunkTiles = [];
                            chunkSize = 0;
                        }
                    }
            }, this);
            if (chunkSize > 0) {
                throw new Err('Logic error - chunkSize > 0');
            }
        } else {
            opts.tiles = tiles;
            result.push(new Job(opts));
        }
    }, this);

    return result;
};


Job.prototype.partitionJob = function partitionJob() {
    throw new Err('not implemented');
};

/**
 * Tiles value is an array of integers. Each non-negative integer represents the delta
 * from the last index minus one. So a sequence [0, 0, 0, 1] represents indexes [0, 1, 2, 4].
 * Negative integer represents a range of indexes starting with the next index, of abs of that length plus one.
 * For example, [0,0,2,-2,1] would mean [0, 1, 3, 4, 5, 7]
 * @returns {Array}
 */
Job.prototype._decodeTileList = function _decodeTileList() {
    var size = 0,
        last = -1,
        maxCount = Math.pow(4, this.zoom),
        result = [],
        rangeSize = 0;

    if (!_.all(this.encodedTiles, function (v) {
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
        throw new Err('Invalid encodedTiles parameter');
    }

    this._updateSize(size);
    this.tiles = result;
};

Job.prototype._encodeTileList = function _encodeTileList() {
    var size = 0,
        last = -1,
        maxCount = Math.pow(4, this.zoom),
        result = [];

    var checkIdx = function (v, min, max) {
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
                var count = v[1] - v[0];
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
    this.encodedTiles = result;
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
    var zoomMax = Math.pow(4, this.zoom),
        fromIdx = groupFrom(this.tiles[0]),
        beforeIdx = groupBefore(this.tiles[this.tiles.length - 1]);

    if (this.size === 0) {
        this.title += '; EMPTY'
    } else if (this.size === zoomMax) {
        this.title += util.format('; ALL (%s)', numeral(zoomMax).format('0,0'));
    } else if (this.size === 1) {
        var xy = core.indexToXY(fromIdx);
        this.title += util.format('; 1 tile at [%d,%d] (idx=%d)', xy[0], xy[1], fromIdx);
    } else {
        var xyFrom = core.indexToXY(fromIdx);
        var xyLast = core.indexToXY(beforeIdx - 1);
        this.title += util.format('; %s tiles (%s%s‒%s; [%d,%d]‒[%d,%d])',
            numeral(this.size).format('0,0'),
            this.tiles.length > 1 ? numeral(this.tiles.length).format('0,0') + ' groups; ' : '',
            numeral(fromIdx).format('0,0'),
            numeral(beforeIdx).format('0,0'),
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

Job.prototype._assertSimple = function _assertSimple() {
    if (this.isComplex) {
        throw new Err('Pyramid or multi-part job is not supported');
    }
};

Job.prototype.cleanupForQue = function cleanupForQue() {
    this._assertSimple();

    delete this.beforeZoom;
    delete this.currentRange;
    delete this.fromZoom;
    delete this.idxBefore;
    delete this.idxFrom;
    delete this.isComplex;
    delete this.isIterating;
    delete this.parts;
    delete this.tiles;
    delete this.x;
    delete this.y;
};
