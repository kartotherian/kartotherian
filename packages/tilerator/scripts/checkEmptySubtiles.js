#!/usr/bin/nodejs

'use strict';

var promisify = require('../lib/promisify');
var BBPromise = require('bluebird');
var util = require('../lib/util');
var _ = require('underscore');
var sc = require("./scriptUtils");

var storage, config, stats;

function init() {

    return sc.parseCommonSettingsAsync(function () {
        return stats;
    }).then(function (c) {
        var argv = c.argv;
        if (argv._.length < 2) {
            console.error('Usage: nodejs %s %s --minsize=NNN storeid base_zoom [test_zoom]\n', __filename, sc.getCommonSettings());
            process.exit(1);
        }

        config = c.config;
        config.storeid = argv._[0];
        config.zoom = parseInt(argv._[1]);
        config.testZoom = parseInt(argv._[2]) || (config.zoom + 1);
        // report only if tile is bigger than minsize (compressed)
        config.minsize = typeof argv.minsize !== 'undefined' ? parseInt(argv.minsize) : 0;

        if (!c.conf.hasOwnProperty(config.storeid)) {
            console.error('Invalid storeid');
            process.exit(1);
        }
        storage = c.conf[config.storeid].handler;
        return true;
    });
}


var gaps = {};
init().then(function() {

    var scale = Math.pow(2, config.testZoom - config.zoom);

    var test = function(from, count) {
        var to = from + count;
        if (config.log) {
            var fromXY = util.indexToXY(from);
            var toXY = util.indexToXY(to - 1);
            console.log('Testing range %d %d/%d (%d) - %d/%d (%d) - %d tiles',
                config.testZoom, fromXY[0], fromXY[1], from, toXY[0], toXY[1], to - 1, count);
        }
        return storage.eachTileAsync({
            zoom: config.testZoom,
            indexStart: from,
            indexEnd: to
        }, function (z, x, y, tile) {
            var bx = Math.floor(x / scale);
            var by = Math.floor(y / scale);
            if (tile.length >= config.minsize) {
                console.log('Tile size %d exists at %d/%d/%d (%d) with missing %d/%d/%d (%d)',
                    tile.length, config.testZoom, x, y, util.xyToIndex(x, y),
                    config.zoom, bx, by, util.xyToIndex(bx, by));
            }
        }).then(function() {
            return next();
        });
    };

    var next = function() {
        var keys = Object.keys(gaps);
        if (keys.length === 0) {
            return true;
        } else {
            var start = keys[0];
            var count = gaps[start];
            delete gaps[start];
            return test(parseInt(start) * scale * scale, parseInt(count) * scale * scale);
        }
    };

    var last = 0;
    function addGap(id) {
        var gapSize = id - last;
        if (gapSize > 0) {
            gaps[last] = gapSize;
            if (config.log) {
                var fromXY = util.indexToXY(last);
                var toXY = util.indexToXY(id - 1);
                console.log('Gap: %d/%d (%d) - %d/%d (%d) - %d tiles',
                    fromXY[0], fromXY[1], last, toXY[0], toXY[1], id - 1, gapSize);
            }
        }
        last = id + 1;
    }
    console.log('Getting empty tiles from Z %d (max %d tiles)', config.zoom, Math.pow(4, config.zoom));
    return storage.eachTileAsync({zoom: config.zoom, gettile: false}, function(z,x,y) {
        addGap(util.xyToIndex(x, y));
    }).then(function() {
        addGap(Math.pow(4, config.zoom));
        var count = Object.keys(gaps).length;
        var sum = _.reduce(gaps, function (memo, v) { return memo + v; }, 0);
        console.log('Found %d gaps - %d missing tiles (%d%%) at Z %d', count, sum,
            Math.round(sum / Math.pow(4, config.zoom) * 1000) / 10, config.zoom);
        return next();
    });

}).then(sc.shutdown);
