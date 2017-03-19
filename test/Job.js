'use strict';

let _ = require('underscore'),
    assert = require('assert'),
    Job = require('../lib/Job'),
    U = undefined;

function newJob(opts, lastCompleteIdx, jobIdxBefore) {
    return new Job(_.extend({
        storageId: 'sid',
        generatorId: 'gid'
    }, opts), {
        lastCompleteIdx: lastCompleteIdx,
        jobIdxBefore: jobIdxBefore
    });
}

function assertJobs(jobs, expected, expZoomOverride) {
    assert(Array.isArray(jobs), 'jobs array');
    assert.equal(jobs.length, expected.length, 'jobs count');
    expected.forEach((exp, i) => {
        let jb = jobs[i];
        assert(_.isObject(jb), 'is object ' + i);
        assert.equal(jb.size, exp.s, 'size ' + i);
        assert.equal(jb.zoom, expZoomOverride === U ? exp.z : expZoomOverride, 'zoom ' + i);
        assert.deepEqual(jb.tiles, exp.t, 'tiles ' + i);
        assert.equal(jb.stats === U ? U : jb.stats.lastCompleteIdx, exp.l, 'lastCompleteIdx');
        if (exp.b === U) {
            let last = exp.t[exp.t.length-1];
            exp.b = Array.isArray(last) ? last[1] : last + 1;
        }
        assert.equal(jb.stats === U ? U : jb.stats.jobIdxBefore, exp.b, 'jobIdxBefore');
        if (exp.flt) {
            if (!_.isArray(exp.flt)) exp.flt = [exp.flt];
            assert.notEqual(jb.filters, U, 'filter is missing');
            assert.equal(jb.filters.length, exp.flt.length, 'filter count ' + i);
            exp.flt.forEach((expFilter, i2) => {
                assert.equal(jb.filters[i2].zoom, expFilter.z, 'filter zoom ' + i + ' filter ' + i2);
            })
        } else {
            assert.equal(jb.filters, U, 'filter is present');
        }
    });
}

