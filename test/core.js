'use strict';

var assert = require('assert'),
    core = require('../lib/core');

describe('core', function() {

    it('isValidIndex', function () {
        assert.equal(core.isValidIndex(''), false);
        assert.equal(core.isValidIndex('a'), false);
        assert.equal(core.isValidIndex('1'), false);
        assert.equal(core.isValidIndex(false), false);
        assert.equal(core.isValidIndex(true), false);
        assert.equal(core.isValidIndex({}), false);
        assert.equal(core.isValidIndex([]), false);
        assert.equal(core.isValidIndex([1]), false);
        assert.equal(core.isValidIndex(1.5), false);
        assert.equal(core.isValidIndex(-1), false);
        assert.equal(core.isValidIndex(Math.pow(4, 26)), false);

        assert.equal(core.isValidIndex(0), true);
        assert.equal(core.isValidIndex(1), true);
        assert.equal(core.isValidIndex(Math.pow(4, 26) - 1), true);

        assert.equal(core.isValidIndex(0, 0), true);
        assert.equal(core.isValidIndex(1, 0), false);

        assert.equal(core.isValidIndex(-1, 1), false);
        assert.equal(core.isValidIndex(0, 1), true);
        assert.equal(core.isValidIndex(1, 1), true);
        assert.equal(core.isValidIndex(2, 1), true);
        assert.equal(core.isValidIndex(3, 1), true);
        assert.equal(core.isValidIndex(4, 1), false);
    });

    it('xyToIndex & indexToXY', function () {
        function test(x, y, expected, zoom) {
            x = bin(x);
            y = bin(y);
            expected = bin(expected);
            let msg = x.toString(2) + ',' + y.toString(2) + '->' + expected.toString(2);
            assert.equal(core.xyToIndex(x, y, zoom), expected, msg);
            assert.deepStrictEqual(core.indexToXY(expected), [x, y], msg);
        }

        test(0, 0, 0, 0);

        test(0, 0, 0, 1);
        test(1, 0, 1, 1);
        test(0, 1, 2, 1);
        test(1, 1, 3, 1);

        test('00000', '11111', '1010101010', 5);
        test('11111', '00000', '0101010101', 5);
        test('11111', '11111', '1111111111', 5);

        test('000011001', '110001111', '101000000111101011', 10);
        test('110001111', '000011001', '010100001011010111', 10);

        test('0000000000000', '1000000000000', '10000000000000000000000000', core.maxValidZoom);
        test('1000000000000', '0000000000000', '01000000000000000000000000', core.maxValidZoom);
        test('1000000000000', '1000000000000', '11000000000000000000000000', core.maxValidZoom);

        //    12345678901234
        test('00000000000000', '10000000000000', '1000000000000000000000000000', core.maxValidZoom);
        test('10000000000000', '00000000000000', '0100000000000000000000000000', core.maxValidZoom);
        test('10000000000000', '10000000000000', '1100000000000000000000000000', core.maxValidZoom);

        //    1234567890123
        test('0000000000000', '1111111111111', '10101010101010101010101010', core.maxValidZoom);
        test('1111111111111', '0000000000000', '01010101010101010101010101', core.maxValidZoom);
        test('1111111111111', '1111111111111', '11111111111111111111111111', core.maxValidZoom);
        test('000000000000', '100000000000', '100000000000000000000000', core.maxValidZoom);
        test('100000000000', '000000000000', '010000000000000000000000', core.maxValidZoom);
        test('100000000000', '100000000000', '110000000000000000000000', core.maxValidZoom);
        test('0000000000000', '1000000000000', '10000000000000000000000000', core.maxValidZoom);
        test('1000000000000', '0000000000000', '01000000000000000000000000', core.maxValidZoom);
        test('1000000000000', '1000000000000', '11000000000000000000000000', core.maxValidZoom);
        test('00000000000000', '10000000000000', '1000000000000000000000000000', core.maxValidZoom);
        test('10000000000000', '00000000000000', '0100000000000000000000000000', core.maxValidZoom);
        test('10000000000000', '10000000000000', '1100000000000000000000000000', core.maxValidZoom);
        test('000000000000000', '100000000000000', '100000000000000000000000000000', core.maxValidZoom);
        test('100000000000000', '000000000000000', '010000000000000000000000000000', core.maxValidZoom);
        test('100000000000000', '100000000000000', '110000000000000000000000000000', core.maxValidZoom);

        //    12345678901234567890123456
        test('00000000000000000000000000', '11111111111111111111111111', '1010101010101010101010101010101010101010101010101010', core.maxValidZoom);
        test('11111111111111111111111111', '00000000000000000000000000', '0101010101010101010101010101010101010101010101010101', core.maxValidZoom);
        test('11111111111111111111111111', '11111111111111111111111111', '1111111111111111111111111111111111111111111111111111', core.maxValidZoom);
        test('0000000000000000000000000', '1111111111111111111111111', '10101010101010101010101010101010101010101010101010', core.maxValidZoom);
        test('1111111111111111111111111', '0000000000000000000000000', '01010101010101010101010101010101010101010101010101', core.maxValidZoom);
        test('1111111111111111111111111', '1111111111111111111111111', '11111111111111111111111111111111111111111111111111', core.maxValidZoom);

        //    1234567890123456789012
        test('0000000000000000000000', '1010000011110101001111', '10001000000000001010101000100010000010101010', core.maxValidZoom);
        test('1101000001010010110110', '0000000000000000000000', '01010001000000000001000100000100010100010100', core.maxValidZoom);
        test('1101000001010010110110', '1010000011110101001111', '11011001000000001011101100100110010110111110', core.maxValidZoom);
    });
});


function bin(value) {
    return typeof value === 'string' ? parseInt(value, 2) : value;
}
