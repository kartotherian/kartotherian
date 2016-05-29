'use strict';

var _ = require('underscore');
var assert = require('assert');
var Job = require('../lib/Job');
var U = undefined;

describe('Job', function() {

    function newJob(opts) {
        return new Job(_.extend({
            storageId: 'sid',
            generatorId: 'gid'
        }, opts))
    }

    it('job ctor fail', function() {

        var test = function (msg, opts) {
            var passed = true;
            try {
                new Job(opts);
            } catch(err) {
                passed = false;
            }
            if (passed) {
                assert.fail(msg + ': should have failed but did not');
            }
        };

        test('j1', {});
        test('j2', {storageId: 's'});
        test('j3', {storageId: 's', generatorId: 'g'});
    });

    it('job ctor ok', function() {

        var test = function (msg, opts, expected) {
            try {
                var j = new Job(opts);
                _.each(expected, function(v, k) {
                    assert(j.hasOwnProperty(k), 'expected key ' + k);
                    assert.equal(j[k], v, 'expected value for key ' + k);
                });
            } catch (err) {
                err.message = msg + ': ' + err.message;
                throw err;
            }
        };

        var ext = function (opts) {
            return _.extend({storageId: 's', generatorId: 'g', zoom: 2}, opts);
        };

        test('k0', ext({zoom: 0, tiles: []}), {size: 0});
        test('k1', ext({zoom: 0, tiles: [0]}), {size: 1});
        test('k2', ext({tiles: []}));
        test('k3', ext({tiles: [0]}));
        test('k4', ext({tiles: [[1, 3]]}));
        test('k5', ext({zoom: 2}), {size: 16});
    });

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

        var test = function (msg, opts, expected) {
                try {
                    var job = opts instanceof Job ? opts : newJob(opts);

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
                        if (exp.f) {
                            if (!_.isArray(exp.f)) exp.f = [exp.f];
                            assert.notEqual(jb.filters, U, 'filter is missing');
                            assert.equal(jb.filters.length, exp.f.length, 'filter count ' + i);
                            exp.f.forEach(function(expFilter, i2) {
                                assert.equal(jb.filters[i2].zoom, expFilter.z, 'filter zoom ' + i + ' filter ' + i2);
                            })
                        } else {
                            assert.equal(jb.filters, U, 'filter is present');
                        }
                    });
                } catch (err) {
                    err.message = msg + ': ' + err.message;
                    throw err;
                }
            },
            pyramid = function (msg, zoom, fromZoom, beforeZoom, tiles, expected) {
                return test(msg, {
                    zoom: zoom,
                    fromZoom: fromZoom,
                    beforeZoom: beforeZoom,
                    tiles: tiles,
                }, expected);
            },
            parts = function (msg, parts, tiles, expected) {
                _.each(expected, function (exp) {
                    exp.z = 2;
                });
                return test(msg, {
                    zoom: 2,
                    parts: parts,
                    tiles: tiles
                }, expected);
            };

        pyramid('d01', 0, U, U, [0],       false);
        pyramid('d02', 0, 4, 4, [0],       []);
        pyramid('d03', 0, 0, 2, [0],       [{s:1,z:0,t:[0]}, {s:4,z:1,t:[[0,4]]}]);
        pyramid('d04', 0, 1, 2, [0],       [{s:4,z:1,t:[[0,4]]}]);
        pyramid('d05', 1, 0, 3, [2],       [{s:1,z:0,t:[0]}, {s:1,z:1,t:[2]}, {s:4,z:2,t:[[8,12]]}]);
        pyramid('d06', 1, 0, 3, [[1,3]],   [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d07', 1, 0, 3, [[1,2],2], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d08', 1, 0, 3, [1,[2,3]], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d09', 1, 0, 3, [[1,2],3], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);
        pyramid('d10', 1, 0, 3, [1,[3,4]], [{s:1,z:0,t:[0]}, {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);

        parts('e01', 1, [0],           [{s:1,t:[0]}]);
        parts('e02', 2, [0],           [{s:1,t:[0]}]);
        parts('e03', 2, [0,1],         [{s:1,t:[0]}, {s:1,t:[1]}]);
        parts('e04', 2, [0,2],         [{s:1,t:[0]}, {s:1,t:[2]}]);
        parts('e05', 2, [[0,2]],       [{s:1,t:[0]}, {s:1,t:[1]}]);
        parts('e06', 3, [[0,2]],       [{s:1,t:[0]}, {s:1,t:[1]}]);
        parts('e07', 2, [[0,3]],       [{s:2,t:[[0,2]]}, {s:1,t:[2]}]);
        parts('e08', 2, [[0,2],[3,5]], [{s:2,t:[[0,2]]}, {s:2,t:[[3,5]]}]);
        parts('e09', 2, [[0,3],4],     [{s:2,t:[[0,2]]}, {s:2,t:[2,4]}]);
        parts('e10', 2, [0,[2,5]],     [{s:2,t:[0,2]}, {s:2,t:[[3,5]]}]);
        parts('e11', 2, [0,1,2],       [{s:2,t:[[0,2]]}, {s:1,t:[2]}]);
        parts('e12', 2, [0,1,2],       [{s:2,t:[[0,2]]}, {s:1,t:[2]}]);


        test('f1', {zoom:1, tiles:[0], filters: [{zoom:-1}]}, [{s:1,z:1,t:[0],f:{z:0}}]);
        test('f2', {zoom:1, parts:2, fromZoom:0, beforeZoom:3, tiles:[2]}, [{s:1,z:0,t:[0]},{s:1,z:1,t:[2]},{s:2,z:2,t:[[8,10]]},{s:2,z:2,t:[[10,12]]}]);

        var jb = newJob({zoom:2}); // 0..15
        jb.moveNextRange(0, 12);
        jb.parts = 3;
        test('f3', jb, [{s:2,z:2,t:[[12,14]]},{s:1,z:2,t:[14]},{s:1,z:2,t:[15]}]);

    });

    it('job indexToPos', function() {

        var test = function (msg, expected, index, tiles) {
            var passed = true;
            try {
                var job = newJob({zoom: 2, tiles: tiles});
                assert.equal(job.indexToPos(index), expected, msg);
            } catch(err) {
                passed = false;
            }
            assert.equal(passed, expected !== U, msg);
        };

        test('p01', U, -1, []);
        test('p02', U, 0, []);
        test('p03', U, 1, []);
        test('p04', U, 1, [2]);
        test('p05', 0, 2, [2]);
        test('p06', U, 3, [2]);
        test('p07', U, 0, [[1,2]]);
        test('p08', 0, 1, [[1,2]]);
        test('p09', U, 2, [[1,2]]);
        test('p10', U, 0, [[1,2],[4,5]]);
        test('p11', 0, 1, [[1,2],[4,5]]);
        test('p12', U, 2, [[1,2],[4,5]]);
        test('p13', U, 3, [[1,2],[4,5]]);
        test('p14', 1, 4, [[1,2],[4,5]]);
        test('p15', U, 5, [[1,2],[4,5]]);
    });

});
