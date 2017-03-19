'use strict';

let assert = require('assert'),
    Err = require('..');

describe('Err', function() {
    it('basic', function () {
        try {
            throw new Err();
        } catch (err) {
            assert.ok(err instanceof Err);
            assert.strictEqual(err.message, 'unknown');
            assert.strictEqual(err.name, 'Err');
        }
        try {
            throw new Err('abc');
        } catch (err) {
            assert.strictEqual(err.message, 'abc');
        }
    });
    it('format', function () {
        try {
            throw new Err('a=%d', 10);
        } catch (err) {
            assert.strictEqual(err.message, 'a=10');
        }
        try {
            throw new Err('a=%d');
        } catch (err) {
            assert.strictEqual(err.message, 'a=%d');
        }
        try {
            throw new Err('a=%d, b=%d', 10);
        } catch (err) {
            assert.strictEqual(err.message, 'a=10, b=%d');
        }
    });
    it('metrics', function () {
        try {
            throw new Err('a').metrics('abc');
        } catch (err) {
            assert.strictEqual(err.message, 'a');
            assert.strictEqual(err.metrics, 'abc');
        }
        try {
            throw new Err('a=%d', 10).metrics('abc');
        } catch (err) {
            assert.strictEqual(err.message, 'a=10');
            assert.strictEqual(err.metrics, 'abc');
        }
    });
});
