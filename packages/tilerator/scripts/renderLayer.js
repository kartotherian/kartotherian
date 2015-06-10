#!/usr/bin/nodejs

var preq = require('preq');
var util = require('util');
var argv = require('minimist')(process.argv.slice(2));

if (argv._.length < 2) {
    console.error('Usage: nodejs renderLayer.js [--format=<vector.pbf|png|jpeg>] [--mode=<generate|force|normal>] [--threads=num] url zoom [end_zoom]\n');
    process.exit(1);
}

var format = argv.format || 'vector.pbf';
var mode = argv.mode || 'generate';
if (mode != 'generate' && mode != 'force' && mode != 'normal') {
    console.error('Unknown mode\n');
    process.exit(1);
}
if (mode == 'normal') {
    mode = '';
} else {
    mode = '.' + mode;
}
var threads = argv.threads || 1;
var baseUrl = argv._[0];
var startZoom = parseInt(argv._[1]);
var endZoom = parseInt(argv._[2]) || startZoom;

var zoom = startZoom - 1, x, y;
var dim;

function nextZoomLevel() {
    zoom++;

    if (zoom > endZoom) {
        return false;
    }
    x = y = 0;
    dim = Math.pow(2, zoom);

    return true;
}

function nextTile() {
    if (x >= dim) {
        y++;
        x = 0;
    }
    if (y >= dim) {
        if (!nextZoomLevel()) {
            return false;
        }
    }
    var result = [zoom, x, y];
    x++;

    return result;
}

function renderTile(threadNo) {
    var zxy = nextTile();

    if (!zxy) {
        console.log('Thread ' + threadNo + ' finished!');
        return;
    }

    var url = util.format('%s/%d/%d/%d.%s%s', baseUrl, zxy[0], zxy[1], zxy[2], format, mode);
    console.log('Thread ' + threadNo + ' is requesting ' + url);
    preq.get(url, { agent: false } )
        .then(function(response) {
            renderTile(threadNo);
        })
        .catch(function(err) {
            console.error(err.body.stack || err.body.detail);
            process.exit(1);
        });
}

nextZoomLevel();
for (var i = 0; i < threads; i++) {
    renderTile(i);
}
