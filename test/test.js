'use strict';

let assert = require('assert'),
    _ = require('underscore'),
    validator = require('..');

describe('qidx', () => {

    function pass(expResult, expValue, obj, field, expType, mustHave, min, max) {
        assert.strictEqual(validator(obj, field, expType, mustHave, min, max), expResult);
        if (_.isObject(obj)) {
            assert.strictEqual(obj[field], expValue);
        }
    }

    function fail(obj, field, expType, mustHave, min, max) {
        try {
            validator(obj, field, expType, mustHave, min, max);
            assert(false);
        } catch (err) {}
    }

    it('default param', () => pass(false, 10, {}, 'fld', 'number', 10));
    it('number', () => pass(true, 10, {fld: 10}, 'fld', 'number', true));
    it('number min max', () => pass(true, 10, {fld: 10}, 'fld', 'number', true, 1, 20));
    it('fail number min max', () => fail({fld: 10}, 'fld', 'number', true, 1, 5));
    it('fail not number', () => fail({fld: 'a'}, 'fld', 'number'));
    it('zoom', () => fail({fld: 10}, 'fld', 'zoom'));
    it('!zoom', () => fail({fld: 27}, 'fld', 'zoom'));
});
