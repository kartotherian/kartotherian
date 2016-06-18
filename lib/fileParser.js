'use strict';

let Promise = require('bluebird'),
    exec = require('child_process').exec,
    fs = Promise.promisifyAll(require('fs')),
    tmp = require('tmp-promise'),
    stream = require('stream'),
    es = require('event-stream'),
    pathLib = require('path'),
    _ = require('underscore'),

    core = require('kartotherian-core'),
    Err = core.Err,
    Job = require('./Job'),

    utf8 = {encoding: 'utf8'},
    conversionAbort = 'abort converting';

module.exports = fileParser;

/**
 * Convert source file into a temporary file with only indexes (one index per line)
 * @param {string} srcFile
 * @param {string[]|bool[]} zoomLevels
 * @param {int} zoomLvlIndex
 * @param {object[]} cleanupList
 * @returns {*} promise
 */
function parseSourceFile(srcFile, zoomLevels, zoomLvlIndex, cleanupList) {
    return tmp.tmpName({prefix: 'tilerator-' + pathLib.basename(srcFile) + '-'}).then(function (outputFile) {
        let earlyAbort = false,
            zoom = undefined,
            lineInd = 0,
            separator = '/';

        cleanupList.push(outputFile);

        // Unit testing
        if (module.exports.onTemp) module.exports.onTemp(srcFile, outputFile);

        return new Promise(function (resolve, reject) {

            core.log('info', 'Parsing ' + srcFile + '=>' + outputFile);

            fs.createReadStream(srcFile)
                .on('error', reject)
                .pipe(es.split())
                .on('error', reject)
                .pipe(es.through(function write(line) {
                    try {
                        lineInd++;
                        if (line === '') return undefined; // skip
                        var parts = line.split(separator);
                        if (parts.length !== 3) {
                            throw new Err('Line #%d has %d "%s"-separated values instead of 3', lineInd, parts.length, separator);
                        }

                        // Make sure the zoom hasn't changed
                        if (zoomLevels[zoomLvlIndex] !== parts[0]) {
                            zoom = assertInt(parts[0], lineInd);

                            if (zoomLevels[zoomLvlIndex] === false) {
                                earlyAbort = true;
                                throw new Err(conversionAbort);
                            } else if (!core.isValidZoom(zoom)) {
                                throw new Err('Line #%d zoom=%s is invalid', lineInd, parts[0]);
                            } else if (zoomLevels[zoomLvlIndex] !== undefined) {
                                throw new Err('Line #%d zoom=%d differs from the zoom of previous lines (%d)', lineInd, parts[0], zoomLevels[zoomLvlIndex]);
                            } else {
                                // Logic: when we have a new zoom, check that it matches the one right before this one,
                                // unless the one before hasn't started yet.  If mismatch with previous, or any subsequent,
                                // cancel all subsequent ones from the point where they differ (unless hasn't started yet)
                                zoomLevels[zoomLvlIndex] = parts[0];
                                let prevZoom = zoomLvlIndex > 0 ? zoomLevels[zoomLvlIndex - 1] : parts[0],
                                    mismatchFound = false;
                                for (let i = zoomLvlIndex; i < zoomLevels.length; i++) {
                                    if (!mismatchFound && zoomLevels[i] !== undefined && zoomLevels[i] !== prevZoom) {
                                        mismatchFound = true;
                                    }
                                    if (mismatchFound) {
                                        zoomLevels[i] = false; // canceling import for this file
                                    }
                                }
                                // recheck again
                                if (zoomLevels[zoomLvlIndex] === false) {
                                    earlyAbort = true;
                                    throw new Err(conversionAbort);
                                }
                            }
                        }
                        this.emit('data', core.xyToIndex(assertInt(parts[1], lineInd), assertInt(parts[2], lineInd), zoom) + '\n');
                    } catch (err) {
                        this.emit('error', err);
                    }
                }))
                .on('error', reject)
                .pipe(fs.createWriteStream(outputFile))
                .on('error', reject)
                .on('finish', function () {
                    resolve(outputFile);
                });
        }).catch(function (err) {
            // Only re-throw if we didn't cause the original exception as part of the early parse abort
            if (err.message !== conversionAbort) throw err;
        });
    });
}

function sortFile(files, cleanupList) {
    return tmp.tmpName({prefix: 'tilerator-sorted-'}).then(function (dstFile) {

        cleanupList.push(dstFile);

        // Unit testing
        if (module.exports.onTemp) module.exports.onTemp(undefined, dstFile);

        return new Promise(function (resolve, reject) {
            var srcFiles = files.map(escapeShellArg).join(' ');
            // Sort temp file as numbers (-n), destination (-o dstFile), removing duplicate lines (-u)
            var command = 'sort -u -n -o ' + escapeShellArg(dstFile) + ' ' + srcFiles;
            core.log('info', 'Sorting: ' + command);
            exec(command,
                function (error, stdout, stderr) {
                    if (stdout && stdout !== '') {
                        core.log('warn', stdout);
                    }
                    if (error !== null) {
                        reject(new Err('sort error %d: %s', error, stderr));
                    } else if (stderr && stderr !== '') {
                        reject(stderr);
                    } else {
                        resolve(dstFile);
                    }

                });
        });
    });
}

