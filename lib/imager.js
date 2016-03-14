'use strict';

var BBPromise = require('bluebird');
var makizushi = BBPromise.promisify(require('makizushi'));
var CanvasImage = require('canvas').Image;
var abaculus = BBPromise.promisify(require('abaculus'), {multiArgs: true});
var leafletImage = BBPromise.promisify(require('leaflet-image'));
var L = require('leaflet-headless');
require('mapbox.js');


// local://localhost/v4/marker/pin-m-symbol+f00@2x.png
var makiPathRe = /^local:\/\/localhost\/v4\/marker\/(\w+)-([sml])(-([-\w]+))?\+([a-f0-9]{3}|[a-f0-9]{6})(@(2)x)?\.png(\?.*)?/,
    makiGrpBase = 1,
    makiGrpSize = 2,
    makiGrpSymbol = 4,
    makiGrpColor = 5,
    makiGrpScale = 7,
    config = L.mapbox.config;

config.REQUIRE_ACCESS_TOKEN = false;
config.FORCE_HTTPS = false;
config.HTTP_URL = 'local://localhost';
config.HTTPS_URL = false;


// Override image loader
L.Image = function Image () {};

Image.prototype.__defineSetter__('src', function (src) {
    var self = this;
    BBPromise.try(function () {
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


var document = GLOBAL.document;
var body = document.body;
var elementId = 0;

module.exports = {};

var core, metrics, app, Err, reportRequestError, canvasToBuffer;

module.exports.init = function init(opts) {
    core = opts.core;
    Err = core.Err;
    app = opts.app;
    metrics = app.metrics;
    reportRequestError = opts.reportRequestError;
};

function addGeoJson(buffer, headers, params) {
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

    var geojson = [
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [-77.03238901390978, 38.913188059745586],
                    [-122.414, 37.776]
                ]
            },
            properties: {
                stroke: '#fc4353',
                'stroke-width': 5
            }
        },
        {
            type: 'Feature',
            geometry: {type: 'LineString',coordinates: [[-180, 90],[180, -90]]},
            properties: { stroke: '#fc4353', 'stroke-width': 2 }
        },
        {
            "type": "Feature",
            properties: {
                stroke: '#fc4353',
                'stroke-width': 2
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]]
                ]
            }
        },
        {
            "type": "Feature",
            "properties": { "marker-color": "f00" },
            "geometry": { "type": "Point", "coordinates": [0,0] }
        }
    ];

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
            canvasToBuffer = BBPromise.promisify(canvas.toBuffer);
        }

        // Need to return two values - data and headers
        return canvasToBuffer.call(canvas).then(function(buffer) {
            return [buffer, headers];
        });
    });
}

module.exports.render = function render(source, format, req, z, scale, handler) {
    if (!source.static) {
        throw new Err('Static snapshot images are not enabled for this source').metrics('err.req.static');
    }
    if (format !== 'png' && format !== 'jpeg') {
        throw new Err('Format %s is not allowed for static images', format).metrics('err.req.stformat');
    }
    var lat = core.strToFloat(req.params.lat);
    var lon = core.strToFloat(req.params.lon);
    var w = core.strToInt(req.params.w);
    var h = core.strToInt(req.params.h);
    if (typeof lat !== 'number' || typeof lon !== 'number') {
        throw new Err('The lat and lon coordinates must be numeric for static images').metrics('err.req.stcoords');
    }
    if (!core.isInteger(w) || !core.isInteger(h)) {
        throw new Err('The width and height params must be integers for static images').metrics('err.req.stsize');
    }
    if (w > source.maxwidth || h > source.maxheight) {
        throw new Err('Requested image is too big').metrics('err.req.stsizebig');
    }
    var params = {
        zoom: z,
        scale: scale,
        center: {
            lat: Math.min(85,Math.max(-85, lat)),
            lon: Math.min(180,Math.max(-180, lon)),
            w: w, h: h
        },
        format: format,
        getTile: handler.getTile.bind(handler)
    };
    var p = abaculus(params);

    if (format === 'png') {
        // For now returns JPEG without overlays
        p = p.spread(function (buffer, headers) {
            return addGeoJson(buffer, headers, params);
        });
    }

    return p;
};
