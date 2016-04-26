'use strict';

var Promise = require('bluebird');
var makizushi = Promise.promisify(require('makizushi'));
var CanvasImage = require('canvas').Image;
var leafletImage = Promise.promisify(require('leaflet-image'));
var L = require('leaflet-headless');
require('mapbox.js');

// local://localhost/v4/marker/pin-m-symbol+f00@2x.png
var makiPathRe = /^local:\/\/localhost\/v4\/marker\/(\w+)-([sml])(-([-\w]+))?\+([a-f0-9]{3}|[a-f0-9]{6})(@(2)x)?\.png(\?.*)?/,
    makiGrpBase = 1,
    makiGrpSize = 2,
    makiGrpSymbol = 4,
    makiGrpColor = 5,
    makiGrpScale = 7,
    config = L.mapbox.config,
    canvasToBuffer;

config.REQUIRE_ACCESS_TOKEN = false;
config.FORCE_HTTPS = false;
config.HTTP_URL = 'local://localhost';
config.HTTPS_URL = false;

var document = GLOBAL.document;
var body = document.body;
var elementId = 0;

// Override image loader
L.Image = function Image () {};

Image.prototype.__defineSetter__('src', function (src) {
    var self = this;
    Promise.try(function () {
        var match = makiPathRe.exec(src);
        if (!match) throw new Error('Invalid src ' + src);

        return makizushi({
            base: match[makiGrpBase], // "pin"
            size: match[makiGrpSize], // s|m|l
            symbol: match[makiGrpSymbol], // undefined, digit, letter, or maki symol name - https://www.mapbox.com/maki/
            tint: match[makiGrpColor], // in hex - "abc" or "aabbcc"
            retina: match[makiGrpScale] === '2' // true|false
        });
    }).then(function (data) {
        var image = new CanvasImage();
        image.src = data;
        if (self.onload) {
            self.onload.apply(image);
        }
    }).catch(function (err) {
        if (self.onerror) {
            self.onerror(err);
        }
    });
});

module.exports = function addGeoJson(buffer, headers, params, geojson) {
    // create an element for the map.
    var element = document.createElement('div');
    element.id = 'img' + (elementId++);
    body.appendChild(element);

    var center = params.center;
    var map = L
        .map(element.id)
        .setView([center.lat, center.lon], params.zoom)
        .setSize(center.w, center.h);
    var canvas = L.canvas ? L.canvas() : undefined;

    L.mapbox.featureLayer(geojson).addTo(map);

    return leafletImage(map).then(function(leafletCanvas) {
        body.removeChild(element);

        var canvas = document.createElement('canvas');
        canvas.width = center.w;
        canvas.height = center.h;
        var ctx = canvas.getContext('2d');

        // Draw the background image
        var bgImage = new CanvasImage();
        bgImage.src = buffer;
        ctx.drawImage(bgImage, 0, 0, center.w, center.h);
        ctx.drawImage(leafletCanvas, 0, 0, center.w, center.h);

        if (!canvasToBuffer) {
            // Cache promisified canvas.toBuffer function
            canvasToBuffer = Promise.promisify(canvas.toBuffer);
        }

        // Need to return two values - data and headers
        return canvasToBuffer.call(canvas).then(function(buffer) {
            return [buffer, headers];
        });
    });
};
