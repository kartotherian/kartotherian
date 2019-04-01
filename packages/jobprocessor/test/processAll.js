'use strict';

let Promise = require('bluebird'),
    assert = require('assert'),
    processAllLib = require('../lib/processAll'),
    fileParserLib = require('../lib/fileParser'),
    pathLib = require('path'),
    util = require('util'),
    fs = require('fs'),
    Err = require('@kartotherian/err'),
    core = require('@kartotherian/core'),
    Job = require('../lib/Job'),
    stateFile = pathLib.resolve(__dirname, 'data/stat.txt'),
    expDirPath = pathLib.resolve(__dirname, 'data'),
    opts = {
        storageId: 'sid',
        generatorId: 'gid'
    },
    U = undefined;

let debug = msg => {
    // console.log(util.format.apply(null, arguments));
};

core.log = (level, msg) => {
    // debug(level + ':' + msg);
};

describe('processAll', () => {

    let tempFiles = {},
        addedJobs = [];

    fileParserLib.onTemp = (sourceFile, tempFile, tempFd) => {
        debug(Array.prototype.slice.call(arguments).join(','));
        if (sourceFile in tempFiles) assert.fail(sourceFile + ' has already been processed');
        tempFiles[sourceFile] = {
            tempFile: tempFile,
            tempFd: tempFd
        };
    };

    function safeDelete(fileOrFd) {
        let action = typeof fileOrFd === 'number' ? 'close' : 'delete';
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
        Object.keys(tempFiles).forEach(srcFile => {
            let tempFile = tempFiles[srcFile];
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
        return processAllLib(expDirPath, stateFile, mask, opts, job => Promise.try(() => {
            // test job's params
            new Job(job);
            addedJobs.push(job);
        }).delay(2)).then(() => {
            debug('cleanup %j', tempFiles);
            assert.equal(fs.readFileSync(stateFile, 'utf8'), expectedState);
            let actualFiles = Object.keys(tempFiles).filter(s => s !== 'undefined').sort();
            expectedProcessed = expectedProcessed.map(s => pathLib.resolve(expDirPath, s));
            assert.deepEqual(actualFiles, expectedProcessed);

            if (!Array.isArray(expectedJobs)) expectedJobs = [expectedJobs];
            assert.deepEqual(addedJobs, expectedJobs)
        });
    }

    it('nothing to do', () => test('01-15-ok.dat', '01-15-ok', '01-15-ok.dat', [], []));

    it('single file', () => test(U, '01-15-ok', '01-15-ok.dat', ['01-15-ok.dat'],
        {
            storageId: "sid",
            generatorId: "gid",
            zoom: 15,
            tiles: [42502815, [42502822, 42502830]]
        }
    ));

    it('all same zoom', () => test(U, '-15-ok', '02-15-ok.dat', ['01-15-ok.dat', '02-15-ok.dat'],
        {
            storageId: "sid",
            generatorId: "gid",
            zoom: 15,
            tiles: [42502815, [42502822, 42502830], 928255040, [928255124, 928255126], [928255127, 928255132], [928255152, 928255154]]
        }));

    it('mixed zoom', () => Promise.resolve().then(() => test(U, '-ok', '02-15-ok.dat', ['01-15-ok.dat', '02-15-ok.dat', '03-16-ok.dat'],
        {
            storageId: "sid",
            generatorId: "gid",
            zoom: 15,
            tiles: [42502815, [42502822, 42502830], 928255040, [928255124, 928255126], [928255127, 928255132], [928255152, 928255154]]
        })).then(() => {
        tempFiles = {};
        addedJobs = [];
        return test(U, '-ok', '03-16-ok.dat', ['03-16-ok.dat'],
            {
                storageId: "sid",
                generatorId: "gid",
                zoom: 16,
                tiles: [170011291, 170011299, [170011301, 170011307]]
            });
    }));

    it('bad file', () => test(U, '-bad', '01-15-ok.dat', ['01-15-ok.dat'],
        {
            storageId: "sid",
            generatorId: "gid",
            zoom: 15,
            tiles: [42502815, [42502822, 42502830]]
        }
    ).then(() => {
        throw new Err('must have failed');
    }, () => {
        // expected error
    }));

});