describe('Job', () => {

    it('job ctor fail', () => {

        let test = (msg, opts) => {
            let passed = true;
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

    it('job ctor ok', () => {

        let test = (msg, opts, expected) => {
            try {
                let j = new Job(opts);
                _.each(expected, (v, k) => {
                    assert(j.hasOwnProperty(k), 'expected key ' + k);
                    assert.equal(j[k], v, 'expected value for key ' + k);
                });
            } catch (err) {
                err.message = msg + ': ' + err.message;
                throw err;
            }
        };

        let ext = opts => _.extend({storageId: 's', generatorId: 'g', zoom: 2}, opts);

        test('k0', ext({zoom: 0, tiles: []}), {size: 0});
        test('k1', ext({zoom: 0, tiles: [0]}), {size: 1});
        test('k2', ext({tiles: []}));
        test('k3', ext({tiles: [0]}));
        test('k4', ext({tiles: [[1, 3]]}));
        test('k5', ext({zoom: 2}), {size: 16});
    });

    it('decodeTileList errors', () => {

        let test = (msg, zoom, values) => {
            values = Array.prototype.slice.call(arguments, 2);
            assert.throws(() => {
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

    it('encodeTileList errors', () => {

        let test = (msg, zoom, values) => {
            values = Array.prototype.slice.call(arguments, 2);
            assert.throws(() => {
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

    it('encode-decode roundtrip', () => {

        let test = (msg, zoom, size, tiles, expected) => {

            try {
                let job = newJob({
                    zoom: zoom,
                    tiles: tiles
                });
                assert.equal(job.size, size, 'size');

                job.cleanupForQue();
                assert.deepEqual(job._encodedTiles, expected, 'encoded');

                let encjob = newJob({
                    zoom: zoom,
                    _encodedTiles: job._encodedTiles
                });

                assert.equal(encjob.size, size, 'size2');
                let expectedDecoded = _.reject(tiles, v => Array.isArray(v) && v[0] === v[1]);
                // Remove empty ranges
                expectedDecoded = _.map(expectedDecoded, v => Array.isArray(v) && v[0] === v[1] + 1 ? v[0] : v);
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

    it('expandJobs()', () => {

        let test = (msg, opts, expected, expZoomOverride) => {
                try {
                    let job = opts instanceof Job ? opts : newJob(opts),
                        jobs = job.expandJobs();

                    if (expected === false) {
                        delete jobs[0].stats.jobStart;
                        delete job.stats.jobStart;
                        assert.deepEqual(jobs, [job], 'already expanded');
                        return;
                    }
                    assertJobs(jobs, expected, expZoomOverride);
                } catch (err) {
                    err.message = msg + ': ' + err.message;
                    throw err;
                }
            },
            pyramid = (msg, zoom, fromZoom, beforeZoom, tiles, expected) => test(msg, {
                zoom: zoom,
                fromZoom: fromZoom,
                beforeZoom: beforeZoom,
                tiles: tiles
            }, expected),
            parts = (msg, parts, tiles, expected) => test(msg, {
                zoom: 2,
                parts: parts,
                tiles: tiles
            }, expected, 2);

        pyramid('d01', 0, U, U, [0],       false);
        pyramid('d02', 0, 4, 4, [0],       []);
        pyramid('d03', 0, 0, 2, [0],       [{s:1,z:0,t:[0]},    {s:4,z:1,t:[[0,4]]}]);
        pyramid('d04', 0, 1, 2, [0],       [{s:4,z:1,t:[[0,4]]}]);
        pyramid('d05', 1, 0, 3, [2],       [{s:1,z:0,t:[0]},    {s:1,z:1,t:[2]}, {s:4,z:2,t:[[8,12]]}]);
        pyramid('d06', 1, 0, 3, [[1,3]],   [{s:1,z:0,t:[0]},    {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d07', 1, 0, 3, [[1,2],2], [{s:1,z:0,t:[0]},    {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d08', 1, 0, 3, [1,[2,3]], [{s:1,z:0,t:[0]},    {s:2,z:1,t:[[1,3]]}, {s:8,z:2,t:[[4,12]]}]);
        pyramid('d09', 1, 0, 3, [[1,2],3], [{s:1,z:0,t:[0]},    {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);
        pyramid('d10', 1, 0, 3, [1,[3,4]], [{s:1,z:0,t:[0]},    {s:2,z:1,t:[1,3]}, {s:8,z:2,t:[[4,8],[12,16]]}]);

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


        test('f1', {zoom:1, tiles:[0], filters: [{zoom:-1}]}, [{s:1,z:1,t:[0],flt:{z:0}}]);
        test('f2', {zoom:1, parts:2, fromZoom:0, beforeZoom:3, tiles:[2]}, [{s:1,z:0,t:[0]},{s:1,z:1,t:[2]},{s:2,z:2,t:[[8,10]]},{s:2,z:2,t:[[10,12]]}]);

        let jb = newJob({zoom:2}, 11); // 0..15
        jb.parts = 3;
        test('f3', jb, [{s:2,z:2,t:[[12,14]]},{s:1,z:2,t:[14]},{s:1,z:2,t:[15]}]);

    });

    it('job calculateProgress', () => {

        let test = (msg, expected, index, tiles) => {
            let error;
            try {
                let job = newJob({zoom: 2, tiles: tiles});
                if (index !== U) {
                    job.completeIndex(index);
                }
                assert.equal(job.calculateProgress(), expected);
            } catch(err) {
                error = err;
            }
            if ((expected === U) !== !!error) {
                if (error) {
                    error.message = msg + ': ' + error.message;
                    throw error;
                } else {
                    assert.fail(msg + ': was expected to be an error');
                }
            }
        };

        test('p00', U, -1, []);
        test('p01', U, 0, []);
        test('p02', U, 1, []);
        test('p03', U, 1, [2]);
        test('p04', 0, U, [2]);
        test('p05', 1, 2, [2]);
        test('p06', U, 3, [2]);
        test('p07', U, 0, [[1,2]]);
        test('p08', 1, 1, [[1,2]]);
        test('p09', U, 2, [[1,2]]);
        test('p10', U, 0, [[1,2],[4,5]]);
        test('p11', 1, 1, [[1,2],[4,5]]);
        test('p12', U, 2, [[1,2],[4,5]]);
        test('p13', U, 3, [[1,2],[4,5]]);
        test('p14', 2, 4, [[1,2],[4,5]]);
        test('p15', U, 5, [[1,2],[4,5]]);
    });

    it('splitjob', () => {

        let test = (msg, parts, tiles, lastCompleted, jobIdxBefore, expected, expectedOthers, zoom) => {
            zoom = zoom === U ? 2 : zoom;
            try {
                let job = newJob({
                    zoom: zoom,
                    tiles: tiles
                }, lastCompleted, jobIdxBefore);
                if (lastCompleted !== U) {
                    job.moveNextRange();
                }

                let jobs = job.splitJob(parts);

                expected.t = tiles;
                assertJobs([job], [expected], zoom);
                assertJobs(jobs, expectedOthers, zoom);
            } catch (err) {
                err.message = msg + ': ' + err.message;
                throw err;
            }
        };

        test('r02', 2, [1],       U, U, {s:1,l:U,b:2}, []);
        test('r03', 2, [1,3],     U, U, {s:1,l:U,b:2}, [{s:1,t:[3]}]);
        test('r05', 2, [[1,4]],   U, U, {s:2,l:U,b:3}, [{s:1,t:[3]}]);
        test('r06', 2, [[1,4]],   1, U, {s:2,l:1,b:3}, [{s:1,t:[3]}]);
        test('r07', 2, [[1,4]],   2, U, {s:3,l:2,b:4}, []);
        test('r08', 2, [[1,4]],   3, U, {s:3,l:3,b:4}, []);
        test('r09', 2, [[1,4],5], U, U, {s:2,l:U,b:3}, [{s:2,t:[3,5]}]);
        test('r10', 2, [[1,4],5], 1, U, {s:3,l:1,b:4}, [{s:1,t:[5]}]);
        test('r11', 2, [[1,4],5], 2, U, {s:3,l:2,b:4}, [{s:1,t:[5]}]);
        test('r12', 2, [[1,4],5], 3, U, {s:4,l:3,b:6}, []);
        test('r13', 2, [[1,4],5], 5, U, {s:4,l:5,b:6}, []);
    });

});
