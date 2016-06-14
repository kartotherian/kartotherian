'use strict';

var Promise = require('bluebird');
var pathLib = require('path');
var fs = Promise.promisifyAll(require('fs'));

var core = require('kartotherian-core');
var Err = core.Err;
var fileParser = require('./fileParser');


/**
 * Parse given file and enque the jobs
 * @param {string} expDirPath
 * @param {string} stateFile
 * @param {string} mask
 * @param {object} options
 * @param {Function} addJobCallback
 * @returns {*}
 */
module.exports = function processAll(expDirPath, stateFile, mask, options, addJobCallback) {
    var lastFileParsed, parsedFiles;
    return fs.statAsync(stateFile).then(function (stat) {
        if (!stat.isFile()) throw new Err(stateFile + ' is not a file');
        return fs.accessAsync(stateFile, fs.R_OK + fs.W_OK);
    }, function (err) {
        if (err.code !== 'ENOENT') throw err;
        // File does not exist, try to create an empty one
        return fs.writeFileAsync(stateFile, '');
    }).then(function () {
        // File now exists, all checks have passed
        return fs.readFileAsync(stateFile, {encoding: 'utf8'});
    }).then(function (content) {
        lastFileParsed = content;
        return fs.readdir(expDirPath);
    }).then(function (files) {
        let re = new RegExp(mask);
        files = files.filter(function (file) {
            return re.test(file) && file > lastFileParsed;
        });
        return Promise.map(files, function (file) {
            file = pathLib.resolve(expDirPath, file);
            return fs.statAsync(file).then(function (stat) {
                if (!stat.isFile()) throw new Err(file + ' is not a file');
                return fs.accessAsync(file, fs.R_OK);
            }).return(file);
        });
    }).then(function (files) {
        parsedFiles = files.sort();
        return fileParser(parsedFiles, options, addJobCallback);
    }).then(function (parseResult) {
        return fs.writeFileAsync(stateFile, pathLib.basename(parsedFiles[parsedFiles.length - 1])).return(parseResult);
    });
};