/**
 * Take indexes from a sorted file, and combine them into jobs
 * @param filepath
 * @param options
 * @param addJobCallback
 * @returns {*}
 */
function addJobsFromSortedFile(filepath, options, addJobCallback) {
    return new Promise(function (resolve, reject) {
        core.log('info', 'Adding jobs from ' + filepath);
        var zoom = options.zoom,
            zoomDiff = options.fromZoom !== undefined && options.fromZoom < zoom ? zoom - options.fromZoom : 0,
            breakOnDivider = Math.pow(4, zoomDiff),
            tilesCountSoftLimit = 500000,
            tilesCountHardLimit = tilesCountSoftLimit * 1.5,
            rangeStart = false,
            lastValue = false,
            jobPromises = [],
            lineInd = 0;

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
                jobPromises.push(addJobCallback(_.clone(options)));
                options.tiles = [];
            }
        }

        fs.createReadStream(filepath, utf8)
            .on('error', reject)
            .pipe(es.split())
            .on('error', reject)
            .pipe(es.through(function (line) {
                try {
                    lineInd++;
                    if (line === '') return undefined; // skip
                    var idx = assertInt(line, lineInd);
                    if (!core.isValidIndex(idx, zoom)) {
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
                } catch (err) {
                    this.emit('error', err);
                }
            })
                .on('error', reject)
                .on('end', function () {
                    try {
                        addJob();
                        resolve(Promise.all(jobPromises).then(function (titles) {
                            return [].concat.apply([], titles).sort();
                        }));
                    } catch (err) {
                        reject(err);
                    }
                }));
    });
}

/**
 * Parse given file and enqueue the jobs
 * @param {string|string[]} filepath
 * @param options
 * @param addJobCallback
 * @returns {*}
 */
function fileParser(filepath, options, addJobCallback) {
    var cleanupList = [],
        lastParsedFile;

    return Promise.try(function () {
        // validate options
        options.tiles = [];
        if (core.checkType(options, 'fileZoomOverride', 'zoom')) {
            options.zoom = options.fileZoomOverride;
            options.fileZoomOverride = true;
        } else {
            // Job requires valid zoom for validation, so temporarily set it
            options.zoom = 0;
        }
        new Job(options); // create and discard a new job to validate options. Otherwise it will be a while before checking

        if (!options.fileZoomOverride) {
            delete options.zoom;
            filepath = typeof filepath === 'string' ? filepath.split('|') : filepath;
            // Files may contain different zoom levels
            // During parsing, this array will contain file's zoom level
            // When done, only the files in the beginning of the array that have the same zoom level are processed
            let zoomLevels = new Array(filepath.length);
            return Promise.map(filepath, function (srcfile, zoomLvlIndex) {
                return parseSourceFile(srcfile, zoomLevels, zoomLvlIndex, cleanupList);
            }).then(function (tempFiles) {
                let tempFiles2 = [];
                for (let i = 0; i < zoomLevels.length; i++) {
                    if (zoomLevels[i] === false) break;
                    if (zoomLevels[i] !== undefined) {
                        if (tempFiles2.length === 0) {
                            options.zoom = assertInt(zoomLevels[i]);
                        }
                        tempFiles2.push(tempFiles[i]);
                    }
                    lastParsedFile = filepath[i];
                }
                return sortFile(tempFiles2, cleanupList);
            }).then(function (sortedFile) {
                cleanupList.push(sortedFile);
                return addJobsFromSortedFile(sortedFile, options, addJobCallback);
            }).then(function (result) {
                core.log('info', 'Finished job creation... no more unemployment... at least for a bit');
                return result;
            });
        } else {
            return addJobsFromSortedFile(filepath, options, addJobCallback);
        }
    }).then(function(addedJobs) {
        var result = {
            jobs: addedJobs
        };
        if (lastParsedFile) {
            result.lastParsedFile = lastParsedFile;
        }
        return result;
    }).finally(function () {
        cleanupList.forEach(function (file) {
            try {
                fs.unlinkSync(file);
            } catch (err) {
                try {
                    core.log('warn', 'Cleanup failed for ' + file + ': ' + err);
                } catch (err2) {
                    console.log('Cleanup error reporting failed');
                }
            }
        });
    });
}

function escapeShellArg(arg) {
    var newArg = arg.replace(/(["\s'$`\\])/g, '\\$1');
    return newArg.indexOf('\\') > -1 ? "'" + newArg + "'" : arg;
}

function assertInt(value, lineInd) {
    var v = parseInt(value);
    if (v.toString() !== value) {
        throw new Err('Line #%d has a non-integer value: "%s"', lineInd, typeof value === 'string' ? value.slice(0, 20) : value);
    }
    return v;
}
