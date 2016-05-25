'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var assert = require('assert');
var utils = require('./testUtils');
var Job = require('../lib/Job');
var JobProcessor = require('../lib/JobProcessor');

describe('JobProcessor', function() {

    function newJob(opts) {
        return {
            data: _.extend({
                storageId: 'sid',
                generatorId: 'gid'
            }, opts)
        };
    }


    it('main iterator', function () {

        function test(msg, expectedValues, tiles, filters, sourceData, hasQuery) {
            if (hasQuery) {
                msg += '+';
                sourceData.gid.z2 = expectedValues;
            }
            var sources = {
                getHandlerById: function (id) {
                    return (hasQuery && id === 'gid') ? {
                        query: function (opts) {
                            assert(id in sourceData, msg + ' id in sourceData: ' + id);
                            var dat = sourceData[id];
                            assert.notStrictEqual(opts.zoom, undefined, msg + ' has no zoom');
                            var zid = 'z'+opts.zoom;
                            assert(zid in dat, msg + ' id in sourceData: ' + id);
                            return utils.generator(dat[zid], opts.idxFrom, opts.idxBefore);
                        }
                    } : {};
                }
            };
            var jp = new JobProcessor(sources, newJob({zoom: 2, tiles: tiles, filters: filters}));
            jp.stats = {};
            jp.tileStore = sources.getHandlerById('sid');
            jp.tileGenerator = sources.getHandlerById('gid');
            return utils.assertInOrder(msg, expectedValues, jp.getIterator())
                .then(function () {
                    if (!hasQuery) {
                        return test(msg, expectedValues, tiles, filters, sourceData, true);
                    }
                });
        }

        return Promise.resolve(true)
            .then(function () {return test('c01', [],        [],             undefined,   { gid:{} } )})
            .then(function () {return test('c02', [0],       [0],            undefined,   { gid:{} } )})
            .then(function () {return test('c03', [0,1,2],   [[0,3]],        undefined,   { gid:{} } )})
            .then(function () {return test('c04', [0,1,4],   [[0,2], [4,5]], undefined,   { gid:{} } )})
            .then(function () {return test('c05', [0,1,4],   [[0,2], [4,5]], undefined,   { gid:{} } )})
            // .then(function () {return test('c06', [4,5],     [[0,6]],        [{zoom:-1}], { gid:{}, sid:{z1:[1]} } )})
        ;
    });

});
