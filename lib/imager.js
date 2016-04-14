'use strict';

var Promise = require('bluebird');
var makizushi = Promise.promisify(require('makizushi'));
var CanvasImage = require('canvas').Image;
var abaculus = Promise.promisify(require('abaculus'), {multiArgs: true});
var MWApi = require('mwapi');
var _ = require('underscore');
var makeDomainValidator = require('domain-validator');

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
    config = L.mapbox.config;

config.REQUIRE_ACCESS_TOKEN = false;
config.FORCE_HTTPS = false;
config.HTTP_URL = 'local://localhost';
config.HTTPS_URL = false;


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


var document = GLOBAL.document;
var body = document.body;
var elementId = 0;

module.exports = {};

var core, metrics, app, Err, reportRequestError, canvasToBuffer, httpDomains, httpsDomains;

module.exports.init = function init(opts) {
    core = opts.core;
    Err = core.Err;
    app = opts.app;
    metrics = app.metrics;
    reportRequestError = opts.reportRequestError;

    var allowedDomains = opts.app.conf.allowedDomains;
    httpsDomains = makeDomainValidator(allowedDomains ? allowedDomains.https : undefined, true);
    httpDomains = makeDomainValidator(allowedDomains ? allowedDomains.http : undefined, true);
};

function downloadMapdata(protocol, domain, title, groups) {
    var mwapi = new MWApi('kartotherian (yurik @ wikimedia)', protocol + '://' + domain + '/w/api.php');
    var mapdata = [];
    var request = {
        action: 'query',
        prop: 'mapdata',
        mpdlimit: 'max',
        titles: title
    };
    if (groups) {
        request.mpdgroups = groups;
    }

    return mwapi.iterate(request, undefined, function(result) {
        var md = JSON.parse(result.query.pages[0].mapdata);
        mapdata = mapdata.concat.apply(mapdata, _.values(md));
        return true;
    }).then(function() {
        return mapdata;
    });
}

function addGeoJson(buffer, headers, params, geojson) {
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
            lat: Math.min(85, Math.max(-85, lat)),
            lon: Math.min(180, Math.max(-180, lon)),
            w: w, h: h
        },
        format: format,
        getTile: handler.getTile.bind(handler)
    };

    var domain = req.query.domain;
    var title = req.query.title;
    if (domain || title) {

        if (format !== 'png') {
            throw new Err('Only png format is allowed for images with overlays').metrics('err.req.stnonpng');
        }
        if (title.indexOf('|') !== -1) {
            throw new Err('title param may not contain pipe "|" symbol').metrics('err.req.stpipe');
        }
        if (!domain || !title) {
            throw new Err('Both domain and title params are required').metrics('err.req.stboth');
        }
        var protocol;
        if (httpsDomains.test(domain)) {
            protocol = 'https';
        } else if (httpDomains.test(domain)) {
            protocol = 'http';
        } else {
            throw new Err('Domain is not allowed').metrics('err.req.domain');
        }

        return Promise.all([
            downloadMapdata(protocol, domain, title, req.query.groups),
            abaculus(params)
        ]).spread(function (geojson, bufAndHdr) {
            return addGeoJson(bufAndHdr[0], bufAndHdr[1], params, geojson);
        });
    }

    // For now returns JPEG without overlays
    return abaculus(params);
};
