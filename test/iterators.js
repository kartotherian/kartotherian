'use strict';

let Promise = require('bluebird'),
    assert = require('assert'),
    utils = require('./testUtils'),
    iter = require('../lib/iterators');

describe('iterators', () => {

    it('simple iterations', () => {

        function test(msg, idxFrom, idxBefore, expectedValues) {
            return utils.assertInOrder(msg, expectedValues,
                iter.getSimpleIterator(idxFrom, idxBefore));
        }

        return Promise.resolve(true)
            .then(() => test('a1', 0, 0, []))
            .then(() => test('a2', 0, 1, [0]))
            .then(() => test('a2', 10, 14, [10, 11, 12, 13]))
        ;
    });

    it('invert iterations', () => {

        function test(msg, values, idxFrom, idxBefore, expectedValues) {
            return utils.assertInOrder(msg, expectedValues,
                iter.invertIterator(utils.generator(values), idxFrom, idxBefore));
        }

        return Promise.resolve(true)
            .then(() => test('b01', [], 0, 0, []))
            .then(() => test('b02', [], 0, 1, [0]))
            .then(() => test('b03', [], 0, 2, [0, 1]))
            .then(() => test('b04', [0], 0, 1, []))
            .then(() => test('b05', [0], 0, 2, [1]))
            .then(() => test('b06', [1], 0, 2, [0]))
            .then(() => test('b07', [0, 1], 0, 2, []))
            .then(() => test('b08', [1], 0, 3, [0, 2]))
            .then(() => test('b09', [2], 0, 3, [0, 1]))
            .then(() => test('b10', [2], 0, 5, [0, 1, 3, 4]))
            .then(() => test('b11', [0, 1], 0, 3, [2]))
            .then(() => test('b12', [1, 2], 0, 3, [0]))
            .then(() => test('b13', [1, 2], 0, 4, [0, 3]))
            .then(() => test('b14', [0, 2], 1, 2, [1]))
            .then(() => test('b15', [0, 3], 1, 3, [1, 2]))
            .then(() => test('b16', [0, 2, 4], 1, 3, [1]))
            .then(() => test('b17', [0, 2, 4], 1, 1, []))
            .then(() => test('b18', [0, 1, 4, 5], 1, 4, [2, 3]))
            .then(() => test('b19', [0, 1, 4, 5], 2, 4, [2, 3]))
            .then(() => test('b20', [0, 1, 4, 5], 1, 3, [2]))
            .then(() => test('b21', [0, 1, 4, 5], 2, 3, [2]))
        ;
    });

    it('sequence iterations', () => {

        function test(msg, values, expectedValues) {
            return utils.assertInOrder(msg, expectedValues,
                iter.sequenceToRangesIterator(utils.generator(values)), true);
        }

        return Promise.resolve(true)
            .then(() => test('d1', [], []))
            .then(() => test('d2', [0], [[0, 1]]))
            .then(() => test('d3', [1, 2], [[1, 3]]))
            .then(() => test('d4', [1, 3], [[1, 2], [3, 4]]))
            .then(() => test('d5', [1, 2, 4], [[1, 3], [4, 5]]))
            .then(() => test('d6', [1, 3, 4], [[1, 2], [3, 5]]))
            .then(() => test('d7', [1, 2, 4, 5, 7], [[1, 3], [4, 6], [7, 8]]))
            ;
    });

});
