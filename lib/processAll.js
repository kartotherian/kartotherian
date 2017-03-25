'use strict';

let Promise = require('bluebird'),
    pathLib = require('path'),

    /** @namespace fs.statAsync */
    /** @namespace fs.accessAsync */
    /** @namespace fs.readFileAsync */
    /** @namespace fs.writeFileAsync */
    /** @namespace fs.readdirAsync */
    fs = Promise.promisifyAll(require('fs')),
    Err = require('@kartotherian/err'),
    core = require('@kartotherian/core'),
    fileParser = require('./fileParser');


/**
 * Parse given file and enqueue the jobs
 * @param {string} expDirPath
 * @param {string} stateFile
 * @param {string} mask
 * @param {object} options
 * @param {Function} addJobCallback
 * @returns {Promise}
 */
module.exports = function processAll(expDirPath, stateFile, mask, options, addJobCallback) {
    let lastFileParsed, parsedFiles;
    return fs.statAsync(stateFile).then(stat => {
        if (!stat.isFile()) throw new Err(stateFile + ' is not a file');
        return fs.accessAsync(stateFile, fs.R_OK + fs.W_OK);
    }, err => {
        if (err.code !== 'ENOENT') throw err;
        // File does not exist, try to create an empty one
        return fs.writeFileAsync(stateFile, '');
    }).then(() => {
        // File now exists, all checks have passed
        return fs.readFileAsync(stateFile, {encoding: 'utf8'});
    }).then(content => {
        lastFileParsed = content.trim();
        return fs.readdirAsync(expDirPath);
    }).then(files => {
        let re = new RegExp(mask);
        files = files.filter(file => re.test(file) && file > lastFileParsed);
        if (files.length === 0) {
            return files;
        }
        return Promise.map(files, file => {
            file = pathLib.resolve(expDirPath, file);
            return fs.statAsync(file).then(stat => {
                if (!stat.isFile()) throw new Err(file + ' is not a file');
                return fs.accessAsync(file, fs.R_OK);
            }).return(file);
        });
    }).then(files => {
        if (files.length === 0) return files;
        parsedFiles = files.sort();
        return fileParser(parsedFiles, options, addJobCallback);
    }).then(parseResult => {
        if (!parseResult || !parseResult.lastParsedFile) return parseResult;
        return fs.writeFileAsync(stateFile, pathLib.basename(parseResult.lastParsedFile)).return(parseResult);
    });
};
