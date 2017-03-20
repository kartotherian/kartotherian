'use strict';

let assert = require('assert'),
    _ = require('underscore'),
    validator = require('..');

describe('qidx', () => {

    function pass(expValue, obj, field, expType, mustHave, min, max) {
        assert.strictEqual(validator(obj, field, expType, mustHave, min, max), true);
        if (_.isObject(obj)) {
            assert.deepStrictEqual(obj[field], expValue);
        }
    }

    function dflt(expValue, field, expType, mustHave, min, max) {
        let obj = {};
        assert.strictEqual(validator(obj, field, expType, mustHave, min, max), false);
        if (_.isObject(obj)) {
            assert.deepStrictEqual(obj[field], expValue);
        }
    }

    function fail(obj, field, expType, mustHave, min, max) {
        try {
            validator(obj, field, expType, mustHave, min, max);
            assert(false);
        } catch (err) {}
    }

    it('default param', () => dflt(10, 'fld', 'number', 10));
    it('number', () => pass(10, {fld: 10}, 'fld', 'number', true));
    it('number min max', () => pass(10, {fld: 10}, 'fld', 'number', true, 1, 20));
    it('fail number min max', () => fail({fld: 10}, 'fld', 'number', true, 1, 5));
    it('fail not number', () => fail({fld: 'a'}, 'fld', 'number'));
    it('zoom', () => pass(10, {fld: 10}, 'fld', 'zoom'));
    it('!zoom', () => fail({fld: 27}, 'fld', 'zoom'));
    it('string', () => pass('a', {fld: 'a'}, 'fld', 'string'));
    it('string, min=1', () => pass('a', {fld: 'a'}, 'fld', 'string', 1));
    it('!string, min=1', () => fail({fld: ''}, 'fld', 'string', 1));
    it('string-array', () => pass(['a'], {fld: 'a'}, 'fld', 'string-array'));
});
