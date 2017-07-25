'use strict';

let assert = require('assert'),
    Err = require('..');

describe('Err', () => {
    it('basic', () => {
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
    it('format', () => {
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
    it('metrics', () => {
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
    it('throwNoTile', () => {
        let thrown = true;
        try {
            Err.throwNoTile();
            thrown = false;
        } catch (err) {
            assert(err instanceof Error, 'must be error');
            assert.strictEqual(Err.isNoTileError(err), true, 'isNoTileError');
        }
        assert.strictEqual(thrown, true, 'throwNoTile() didn\'t throw');
        assert.strictEqual(Err.isNoTileError(new Error('Tile does not exist')), true, 'newErr');
        assert.strictEqual(Err.isNoTileError(new Error(' Tile does not exist')), false, 'newErr2');
    });
});
