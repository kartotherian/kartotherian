'use strict';

var Promise = require('bluebird');
var assert = require('assert');
var processAllLib = require('../lib/processAll');
var fileParserLib = require('../lib/fileParser');
var pathLib = require('path');
var util = require('util');
var fs = require('fs');
var core = require('kartotherian-core');
var Job = require('../lib/Job');

var stateFile = pathLib.resolve(__dirname, 'data/stat.txt');
var expDirPath = pathLib.resolve(__dirname, 'data');
var opts = {
    storageId: 'sid',
    generatorId: 'gid'
};
var U = undefined;

var debug = function(msg) {
    // console.log(util.format.apply(null, arguments));
};

core.log = function(level, msg) {
    // debug(level + ':' + msg);
};

describe('processAll', function() {

    var tempFiles = {},
        addedJobs = [];

    fileParserLib.onTemp = function (sourceFile, tempFile, tempFd) {
        debug(Array.prototype.slice.call(arguments).join(','));
        if (sourceFile in tempFiles) assert.fail(sourceFile + ' has already been processed');
        tempFiles[sourceFile] = {
            tempFile: tempFile,
            tempFd: tempFd
        };
    };

    function safeDelete(fileOrFd) {
        var action = typeof fileOrFd === 'number' ? 'close' : 'delete';
        try {
            if (action === 'close') {
                fs.closeSync(fileOrFd);
            } else {
                fs.unlinkSync(fileOrFd);
            }
            debug('%sd %s', action, fileOrFd);
        } catch (err) {
            debug('Failed to %s %s: %s', action, fileOrFd, err);
            /*ignore*/
        }
    }

    function clearState() {
        safeDelete(stateFile);
        Object.keys(tempFiles).forEach(function (srcFile) {
            var tempFile = tempFiles[srcFile];
            if (tempFile.tempFd) safeDelete(tempFile.tempFd);
            if (tempFile.tempFile) safeDelete(tempFile.tempFile);
        });
        tempFiles = {};
        addedJobs = [];
    }

    beforeEach(clearState);
    afterEach(clearState);

    function test(stateData, mask, expectedState, expectedProcessed, expectedJobs) {
        if (stateData) {
            fs.writeFileSync(stateFile, stateData, 'utf8');
        }
        return processAllLib(expDirPath, stateFile, mask, opts, function (job) {
            // test job's params
            new Job(job);
            addedJobs.push(job);
        }).then(function () {
            debug('cleanup %j', tempFiles);
            assert.equal(fs.readFileSync(stateFile, 'utf8'), expectedState);
            var actualFiles = Object.keys(tempFiles).filter(function (s) {
                return s !== 'undefined';
            }).sort();
            expectedProcessed = expectedProcessed.map(function (s) {
                return pathLib.resolve(expDirPath, s);
            });
            assert.deepEqual(actualFiles, expectedProcessed);

            if (!Array.isArray(expectedJobs)) expectedJobs = [expectedJobs];
            assert.deepEqual(addedJobs, expectedJobs)
        });
    }

    it('nothing to do', function () {
        return test('01-15-ok.dat', '01-15-ok', '01-15-ok.dat', [], []);
    });

    it('single file', function () {
        return test(U, '01-15-ok', '01-15-ok.dat', ['01-15-ok.dat'],
            {
                storageId: "sid",
                generatorId: "gid",
                zoom: 15,
                tiles: [42502815, [42502822, 42502830]]
            }
        );
    });

    it('all same zoom', function () {
        return test(U, '-15-ok', '02-15-ok.dat', ['01-15-ok.dat', '02-15-ok.dat'],
            {
                storageId: "sid",
                generatorId: "gid",
                zoom: 15,
                tiles: [42502815, [42502822, 42502830], 928255040, [928255124, 928255126], [928255127, 928255132], [928255152, 928255154]]
            });
    });

    it('mixed zoom', function () {
        return Promise.resolve().then(function () {
            return test(U, '-ok', '02-15-ok.dat', ['01-15-ok.dat', '02-15-ok.dat', '03-16-ok.dat'],
                {
                    storageId: "sid",
                    generatorId: "gid",
                    zoom: 15,
                    tiles: [42502815, [42502822, 42502830], 928255040, [928255124, 928255126], [928255127, 928255132], [928255152, 928255154]]
                });
        }).then(function () {
            tempFiles = {};
            addedJobs = [];
            return test(U, '-ok', '03-16-ok.dat', ['03-16-ok.dat'],
                {
                    storageId: "sid",
                    generatorId: "gid",
                    zoom: 16,
                    tiles: [170011291, 170011299, [170011301, 170011307]]
                });
        });
    });

    it('bad file', function () {
        return test(U, '-bad', '01-15-ok.dat', ['01-15-ok.dat'],
            {
                storageId: "sid",
                generatorId: "gid",
                zoom: 15,
                tiles: [42502815, [42502822, 42502830]]
            }
        ).then(function () {
            throw new Err('must have failed')
        }, function () {
            // expected error
        });
    });

});
