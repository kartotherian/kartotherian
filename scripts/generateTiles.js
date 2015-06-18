#!/usr/bin/nodejs

var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var BBPromise = require('bluebird');
var buffertools = require('buffertools');
var conf = require('../lib/conf');
var fsp = require('fs-promise');
var mapnik = require('mapnik');
var util = require('util');
var yaml = require('js-yaml');
var zlib = require('zlib');

var generator, storage, config;
var nextTile;
var stats;

function init() {
    if (argv._.length < 3) {
        console.error('Usage: nodejs renderLayer2.js [-v|-vv] [--config=<configfile>] [--threads=num] [--maxsize=value]  [-q]  [--ozmaxsize=value] [--xy=4,10] [--minzoom=6] storeid generatorid zoom [end_zoom]\n');
        process.exit(1);
    }

    config = {
        storeid: argv._[0],
        generatorid: argv._[1],
        zoom: parseInt(argv._[2]),
        endZoom: parseInt(argv._[3]) || startZoom,
        configPath: argv.config || 'config.yaml',
        threads: argv.threads || 1,
        // If tile is bigger than maxsize (compressed), it will always be saved. Set this value to 0 to save everything
        maxsize: argv.maxsize ? parseInt(argv.maxsize) : 5 * 1024,
        // If given, sets maximum size of the overzoom tile to be used. Prevents very large tiles from being heavily used (might be slow)
        ozmaxsize: argv.ozmaxsize ? parseInt(argv.ozmaxsize) : 100 * 1024,
        quiet: argv.q,
        minzoom: argv.minzoom ? parseInt(argv.minzoom) : 6,
        xy: argv.xy,
        // verbosity
        log: argv.vv ? 2 : (argv.v ? 1 : 0),
        start: new Date(),
        reportStats: function () {
            var sec = Math.floor((new Date() - config.start) / 1000);
            var hr = Math.floor(sec / 60 / 60);
            sec -= hr * 60 * 60;
            var min = Math.floor(sec/60);
            sec -= min * 60;
            console.info('%d:%d:%d Z=%d %s', hr, min, sec, config.zoom, JSON.stringify(stats));
        }
    };

    if (config.xy) {
        // Only yield one value given by x,y pair
        config.xy = _.map(config.xy.split(','), function (v) {
            return parseInt(v);
        });
        config.xy = {z: config.zoom, x: config.xy[0], y: config.xy[1]};
        nextTile = function () {
            // Yields object first time, and false on all subsequent calls
            var loc = config.xy;
            config.xy = false;
            return loc;
        };
    } else {
        nextTile = getOptimizedIteratorFunc(config.zoom);
    }

    if (!quiet)
        config.reporter = setInterval(config.reportStats, 60000);

    return fsp
        .readFile(conf.normalizePath(config.configPath))
        .then(yaml.safeLoad)
        .then(function (cfg) {
            return conf.loadConfiguration(cfg.services[0].conf);
        })
        .then(function (cfg) {
            if (!cfg.hasOwnProperty(config.storeid)) {
                console.error('Invalid storeid\n');
                process.exit(1);
            }
            if (!cfg.hasOwnProperty(config.generatorid)) {
                console.error('Invalid generatorid\n');
                process.exit(1);
            }
            storage = cfg[config.storeid].handler;
            generator = cfg[config.generatorid].handler;
        });
}

function getOptimizedIteratorFunc(zoom) {
    var index = 0, maximum = Math.pow(4, zoom);
    console.info("Generating %d tiles", maximum);

    var extractBits = function (value, isOdd) {
        // Given a 64bit integer, extract every odd or even bit into one (32bit) value
        var result = 0;
        if (!isOdd) {
            value = Math.floor(value / 2);
        }
        while (value) {
            result = (result * 2) + (value % 2);
            value = Math.floor(value / 4);
        }
        return result;
    };
    return function () {
        if (index >= maximum) {
            return false;
        }
        var loc = {z: zoom, x: extractBits(index, true), y: extractBits(index, false)};
        index++;
        return loc;
    };
}

