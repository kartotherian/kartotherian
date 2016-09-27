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
        function test(x, y, zoom, expected) {
            let msg = x.toString(2) + ',' + y.toString(2) + '->' + expected.toString(2);
            assert.equal(core.xyToIndex(x, y, zoom), expected, msg);
            assert.deepStrictEqual(core.indexToXY(expected), [x, y], msg);
        }

        test(0, 0, 0, 0);

        test(0, 0, 1, 0);
        test(1, 0, 1, 1);
        test(0, 1, 1, 2);
        test(1, 1, 1, 3);

        test(0, Math.pow(2, 5) - 1, 5, 682);
        test(Math.pow(2, 5) - 1, 0, 5, 341);
        test(Math.pow(2, 5) - 1, Math.pow(2, 5) - 1, 5, 1023);

        test(25, 399, 10, 164331);
        test(399, 25, 10, 82647);

        let low13 = bin('1000000000000');
        test(0, low13, core.maxValidZoom, bin('10000000000000000000000000'));
        test(low13, 0, core.maxValidZoom, bin('01000000000000000000000000'));
        test(low13, low13, core.maxValidZoom, bin('11000000000000000000000000'));

        let high13 = bin('10000000000000');
        test(0, high13, core.maxValidZoom, bin('1000000000000000000000000000'));
        test(high13, 0, core.maxValidZoom, bin('0100000000000000000000000000'));
        test(high13, high13, core.maxValidZoom, bin('1100000000000000000000000000'));

        let maxCoord = core.maxValidCoordinate - 1;
        test(0, maxCoord, core.maxValidZoom, bin('1010101010101010101010101010101010101010101010101010'));
        test(maxCoord, 0, core.maxValidZoom, bin('101010101010101010101010101010101010101010101010101'));
        test(maxCoord, maxCoord, core.maxValidZoom, bin('1111111111111111111111111111111111111111111111111111'));

        test(0, 2637135, core.maxValidZoom, 9346027233450);
        test(3413174, 0, core.maxValidZoom, 5566295459092);
        test(3413174, 2637135, core.maxValidZoom, 14912322692542);
    });
});


function bin(value) {
    return parseInt(value, 2);
}
