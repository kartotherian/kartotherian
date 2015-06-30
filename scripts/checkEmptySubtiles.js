#!/usr/bin/nodejs

'use strict';

var promisify = require('../lib/promisify');
var BBPromise = require('bluebird');
var util = require('../lib/util');
var _ = require('underscore');
var mapnik = require('mapnik');
var sc = require("./scriptUtils");

var storage, config, stats;

function init() {

    return sc.parseCommonSettingsAsync(function () {
        return stats;
    }).then(function (c) {
        var argv = c.argv;
        if (argv._.length < 3) {
            console.error('Usage: nodejs %s %s storeid base_zoom [test_zoom]\n', __filename, sc.getCommonSettings());
            process.exit(1);
        }

        config = c.config;
        config.storeid = argv._[0];
        config.baseZoom = parseInt(argv._[1]);
        config.testZoom = parseInt(argv._[2]) || parseInt(argv._[1]);

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

    var test = function(from, count) {
        return storage.eachTileAsync({
            zoom: config.testZoom,
            indexStart: from,
            indexEnd: from + count
        }, function (z, x, y, tile) {
            var scale = Math.pow(2, config.testZoom - config.baseZoom);
            console.log('Tile size %d exists at (%d, %d, %d, %d) with missing (%d, %d, %d)',
                tile.length, config.testZoom, x, y, util.xyToIndex(x, y), config.baseZoom,
                Math.floor(x / scale), Math.floor(y / scale));
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
            return test(parseInt(start), parseInt(count));
        }
    };

    var last = 0;
    return storage.eachTileAsync({zoom: config.baseZoom}, function(z,x,y) {
        var id = util.xyToIndex(x, y);
        var gapSize = id - last;
        if (gapSize > 0) gaps[last] = gapSize - 1;
        last = id + 1;
    }).then(function() {
        var gapSize = Math.pow(4, config.baseZoom) - last;
        if (gapSize > 0) gaps[last] = gapSize - 1;
        return next();
    });

}).then(function() { console.log('DONE!'); });
