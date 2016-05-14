'use strict';

var _ = require('underscore');
var assert = require('assert');
var Job = require('../../../lib/Job');

describe('Job', function() {

    function newJob(opts) {
        return new Job(_.extend({
            storageId: 'sid',
            generatorId: 'gid'
        }, opts))
    }

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
                    _encodedTiles: values
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

        var test = function (msg, zoom, size, tiles, expected) {

            try {
                var job = newJob({
                    zoom: zoom,
                    tiles: tiles
                });
                assert.deepEqual(job._encodedTiles, expected, 'encoded');
                assert.equal(job.size, size, 'size');

                var encjob = newJob({
                    zoom: zoom,
                    _encodedTiles: job._encodedTiles
                });

                assert.equal(encjob.size, size, 'size2');
                var expectedDecoded = _.reject(tiles, function (v) {
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

    it('expand job', function() {

        var test = function (msg, zoom, parts, fromZoom, beforeZoom, tiles, expected) {

                try {
                    var job = newJob({
                        zoom: zoom,
                        tiles: tiles,
                        fromZoom: fromZoom,
                        beforeZoom: beforeZoom,
                        parts: parts
                    });

                    var jobs = job.expandJobs();
                    if (expected === false) {
                        assert.deepEqual(jobs, [job], 'already expanded');
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
                } catch (err) {
                    err.message = msg + ': ' + err.message;
                    throw err;
                }
            },
            pyramid = function (msg, zoom, fromZoom, beforeZoom, tiles, expected) {
                return test(msg, zoom, undefined, fromZoom, beforeZoom, tiles, expected);
            },
            parts = function (msg, parts, tiles, expected) {
                _.each(expected, function (exp) {
                    exp.z = 2;
                });
                return test(msg, 2, parts, undefined, undefined, tiles, expected);
            };

        pyramid('d0', 0, undefined, undefined, [0], false);
        pyramid('d1', 0, 4, 4, [0],       []);
        pyramid('d2', 0, 0, 2, [0],       [{s:1,z:0,t:[0]}, {s:4,z:1,t:[[0,4]]}]);
        pyramid('d3', 0, 1, 2, [0],       [{s:4,z:1,t:[[0,4]]}]);
        pyramid('d4', 1, 0, 3, [2],       [{s:1,z:0,t:[0]}, {s:1,z:1,t:[2]}, {s:4,z:2,t:[[8,12]]}]);
        pyramid('d5', 1, 0, 3, [[1,3]],   [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d6', 1, 0, 3, [[1,2],2], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d7', 1, 0, 3, [1,[2,3]], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d8', 1, 0, 3, [[1,2],3], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);
        pyramid('d9', 1, 0, 3, [1,[3,4]], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);

        parts('e1', 1, [0],            [{s:1,t:[0]}]);
        parts('e2', 2, [0],            [{s:1,t:[0]}]);
        parts('e3', 2, [0,1],          [{s:1,t:[0]}, {s:1,t:[1]}]);
        parts('e4', 2, [0,2],          [{s:1,t:[0]}, {s:1,t:[2]}]);
        parts('e5', 2, [[0,2]],        [{s:1,t:[0]}, {s:1,t:[1]}]);
        parts('e6', 2, [[0,3]],        [{s:2,t:[[0,2]]}, {s:1,t:[2]}]);
        parts('e7', 2, [[0,2],[3,5]],  [{s:2,t:[[0,2]]}, {s:2,t:[[3,5]]}]);
        parts('e8', 2, [[0,3],4],      [{s:2,t:[[0,2]]}, {s:2,t:[2,4]}]);
        parts('e9', 2, [0,[2,5]],      [{s:2,t:[0,2]}, {s:2,t:[[3,5]]}]);
        parts('ea', 2, [0,1,2],        [{s:2,t:[[0,2]]}, {s:1,t:[2]}]);
        parts('eb', 2, [0,1,2],        [{s:2,t:[[0,2]]}, {s:1,t:[2]}]);

        test('f1', 1, 2, 0, 3, [2],    [{s:1,z:0,t:[0]},{s:1,z:1,t:[2]},{s:2,z:2,t:[[8,10]]},{s:2,z:2,t:[[10,12]]}]);
    });

});
