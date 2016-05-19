'use strict';

var Promise = require('bluebird');
var _ = require('underscore');
var exec = require('child_process').exec;
var fs = Promise.promisifyAll(require('fs'));
var createTempFile = Promise.promisify(require('tmp').file, {multiArgs: true});
var byline = require('byline');
var stream = require('stream');

var core = require('kartotherian-core');
var Err = core.Err;
var Job = require('./Job');

var utf8 = {encoding: 'utf8'};

/**
 * Convert source file into a file with only indexes (one index per line)
 * @param {String} srcFile one file to transform
 * @param options
 * @param dstFileDescriptor destination file to write
 * @returns {*} promise
 */
function parseSourceFile(srcFile, options, dstFileDescriptor) {
    var lineInd = 0, separator = '/';
    var instream = fs.createReadStream(srcFile, utf8);
    var linestream = byline(instream);
    var writeStream = fs.createWriteStream(null, {fd: dstFileDescriptor});
    var result = Promise.pending();

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
    var result = Promise.pending();
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
    return new Promise(function (resolve, reject) {
        var zoom = options.zoom,
            zoomDiff = options.fromZoom !== undefined && options.fromZoom < zoom ? zoom - options.fromZoom : 0,
            breakOnDivider = Math.pow(4, zoomDiff),
            tilesCountSoftLimit = 500000,
            tilesCountHardLimit = tilesCountSoftLimit * 1.5,
            rangeStart = false,
            lastValue = false,
            jobPromises = [];

        options.tiles = [];

        function addRange(idx) {
            if (rangeStart !== false) {
                options.tiles.push(rangeStart === lastValue ? lastValue : [rangeStart, lastValue + 1]);
            }
            if (idx !== undefined) {
                rangeStart = lastValue = idx;
            }
        }

        function addJob(idx) {
            addRange(idx);
            if (options.tiles.length > 0) {
                jobPromises.push(addJobCallback(options));
                options.tiles = [];
            }
        }

        var instream = byline(fs.createReadStream(filepath, utf8));
        instream.on('data', function (line) {
            var idx = parseInt(line);
            if (idx.toString() !== line) {
                throw new Err('Non-integer found in the sort result');
            } else if (!core.isValidIndex(idx, zoom)) {
                throw new Err('Bad value %d in the sort result', idx);
            } else if (rangeStart === false) {
                // first item
                rangeStart = lastValue = idx;
                return;
            }

            // Limit the size of each job to a maximum individual tiles and ranges limit
            // After soft limit, break on an even divisor so that lower-zoom tile wouldn't generate twice
            // After hard limit, break regardless

            if (options.tiles.length > tilesCountSoftLimit &&
                Math.floor(lastValue / breakOnDivider) < Math.floor(idx / breakOnDivider)
            ) {
                addJob(idx);
            } else if (lastValue + 1 === idx) {
                lastValue = idx;
            } else if (options.tiles.length > tilesCountHardLimit) {
                addJob(idx);
            } else {
                addRange(idx);
            }
        });
        instream.on('error', function (err) {
            reject(err);
        });
        instream.on('finish', function () {
            try {
                addJob();
                resolve(Promise.all(jobPromises).then(function (titles) {
                    return [].concat.apply([], titles).sort();
                }));
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Parse given file and enque the jobs
 * @param filepath
 * @param options
 * @param addJobCallback
 * @returns {*}
 */
module.exports = function fileParser(filepath, options, addJobCallback) {
    var tmpFile, tmpFileCleanupCb;
    return Promise.try(function() {
        // validate options
        options.tiles = [];
        if (core.checkType(options, 'fileZoomOverride', 'zoom')) {
            options.zoom = options.fileZoomOverride;
            options.fileZoomOverride = true;
        } else {
            // Job requires valid zoom for validation, so temporarily set it
            options.zoom = 0;
        }
        new Job(options);

        if (!options.fileZoomOverride) {
            delete options.zoom;
            return createTempFile().spread(function (path, fd, cleanupCallback) {
                tmpFile = path;
                tmpFileCleanupCb = cleanupCallback;
                return Promise.each(filepath.split('|'), function (file) {
                    return parseSourceFile(file, options, fd);
                });
            }).then(function () {
                return sortFile(tmpFile);
            });
        } else {
            tmpFile = filepath;
        }
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
