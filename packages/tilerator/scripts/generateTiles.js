#!/usr/bin/nodejs

'use strict';

var promisify = require('../lib/promisify');
var BBPromise = require('bluebird');
var util = require('../lib/util');
var _ = require('underscore');
var mapnik = require('mapnik');
var sc = require("./scriptUtils");
var core = require('kartotherian-core');

var generator, storage, config, nextTile, stats;

function init() {

    return sc.parseCommonSettingsAsync(function () {
        stats.avgsize = stats.save ? Math.round(stats.totalsize / stats.save * 100) / 100 : 0;
        return stats;
    }).then(function (c) {
        var argv = c.argv;
        if (argv._.length < 3) {
            console.error('Usage: nodejs %s %s [--maxsize=value] [--check=[all|[-]bytes]] storeid generatorid start_zoom [end_zoom]\n',
                __filename, sc.getCommonSettings());
            process.exit(1);
        }

        config = c.config;
        config.storeid = argv._[0];
        config.generatorid = argv._[1];
        config.startZoom = parseInt(argv._[2]);
        config.endZoom = parseInt(argv._[3]) || parseInt(argv._[2]);
        // if tile is bigger than maxsize (compressed), it will always be saved. Set this value to 0 to save everythin;
        config.maxsize = typeof argv.maxsize !== 'undefined' ? parseInt(argv.maxsize) : 2 * 1024;
        //  if given, positive number means only check existing tiles bigger than N, negative - smaller than N, 0 = missin;
        config.check = argv.check;

        if (!c.conf.hasOwnProperty(config.storeid)) {
            console.error('Invalid storeid');
            process.exit(1);
        }
        if (!c.conf.hasOwnProperty(config.generatorid)) {
            console.error('Invalid generatorid');
            process.exit(1);
        }
        storage = c.conf[config.storeid].handler;
        generator = c.conf[config.generatorid].handler;

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
        return true;
    });
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
        if (core.isNoTileError(err)) {
            if (generate) stats.tilegenempty++; else stats.ozloadempty++;
            loc.data = null;
            return loc;
        } else {
            if (generate) stats.tilegenerr++; else stats.ozloaderror++;
            throw err;
        }
    });
}

function renderTileAsync(threadNo) {
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
        promise = sc.getTileSizeAsync(storage, loc).then(function (size) {
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
                        stats.totalsize += loc.data.length;
                        return storage.putTileAsync(loc.z, loc.x, loc.y, loc.data);
                    } else {
                        stats.nosave++;
                        return sc.deleteTileAsync(storage, loc);
                    }
                });
        }).then(function() {
            return renderTileAsync(threadNo);
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
        tiletoobig: 0,
        totalsize: 0
    };

    if (config.xy) {
        // Yield all values under the original X,Y square
        var mult = Math.pow(2, config.zoom - config.startZoom),
            x = config.xy[0] * mult,
            y = config.xy[1] * mult;
        nextTile = sc.getOptimizedIteratorFunc(config.zoom, util.xyToIndex(x, y), Math.pow(4, config.zoom - config.startZoom));
    } else {
        nextTile = sc.getOptimizedIteratorFunc(config.zoom);
    }

    return BBPromise
        .all(_.map(_.range(config.threads), renderTileAsync))
        .then(function () {
            config.reportStats(true);
            config.zoom++;
            if (config.zoom <= config.endZoom) {
                return runZoom();
            }
        });
}

init()
    .then(function() { return storage.startWritingAsync ? storage.startWritingAsync() : true; })
    .then(function() { return runZoom(); })
    .then(function() { return storage.startWritingAsync ? storage.stopWritingAsync() : true; })
    .then(sc.shutdown);
