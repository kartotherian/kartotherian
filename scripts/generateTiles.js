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

var generator, storage, config;
var nextTile;
var stats;

function init() {
    if (argv._.length < 3) {
        console.error('Usage: nodejs renderLayer2.js [-v|-vv] [--config=<configfile>] [--threads=num] [--maxsize=value] [--check=[all|[-]bytes]] [--quiet] [--xy=4,10] [--minzoom=6] storeid generatorid start_zoom [end_zoom]\n');
        process.exit(1);
    }

    config = {
        storeid: argv._[0],
        generatorid: argv._[1],
        startZoom: parseInt(argv._[2]),
        endZoom: parseInt(argv._[3]) || parseInt(argv._[2]),
        configPath: argv.config || 'config.yaml',
        threads: argv.threads || 1,
        // If tile is bigger than maxsize (compressed), it will always be saved. Set this value to 0 to save everything
        maxsize: typeof argv.maxsize !== 'undefined' ? parseInt(argv.maxsize) : 5 * 1024,
        // If given, positive number means only check existing tiles bigger than N, negative - smaller than N, 0 = missing
        check: argv.check,
        quiet: argv.quiet,
        minzoom: argv.minzoom ? parseInt(argv.minzoom) : 6,
        xy: argv.xy,
        // verbosity
        log: argv.vv ? 2 : (argv.v ? 1 : 0),
        start: new Date(),
        reportStats: function (done) {
            var time = (new Date() - config.start) / 1000;
            var min = Math.floor(time / 60);
            var avg = (stats && stats.checked && time > 0) ? (stats.checked / time) : 0;
            console.log('%s%dmin\tZ=%d\t%d/s\t%s', done ? 'DONE: ' : '', min, config.zoom, avg, JSON.stringify(stats));
        }
    };

    if (typeof config.check === 'undefined') {
        config.check = 'all';
    } else if (config.check !== 'all') {
        config.check = parseInt(config.check);
        if (config.check.toString() !== argv.check.toString()) {
            console.error('check parameter must be either all, or positive/negative integer\n');
            process.exit(1);
        }
    }

    config.zoom = config.startZoom;
    if (config.xy) {
        // Only yield one value given by x,y pair
        config.xy = _.map(config.xy.split(','), function (v) {
            return parseInt(v);
        });
    }

    console.log(JSON.stringify(config));

    if (!config.quiet)
        config.reporter = setInterval(config.reportStats, 60000);

    return fs
        .readFileAsync(conf.normalizePath(config.configPath))
        .then(yaml.safeLoad)
        .then(function (cfg) {
            return conf.loadConfiguration(cfg.services[0].conf);
        })
        .then(function (cfg) {
            if (!cfg.hasOwnProperty(config.storeid)) {
                console.error('Invalid storeid');
                process.exit(1);
            }
            if (!cfg.hasOwnProperty(config.generatorid)) {
                console.error('Invalid generatorid');
                process.exit(1);
            }
            storage = cfg[config.storeid].handler;
            generator = cfg[config.generatorid].handler;
        });
}

function getOptimizedIteratorFunc(zoom, start, count) {
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
}

/**
 * Delete tile from storage
 */
function deleteTileAsync(loc) {
    if (storage.getPath) {
        return fs
            .unlinkAsync(storage.getPath(loc.z, loc.x, loc.y, storage.filetype))
            .catch(function () {
                // ignore
            });
    } else {
        return storage.putTileAsync(loc.z, loc.x, loc.y, null);
    }
}

/**
 * Check if tile exists
 */
function getTileSizeAsync(loc) {
    if (storage.getPath) {
        // file storage
        return fs
            .statAsync(storage.getPath(loc.z, loc.x, loc.y, storage.filetype))
            .get('size')
            .catch(function (err) {
                return -1;
            });
    } else {
        // TODO: optimize
        return storage
            .getTileAsync(loc.z, loc.x, loc.y)
            .get('length')
            .catch(function (err) {
                return -1;
            });
    }
}

