'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var exec = require('child_process').exec;
var fs = BBPromise.promisifyAll(require('fs'));
var tmp = BBPromise.promisifyAll(require('tmp'));
var byline = require('byline');
var stream = require('stream');

var core = require('kartotherian-core');
var Err = core.Err;

var utf8 = {encoding: 'utf8'};

/**
 * Convert source file into a file with only indexes (one index per line)
 * @param srcFile
 * @param options
 * @param dstFileDescriptor destination file to write
 * @returns {*} promise
 */
function parseSourceFile(srcFile, options, dstFileDescriptor) {
    var lineInd = 0, separator = '/';
    var instream = fs.createReadStream(srcFile, utf8);
    var linestream = byline(instream);
    var writeStream = fs.createWriteStream(null, {fd: dstFileDescriptor});
    var result = BBPromise.pending();
    options.zoom = undefined;

    var converter = new stream.Transform({objectMode: true});
    converter._transform = function (line, encoding, done) {
        lineInd++;
        var parts = line.split(separator);
        if (parts.length !== 3) {
            throw new Err('Line #%d has %d "%s"-separated values instead of 3', lineInd, parts.length, separator);
        }
        for (var i = 0; i < 3; i++) {
            var v = parseInt(parts[i]);
            if (v.toString() !== parts[i]) {
                throw new Err('Line #%d has a non-integer value', lineInd);
            }
            parts[i] = v;
        }
        if (options.zoom === undefined) {
            if (!core.isValidZoom(parts[0])) {
                throw new Err('Line #%d zoom=%d is invalid', lineInd, parts[0]);
            }
            options.zoom = parts[0];
        } else if (options.zoom !== parts[0]) {
            throw new Err('Line #%d zoom=%d differs from the zoom of previous lines (%d)', lineInd, parts[0], options.zoom);
        }
        var index = core.xyToIndex(parts[1], parts[2], parts[0]);
        this.push(index.toString() + '\n', encoding);
        done();
    };

    var onErr = function (err) {
        result.reject(err);
    };

    instream.on('error', onErr);
    linestream.on('error', onErr);
    writeStream.on('error', onErr);

    writeStream.on('finish', function () {
        result.resolve();
    });

    linestream.pipe(converter).pipe(writeStream);
    return result.promise;
}

function sortFile(filepath) {
    var result = BBPromise.pending();
    var arg = escapeShellArg(filepath);
    // Sort temp file as numbers (-n), in-place (-o filepath), removing duplicate lines (-u)
    exec('sort -u -n -o ' + arg + ' ' + arg,
        function (error, stdout, stderr) {
            if (stdout) {
                core.log('warn', stdout);
            }
            if (error !== null) {
                result.reject(new Err('sort error %d: %s', error, stderr));
            } else {
                if (stderr) {
                    core.log('error', stderr);
                }
                result.resolve();
            }
        });
    return result.promise;
}

/**
 * Take indexes from a sorted file, and combine them into jobs
 * @param filepath
 * @param options
 * @param addJobCallback
 * @returns {*}
 */
function addJobsFromFile(filepath, options, addJobCallback) {
    var result = BBPromise.pending();
    var zoom = options.zoom;
    var fromZoom = options.fromZoom !== undefined ? options.fromZoom : zoom;
    var untilZoom = options.beforeZoom !== undefined ? options.beforeZoom - 1 : zoom;

    // Each range array element tracks its own zoom level, starting from the original tile's zoom until the lowest
    var ranges = [];
    for (var i = Math.min(untilZoom, zoom); i >= Math.min(fromZoom, zoom); i--) {
        var job = _.clone(options);
        job.zoom = i;
        if (i === zoom && i < untilZoom) {
            job.fromZoom = i;
            job.beforeZoom = untilZoom + 1;
        } else {
            delete job.fromZoom;
            delete job.beforeZoom;
        }

        ranges.push({job: job, div: Math.pow(4, zoom - i), jobCount: 0, tileCount: 0});
    }

    function addRange(range) {
        var job = range.job;
        job.idxFrom = range.idxFrom;
        job.idxBefore = range.lastValue + 1;
        range.jobCount++;
        range.tileCount += job.idxBefore - job.idxFrom;
        addJobCallback(job);
    }

    var instream = byline(fs.createReadStream(filepath, utf8));
    instream.on('data', function (line) {
        var idx = parseInt(line);
        if (idx.toString() !== line) {
            throw new Err('Non-integer found in the sort result');
        } else if (!core.isValidIndex(idx, zoom)) {
            throw new Err('Bad value %d in the sort result', idx);
        }
        ranges.every(function (range) {
            var v = Math.floor(idx / range.div);
            if (range.idxFrom === undefined) {
                range.idxFrom = v;
                range.lastValue = v;
            } else if (range.lastValue === v) {
                return false; // minor optimization - no need to check lower zooms if lastValue hasn't changed here
            } else if (range.lastValue + 1 === v) {
                range.lastValue = v;
            } else if (range.lastValue > v) {
                throw new Err('Sort result is out of order - %d > %d', range.lastValue, v);
            } else {
                addRange(range);
                range.idxFrom = v;
                range.lastValue = v;
            }
            return true;
        });
    });
    instream.on('error', function (err) {
        result.reject(err);
    });
    instream.on('finish', function () {
        _.each(ranges, function (range) {
            if (range.idxFrom !== undefined) {
                addRange(range);
            }
        });
        var res = {jobs_total: 0, tiles_total: 0};
        ranges.reverse();
        _.each(ranges, function (range) {
            var job = range.job;
            var from = job.fromZoom === undefined ? job.zoom : job.fromZoom;
            var before = job.beforeZoom === undefined ? job.zoom + 1 : job.beforeZoom;
            for (var i = from; i < before; i++) {
                var mult = Math.pow(4, i - from);
                res.jobs_total += range.jobCount;
                res.tiles_total += range.tileCount * mult;
                res['jobs_zoom_' + i] = range.jobCount;
                res['tiles_zoom_' + i] = range.tileCount * mult;
            }
        });
        result.resolve(res);
    });

    return result.promise;
}

/**
 * Parse given file and enque the jobs
 * @param filepath
 * @param options
 * @param addJobCallback
 * @returns {*}
 */
module.exports = function(filepath, options, addJobCallback) {
    var tmpFile, tmpFileCleanupCb;
    return BBPromise.try(function() {
        if ((options.fromZoom === undefined) !== (options.beforeZoom === undefined)) {
            throw new Err('either both fromZoom or beforeZoom must be present or absent');
        } else if (options.fromZoom !== undefined) {
            core.checkType(options, 'fromZoom', 'zoom');
            core.checkType(options, 'beforeZoom', 'zoom', true, options.fromZoom + 1);
        }
        return tmp.fileAsync();
    }).spread(function (path, fd, cleanupCallback) {
        tmpFile = path;
        tmpFileCleanupCb = cleanupCallback;
        return parseSourceFile(filepath, options, fd);
    }).then(function () {
        return sortFile(tmpFile);
    }).then(function () {
        return addJobsFromFile(tmpFile, options, addJobCallback);
    }).finally(function () {
        if (tmpFileCleanupCb) tmpFileCleanupCb();
    });
};

function escapeShellArg(arg) {
    var newArg = arg.replace(/(["\s'$`\\])/g, '\\$1');
    return newArg.indexOf('\\') > -1 ? "'" + newArg + "'" : arg;
}
