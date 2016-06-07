'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var assert = require('assert');
var utils = require('./testUtils');
var Job = require('../lib/Job');
var JobProcessor = require('../lib/JobProcessor');

describe('JobProcessor', function() {

    it('main iterator', function () {

        /**
         * @param {string} msg
         * @param {int[]} expectedValues
         * @param {int[]|int[][]} tiles
         * @param {object[]} filters
         * @param {object} sourceData
         */
        function test(msg, expectedValues, tiles, filters, sourceData) {
            var testOnFinish = [];
            if (!sourceData.d) sourceData.d = {q:[]};
            var sources = {
                _cache: {},
                getHandlerById: function (id) {
                    if (!this._cache[id]) {
                        assert(id in sourceData, 'id in sourceData: ' + id);
                        var handlerData = sourceData[id];
                        if (handlerData.q) {
                            var qdata = handlerData.q, ind = 0;
                            testOnFinish.push(function () {
                                assert.equal(ind, qdata.length, 'not all queries were made for source ' + id);
                            });
                            this._cache[id] = {
                                query: function (opts) {
                                    assert.notStrictEqual(opts.zoom, undefined, 'has no zoom');
                                    var vid = 'v' + opts.zoom;
                                    assert(vid in handlerData, 'missing zoom ' + opts.zoom + ' for source ' + id);
                                    var availableData = handlerData[vid];
                                    assert(ind < qdata.length, 'ind < qdata.length for source ' + id);
                                    var qd = qdata[ind++];
                                    assert.deepEqual([opts.zoom,opts.idxFrom,opts.idxBefore], qd, 'expected query for source ' + id);
                                    return utils.generator(availableData, opts.idxFrom, opts.idxBefore);
                                }
                            }
                        } else {
                            this._cache[id] = {};
                        }
                    }
                    return this._cache[id];
                }
            };
            var jp = new JobProcessor(sources, {
                data: {storageId: 'd', generatorId: 's', zoom: 2, tiles: tiles, filters: filters}
            });
            jp.stats = {};
            jp.tileStore = sources.getHandlerById('d');
            jp.tileGenerator = sources.getHandlerById('s');
            return utils.assertInOrder(msg, expectedValues, jp.createMainIterator()).then(function() {
                try {
                    testOnFinish.forEach(function (t) {
                        t();
                    });
                } catch (err) {
                    err.message = msg + ': ' + err.message;
                    assert.fail(err);
                }
            });
        }

        // in source data:
        // s -- id of the source.  s=generator, d=storage
        // v2 -- values that are stored in the source at zoom 2
        // q -- which queries are expected to be executed, as 3 integers - zoom, fromIdx, beforeIdx
        return Promise.resolve(true)
            .then(function () {return test('c01', [],      [],             undefined,                { s: {v2:[],      q:[]} })})
            .then(function () {return test('c02', [0],     [0],            undefined,                { s: {v2:[0],     q:[[2,0,1]]} })})
            .then(function () {return test('c03', [0,1,2], [[0,3]],        undefined,                { s: {v2:[0,1,2], q:[[2,0,3]]} })})
            .then(function () {return test('c04', [0,1,4], [[0,2], [4,5]], undefined,                { s: {v2:[0,1,4], q:[[2,0,2],[2,4,5]]} })})
            .then(function () {return test('c05', [4,5],   [[0,6]],        [{zoom:-1}],              { s: {v2:[4,5],   q:[[2,4,6]]}, d: {v1:[1], q:[[1,0,2]]} })})
            .then(function () {return test('c06', [4,5],   [[0,6]],        [{sourceId:'s'}],         { s: {v2:[4,5],   q:[[2,0,6]]} })})
            .then(function () {return test('c07', [4,5],   [[0,6]],        [{zoom:-1,sourceId:'s'}], { s: {v1:[1], v2:[4,5], q:[[1,0,2],[2,4,6]]} })})
            ;

    });

});