function getTilePromise(loc, generate) {
    return new BBPromise(
        function (fulfill, reject) {
            var src = generate ? generator : storage;
            if (generate) stats.tilegen++; else stats.ozload++;
            if (config.log > 1)
                console.log(util.format('INFO: %s.getTile(%d,%d,%d)', generate ? 'generator' : 'storage', loc.z, loc.x, loc.y));
            src.getTile(loc.z, loc.x, loc.y, function (err, tile) {
                if (err) {
                    if (err.message === 'Tile does not exist') {
                        if (generate) stats.tilegenempty++; else stats.ozloadempty++;
                        loc.data = null;
                        fulfill(loc);
                    } else {
                        if (generate) stats.tilegenerr++; else stats.ozloaderror++;
                        reject(err);
                    }
                } else {
                    if (generate) stats.tilegenok++; else stats.ozloadok++;
                    loc.data = tile;
                    fulfill(loc);
                }
            });
        });
}

function uncompressThen(loc) {
    if (typeof loc.uncompressed !== 'undefined' || !loc.data || !loc.data.length || loc.error) {
        return loc;
    }
    var compression = false;
    if (loc.data[0] === 0x1F && loc.data[1] === 0x8B) {
        stats.unzipgz++;
        compression = 'gunzip';
    } else if (loc.data[0] === 0x78 && loc.data[1] === 0x9C) {
        stats.unzipinfl++;
        compression = 'inflate';
    } else {
        stats.unzipno++;
        return loc;
    }
    return new BBPromise(function (fulfill, reject) {
        if (config.log > 1)
            console.log(util.format('INFO: %s(%d,%d,%d)', compression, loc.z, loc.x, loc.y));
        zlib[compression](loc.data, function (err, data) {
            if (err) {
                stats.unziperr++;
                return reject(err);
            } else {
                stats.unzipok++;
                loc.uncompressed = data;
                return fulfill(loc);
            }
        });
    });
}

var tilecache;
function createOverzoomList(loc) {
    var overzoomLevels = loc.z - config.minzoom;
    if (!tilecache || overzoomLevels < 0 || tilecache.length < overzoomLevels) {
        if (overzoomLevels < 0) {
            return [];
        }
        tilecache = new Array(overzoomLevels);
    }
    var x = loc.x, y = loc.y;
    for (var z = loc.z - 1; z >= config.minzoom; z--) {
        x = Math.floor(x / 2);
        y = Math.floor(y / 2);
        var t = tilecache[z];
        if (!t || t.x !== x || t.y !== y) {
            tilecache[loc.z - 1 - z] = {z: z, x: x, y: y};
        } else {
            break; // Optimization: assume all higher levels are already correct
        }
    }
    return tilecache.slice(0); // clone array
}

