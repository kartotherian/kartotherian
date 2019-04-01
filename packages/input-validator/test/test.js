'use strict';

let assert = require('assert'),
    _ = require('underscore'),
    checkType = require('..');

describe('checkType', () => {

    function pass(expValue, obj, field, expType, mustHave, min, max) {
        assert.strictEqual(checkType(obj, field, expType, mustHave, min, max), true);
        if (_.isObject(obj)) {
            assert.deepStrictEqual(obj[field], expValue);
        }
    }

    function dflt(expValue, field, expType, mustHave, min, max) {
        let obj = {};
        assert.strictEqual(checkType(obj, field, expType, mustHave, min, max), false);
        if (_.isObject(obj)) {
            assert.deepStrictEqual(obj[field], expValue);
        }
    }

    function fail(obj, field, expType, mustHave, min, max) {
        try {
            checkType(obj, field, expType, mustHave, min, max);
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

describe('strToInt', () => {
    let test = function (value, expected) {
        return () => assert.strictEqual(checkType.strToInt(value), expected);
    };

    it('int', test(0, 0));
    it('strint', test('1', 1));
    it('neg strint', test('-1', -1));
    it('float', test('1.1', '1.1'));
    it('empty', test('', ''));
    it('letter', test('a', 'a'));
});

describe('strToFloat', () => {
    let test = function (value, expected) {
        return () => assert.strictEqual(checkType.strToFloat(value), expected);
    };

    it('int', test(0, 0));
    it('strint', test('1', 1));
    it('neg strint', test('-1', -1));
    it('strfloat', test('1.1', 1.1));
    it('empty', test('', ''));
    it('letter', test('a', 'a'));
});

describe('normalizeUrl', () => {
    let test = function (value, protocol, host, query) {
        return () => {
            let uri = checkType.normalizeUrl(value);
            assert.strictEqual(uri.protocol, protocol);
            assert.strictEqual(uri.host, host);
            assert.deepEqual(uri.query, query);
        }
    };

    it('str no query', test('prot://hst', 'prot:', 'hst', {}));
    it('str w query', test('prot://hst?a=b', 'prot:', 'hst', {a: 'b'}));
    it('obj w query str', test({query: 'a=b'}, undefined, undefined, {a: 'b'}));
    it('obj w query obj', test({query: {a: 'b'}}, undefined, undefined, {a: 'b'}));
});
