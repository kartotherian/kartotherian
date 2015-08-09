#!/usr/bin/nodejs

'use strict';

var promisify = require('../lib/promisify');
var BBPromise = require('bluebird');
var util = require('../lib/util');
var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2), {boolean: ['quiet','v','vv']});
var conf = require('../lib/conf');
var mapnik = require('mapnik');
var yaml = require('js-yaml');
var fs = require("fs");

var generator, storage, config, reporter;

var exports = {};
module.exports = exports;

exports.getCommonSettings = function() {
    return '[-v|-vv] [--config=<configfile>] [--quiet] [--threads=num] [--xy=XXX,YYY]'
};

exports.parseCommonSettingsAsync = function(statsAccessor) {
    var result;
    var config = {
        configPath: argv.config || 'config.yaml',
        threads: argv.threads || 1,
        quiet: argv.quiet,
        xy: argv.xy,
        // verbosity
        log: argv.vv ? 2 : (argv.v ? 1 : 0),
        start: new Date(),
        reportStats: function (done) {
            var time = (new Date() - config.start) / 1000;
            var stats = statsAccessor();
            var min = Math.floor(time / 60);
            var avg = (stats && stats.checked && time > 0) ? Math.round(stats.checked / time * 10) / 10 : 0;
            console.log('%s%dmin\tZ=%d\t%d/s\t%s', done ? 'DONE: ' : '', min, config.zoom, avg, JSON.stringify(stats));
        }
    };

    if (config.xy) {
        // Only yield one value given by x,y pair
        config.xy = _.map(config.xy.split(','), function (v) {
            return parseInt(v);
        });
    }

    result = {
        argv: argv,
        config: config
    };

    console.log(JSON.stringify(config));

    if (!config.quiet)
        reporter = setInterval(config.reportStats, 60000);

    return fs
        .readFileAsync(exports.normalizePath(config.configPath))
        .then(yaml.safeLoad)
        .then(function (cfg) {
            return conf
                .loadConfiguration(cfg.services[0].conf)
                .then(function(conf) {
                    result.conf = conf;
                    return result;
                });
        });
};

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param path
 * @returns {*}
 */
exports.normalizePath = function(path) {
    var stack = callsite(),
        requester = stack[1].getFileName();
    return pathLib.resolve(path.dirname(requester), '..', path);
};

exports.getOptimizedIteratorFunc = function(zoom, start, count) {
    var index = start || 0,
        maximum = count ? (start + count) : Math.pow(4, zoom);
    console.log("Generating %d tiles", maximum - index);

    return function (skipTile) {
        // If parameter is given, ensure that subsequent calls do not get anything underneath that value
        if (skipTile) {
            var scale = Math.pow(2, zoom - skipTile.z);
            index = Math.max(index, util.xyToIndex(skipTile.x * scale, skipTile.y * scale) + (scale * scale));
            return;
        }

        if (index >= maximum) {
            return false;
        }
        var xy = util.indexToXY(index);
        var loc = {z: zoom, x: xy[0], y: xy[1]};
        index++;
        return loc;
    };
};

/**
 * Check if tile exists
 */
exports.getTileSizeAsync = function(storage, loc) {
    if (storage.getPath) {
        // file storage
        return fs
            .statAsync(storage.getPath(loc.z, loc.x, loc.y, storage.filetype))
            .get('size')
            .catch(function () {
                return -1;
            });
    } else {
        // TODO: optimize
        return storage
            .getTileAsync(loc.z, loc.x, loc.y)
            .get('length')
            .catch(function () {
                return -1;
            });
    }
};

/**
 * Delete tile from storage
 */
exports.deleteTileAsync = function(storage, loc) {
    if (storage.getPath) {
        return fs
            .unlinkAsync(storage.getPath(loc.z, loc.x, loc.y, storage.filetype))
            .catch(function () {
                // ignore
            });
    } else {
        return storage.putTileAsync(loc.z, loc.x, loc.y, null);
    }
};

/**
 * cleanup
 */
exports.shutdown = function() {
    if (reporter) {
        clearInterval(reporter);
        reporter = undefined;
    }
    console.log('DONE!');
};