function getTileAsync(loc, generate) {
    return BBPromise.try(function () {
        var src = generate ? generator : storage;
        if (generate) stats.tilegen++; else stats.ozload++;
        if (config.log > 1)
            console.log('%s.getTile(%d,%d,%d)', generate ? 'generator' : 'storage', loc.z, loc.x, loc.y);
        return src.getTileAsync(loc.z, loc.x, loc.y);
    }).then(function (tile) {
        if (generate) stats.tilegenok++; else stats.ozloadok++;
        loc.data = tile[0];
        loc.headers = tile[1];
        return loc;
    }).catch(function (err) {
        if (err.message === 'Tile does not exist') {
            if (generate) stats.tilegenempty++; else stats.ozloadempty++;
            loc.data = null;
            return loc;
        } else {
            if (generate) stats.tilegenerr++; else stats.ozloaderror++;
            throw err;
        }
    });
}

function renderTile(threadNo) {
    var loc = nextTile();

    if (!loc) {
        if (!config.quiet)
            console.log('Thread ' + threadNo + ' finished!');
        return true;
    }

    stats.started++; // tiles started

    var promise;
    if (config.check === 'all') {
        promise = BBPromise.resolve(true);
    } else {
        // results in true if this tile should be tested, or false otherwise
        promise = getTileSizeAsync(loc).then(function (size) {
            return (config.check > 0 && size >= config.check) ||
                (config.check < 0 && size >= 0 && size <= config.check) ||
                (config.check === 0 && size < 0);
        });
    }
    return promise
        .then(function(proceed) {
            if (!proceed)
                return undefined;
            stats.checked++;
            return getTileAsync(loc, true)
                .then(function (loc) {
                    if (!loc.data || !loc.data.length) {
                        stats.tilenodata++;
                        return false; // empty tile generated, no need to save
                    }
                    if (loc.data.length >= config.maxsize) {
                        stats.tiletoobig++;
                        return true; // generated tile is too big, save
                    }
                    var vt = new mapnik.VectorTile(loc.z, loc.x, loc.y);
                    return util.uncompressAsync(loc.data)
                        .bind(vt)
                        .then(function (uncompressed) {
                            return this.setDataAsync(uncompressed);
                        }).then(function() {
                            return this.parseAsync();
                        }).then(function () {
                            return this.isSolidAsync();
                        }).spread(function (solid, key) {
                            if (solid) {
                                var stat = 'solid_' + key;
                                stats[stat] = (stat in stats) ? stats[stat] + 1 : 1;
                                if (config.log > 0 && key !== 'water' && key !== 'landuse')
                                    console.log('%d,%d,%d is solid %s', loc.z, loc.x, loc.y, key);
                                return false;
                            } else {
                                stats.tilenonsolid++;
                                return true;
                            }
                        });
                }).then(function (save) {
                    if (save) {
                        stats.save++;
                        return storage.putTileAsync(loc.z, loc.x, loc.y, loc.data);
                    } else {
                        stats.nosave++;
                        return deleteTileAsync(loc);
                    }
                });
        }).then(function() {
            return renderTile(threadNo);
        });
}

function runZoom() {
    stats = {
        checked: 0,
        nosave: 0,
        ozload: 0,
        ozloadempty: 0,
        ozloaderror: 0,
        ozloadok: 0,
        save: 0,
        started: 0,
        tilegen: 0,
        tilegenempty: 0,
        tilegenerr: 0,
        tilegenok: 0,
        tilenodata: 0,
        tilenonsolid: 0,
        tiletoobig: 0
    };

    if (config.xy) {
        // Yield all values under the original X,Y square
        var mult = Math.pow(2, config.zoom - config.startZoom),
            x = config.xy[0] * mult,
            y = config.xy[1] * mult;
        nextTile = getOptimizedIteratorFunc(config.zoom, util.xyToIndex(x, y), Math.pow(4, config.zoom - config.startZoom));
    } else {
        nextTile = getOptimizedIteratorFunc(config.zoom);
    }

    return BBPromise
        .all(_.map(_.range(config.threads), renderTile))
        .then(function () {
            if (config.reporter)
                clearInterval(config.reporter);
            config.reportStats(true);
            config.zoom++;
            if (config.zoom <= config.endZoom) {
                return runZoom();
            }
        });
}

init().then(function() { return runZoom(); }).then(function() { console.log('DONE!'); });