function renderTile(threadNo) {
    var loc = nextTile();

    if (!loc) {
        console.log('Thread ' + threadNo + ' finished!');
        return true;
    }

    stats.started++; // tiles started
    // Check current tile against an overzoom level above (ozlvl 0 == zoom-1, 1==zoom-2)
    var zoomOutAndTest = function (loc, ozlvl) {
        if (typeof loc === 'boolean') {
            return loc;
        }
        ozlvl = ozlvl || 0;
        if (loc.overzoom.length <= ozlvl) {
            stats.notileabove++;
            return true; // No tiles above, save
        }
        var oz = loc.overzoom[ozlvl];
        if (!oz.promise) {
            //overzoom tile not loaded
            oz.promise = getTilePromise(oz)
                .then(function(oz) {
                    if (oz.data && oz.data.length > config.ozmaxsize) {
                        stats.oztoobig++;
                        oz.error = true; // don't use this tile or above
                    }
                    return oz;
                })
                .then(uncompressThen)
                .catch(function (err) {
                    stats.ozunkerror++;
                    oz.error = err || true;
                    console.error(util.format('Thread %d failed to get overzoom (%d,%d,%d): %s', threadNo, oz.z, oz.x, oz.y,
                        (err.body && (err.body.stack || err.body.detail)) || (err && err.stack) || err));
                });
        }
        return oz.promise.then(function (oz) {
            if (oz.error) {
                stats.ozerror++;
                return true; // error above, save
            }
            if (!oz.data) {
                // overzoom tile is missing, keep going up
                stats.ozmissing++;
                return zoomOutAndTest(loc, ozlvl + 1);
            }
            if (!oz.uncompressed || oz.uncompressed.length === 0) {
                stats.ozunzipempty++;
                throw new Error('uncompressed is empty');
            }
            stats.ozcmp++;
            var target = new mapnik.VectorTile(loc.z, loc.x, loc.y);
            target.setData(oz.uncompressed);
            target.parse();
            var ozdata = target.getData();
            var equals = buffertools.equals(loc.uncompressed, ozdata);
            var stat = equals ? 'ozequals' : 'oznoteq';
            stats[stat]++;
            stat += oz.z;
            stats[stat] = (stat in stats) ? stats[stat] + 1 : 1;
            return !equals;
        });
    };

    loc.overzoom = createOverzoomList(loc);
    return getTilePromise(loc, true)
        .then(function (loc) {
            if (!loc.data) {
                stats.tilenodata++;
                return false; // empty tile generated, no need to save
            }
            if (loc.data.length >= config.maxsize) {
                stats.tiletoobig++;
                return true; // generated tile is too big, save
            }
            return uncompressThen(loc);
        })
        .then(zoomOutAndTest)
        .then(function (saveTile) {
            if (config.log > 0)
                console.log(util.format('Thread %d %s (%d,%d,%d)',
                    threadNo, saveTile ? 'saving' : 'skipping', loc.z, loc.x, loc.y));
            if (saveTile) {
                stats.save++;
                return new BBPromise(function (fulfill, reject) {
                    storage.putTile(loc.z, loc.x, loc.y, loc.data, function (err) {
                        return err ? reject(err) : fulfill();
                    });
                });
            } else {
                stats.nosave++;
                return fsp.unlink(storage.getPath(loc.z, loc.x, loc.y, storage.filetype)).catch(function () {});
            }
        }).catch(function (err) {
            stats.unknerror++;
            console.error(util.format('Thread %d failed to process (%d,%d,%d): %s', threadNo, loc.z, loc.x, loc.y,
                (err.body && (err.body.stack || err.body.detail)) || (err && err.stack) || err));
        }).then(function () {
            return renderTile(threadNo);
        });
}

function runZoom(zoom) {
    config.zoom = zoom;
    stats = {
        nosave: 0,
        notileabove: 0,
        ozcmp: 0,
        ozequals: 0,
        ozerror: 0,
        ozmissing: 0,
        oznoteq: 0,
        ozload: 0,
        ozloadempty: 0,
        ozloaderror: 0,
        ozloadok: 0,
        oztoobig: 0,
        ozunkerror: 0,
        ozunzipempty: 0,
        save: 0,
        started: 0,
        tilegen: 0,
        tilegenempty: 0,
        tilegenerr: 0,
        tilegenok: 0,
        tilenodata: 0,
        tiletoobig: 0,
        unknerror: 0,
        unziperr: 0,
        unzipgz: 0,
        unzipinfl: 0,
        unzipno: 0,
        unzipok: 0
    };

    return BBPromise
        .all(_.map(_.range(config.threads), renderTile))
        .then(function () {
            if (config.reporter)
                clearInterval(config.reporter);
            config.reportStats();
            if (zoom < config.endZoom) {
                return runZoom(zoom + 1);
            }
        });
}

init().then(runZoom(config.zoom)).then(function() { console.log('DONE!'); });
