'use strict';

let Promise = require('bluebird'),
    assert = require('assert');

/**
 * Generates values as given by the iterator
 * @param {array} values
 * @param {int} [idxFrom]
 * @param {int} [idxBefore]
 * @returns {Function}
 */
module.exports.generator = (values, idxFrom, idxBefore) => {
    let i = 0;
    return () => {
        let result = undefined;
        while (idxFrom !== undefined && i < values.length && values[i] < idxFrom) {
            i++;
        }
        if (i < values.length && (idxBefore === undefined || values[i] < idxBefore)) {
            result = {idx: values[i++]};
        }
        return Promise.resolve(result);
    }
};


/**
 * Checks that values generated by the iterator match expected values
 * Adapted from promistreamus tests
 */
module.exports.assertInOrder = (msg, expectedValues, iterator, deep) => {
    let pos = 0,
        processor = () => iterator().then(value => {
            if (value === undefined) {
                assert.equal(pos, expectedValues.length, 'finished early');
                return undefined;
            }
            assert(pos < expectedValues.length, 'too many values');
            let expectedVal = expectedValues[pos++];
            if (deep)
                assert.deepEqual(value, expectedVal, 'unexpected value');
            else
                assert.equal(value.idx, expectedVal, 'unexpected value');

            return processor();
        });
    return processor().catch(err => {
        err.message = msg + ': ' + err.message;
        assert.fail(err);
    });
};
