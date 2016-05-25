'use strict';

var Promise = require('bluebird');

module.exports = {};

/**
 * Yields { idx: (index) } objects with sequential index, where idxFrom <= index < idxBefore
 * @param {int} idxFrom
 * @param {int} idxBefore
 * @returns {Function}
 */
module.exports.getSimpleIterator = function(idxFrom, idxBefore) {
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
 * Given an iterator that yields {idx:index} values, merges sequential values of indexes,
 * and yields ranges as [idxFrom, idxBefore] arrays
 */
module.exports.sequenceToRangesIterator = function(iterator) {
    var firstIdx, lastIdx, isDone;

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

            var res = [firstIdx, lastIdx + 1];
            firstIdx = lastIdx = idx;
            if (idx === undefined) {
                isDone = true;
            }
            return res;
        });
    };
    return getNextValAsync;
};


/**
 * Given an iterator of {idx:index} values, yield the missing values within the given range
 */
module.exports.invertIterator = function(iterator, idxFrom, idxBefore) {
    var idxNext = idxFrom,
        nextValP, isDone;
    var getNextValAsync = function () {
        if (isDone) {
            return Promise.resolve(undefined);
        } else if (!nextValP) {
            nextValP = iterator();
        }
        return nextValP.then(function (iterValue) {
            var untilIdx = idxBefore;
            if (iterValue !== undefined && iterValue.idx < idxBefore) {
                // iterValue exists within the range - yield all indexes before it
                untilIdx = iterValue.idx;
            }
            if (idxNext < untilIdx) {
                // yield next pending index
                return {idx: idxNext++};
            } else if (iterValue === undefined || iterValue.idx >= idxBefore) {
                // no more iterValue, or it's outside of the range - we are done, attempt to cancel iteration
                isDone = true;
                if (iterValue !== undefined && iterator.cancel) {
                    iterator.cancel();
                }
                return undefined;
            } else {
                if (idxNext === iterValue.idx) {
                    // no more values can be iterated for the current range, get next
                    idxNext++;
                    nextValP = undefined;
                } else if (iterValue.idx < idxNext) {
                    // received value less than idxFrom, skip it
                    nextValP = undefined;
                }
                return getNextValAsync();
            }
        });
    };
    return getNextValAsync;
};
