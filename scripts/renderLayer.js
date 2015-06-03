#!/usr/bin/nodejs

var request = require('request');
var util = require('util');
var argv = require('minimist')(process.argv.slice(2));

if (argv._.length < 2) {
    console.error('Usage: nodejs renderLayer.js [--mode=<generate|force>] [--threads=num] url zoom [end_zoom]\n');
    process.exit(1);
}

var mode = argv.mode || 'force';
if (mode != 'generate' && mode != 'force') {
    console.error('Unknown mode\n');
    process.exit(1);
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

    var url = util.format('%s/%d/%d/%d.vector.pbf.%s', baseUrl, zxy[0], zxy[1], zxy[2], mode);
    console.log('Thread ' + threadNo + ' is requesting ' + url);
    request.get(url)
        .on('response', function(response) {
            if (response.statusCode != 200) {
                console.error(url + ': HTTP ' + response.statusCode);
            }
            renderTile(threadNo);
        })
        .on('error', function(err) {
            console.error(typeof err, err);
            process.exit(1);
        });
}

nextZoomLevel();
for (var i = 0; i < threads; i++) {
    renderTile(i);
}
