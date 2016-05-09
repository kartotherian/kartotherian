'use strict';

var _ = require('underscore');
var assert = require('assert');
var Job = require('../../../lib/Job');

describe('Job', function() {

    var newJob = function newJob(opts) {
        return new Job(_.extend({
            storageId: 'sid',
            generatorId: 'gid'
        }, opts))
    };

    it('decodeTileList errors', function() {

        var test = function (msg, zoom, values) {
            values = Array.prototype.slice.call(arguments, 2);
            assert.throws(function () {
                newJob({
                    zoom: zoom,
                    tiles: values
                });
            }, msg);
        };

        test('a1', 1, 'a');
        test('a2', 1, [0]);
        test('a3', 1, -1);
        test('a4', 1, -1, -1);
        test('a5', 1, 0, -1);
        test('a6', 0, 1);
        test('a7', 1, 4);
        test('a8', 1, -1, 3);
        test('a9', 1, 0, 0, 0, 0, 0);
    });

    it('encodeTileList errors', function() {

        var test = function (msg, zoom, values) {
            values = Array.prototype.slice.call(arguments, 2);
            assert.throws(function () {
                newJob({
                    zoom: zoom,
                    encodedTiles: values
                });
            }, msg);
        };

        test('b1', 1, 'a');
        test('b2', 1, [0]);
        test('b3', 1, -1);
        test('b4', 1, -1, -1);
        test('b5', 1, 0, -1);
        test('b6', 0, 1);
        test('b7', 1, 4);
        test('b8', 1, -1, 3);
        test('b9', 1, 0, 0, 0, 0, 0);
    });

    it('encode-decode roundtrip', function() {

        var test = function (msg, zoom, size, value, expected) {

            try {
                var job = newJob({
                    zoom: zoom,
                    tiles: value
                });
                assert.deepEqual(job.encodedTiles, expected, 'encoded');
                assert.equal(job.size, size, 'size');

                var encjob = newJob({
                    zoom: zoom,
                    encodedTiles: job.encodedTiles
                });

                assert.equal(encjob.size, size, 'size2');
                var expectedDecoded = _.reject(value, function (v) {
                    return Array.isArray(v) && v[0] === v[1];
                });
                // Remove empty ranges
                expectedDecoded = _.map(expectedDecoded, function (v) {
                    return Array.isArray(v) && v[0] === v[1] + 1 ? v[0] : v;
                });
                assert.deepEqual(encjob.tiles, expectedDecoded, 'roundtrip');
            } catch(err) {
                err.message = msg + ': ' + err.message;
                throw err;
            }
        };

        test('c1', 0, 1, [0],         [0]);
        test('c2', 1, 1, [1],         [1]);
        test('c3', 1, 1, [3],         [3]);
        test('c4', 1, 2, [0, 1],      [0, 0]);
        test('c5', 1, 2, [1, 2],      [1, 0]);
        test('c6', 1, 3, [0, [1, 3]], [0, -1, 0]);
        test('c7', 2, 3, [1, [3, 5]], [1, -1, 1]);
        test('c8', 1, 2, [1, 3],      [1, 1]);
        test('c9', 2, 3, [[1, 3], 4], [-1, 1, 1]);
        test('ca', 2, 3, [[1, 3], 4], [-1, 1, 1]);
        test('cb', 1, 4, [0, 1, 2, 3], [0, 0, 0, 0]);
    });

    it('pyramid split', function() {

        var test = function (msg, zoom, fromZoom, beforeZoom, value, expected) {

            try {
                var job = newJob({
                    zoom: zoom,
                    tiles: value,
                    fromZoom: fromZoom,
                    beforeZoom: beforeZoom
                });

                var jobs = job.splitPyramid();
                if (expected === false) {
                    assert.equal(jobs, false    , 'isNonPyramid');
                    return;
                }
                assert(Array.isArray(jobs), 'jobs array');
                assert.equal(jobs.length, expected.length, 'jobs count');
                expected.forEach(function (exp, i) {
                    var jb = jobs[i];
                    assert(_.isObject(jb), 'is object ' + i);
                    assert.equal(jb.size, exp.s, 'size ' + i);
                    assert.equal(jb.zoom, exp.z, 'zoom ' + i);
                    assert.deepEqual(jb.tiles, exp.t, 'tiles ' + i);
                });
            } catch(err) {
                err.message = msg + ': ' + err.message;
                throw err;
            }
        };

        test('d0', 0, undefined, undefined, [0], false);
        test('d1', 0, 4, 4, [0],       []);
        test('d2', 0, 0, 2, [0],       [{s:1,z:0,t:[0]}, {s:4,z:1,t:[[0,4]]}]);
        test('d3', 0, 1, 2, [0],       [{s:4,z:1,t:[[0,4]]}]);
        test('d4', 1, 0, 3, [2],       [{s:1,z:0,t:[0]}, {s:1,z:1,t:[2]}, {s:4,z:2,t:[[8,12]]}]);
        test('d5', 1, 0, 3, [[1,3]],   [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        test('d6', 1, 0, 3, [[1,2],2], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        test('d7', 1, 0, 3, [1,[2,3]], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        test('d8', 1, 0, 3, [[1,2],3], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);
        test('d9', 1, 0, 3, [1,[3,4]], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);
    });

});
