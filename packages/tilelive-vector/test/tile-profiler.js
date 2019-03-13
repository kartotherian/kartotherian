var test = require('tape');
var tilelive = require('@mapbox/tilelive');
var Vector = require('..');
var profiler = require('../tile-profiler');
var Testsource = require('./testsource');
var ss = require('simple-statistics');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var _ = require('underscore');

// Tilelive test source.
tilelive.protocols['test:'] = Testsource;

var xml = fs.readFileSync(path.resolve(__dirname + '/fixtures/a.xml'), 'utf8');

test('finds layer information', function(t) {
    new Vector({ uri:'test:///a', xml: xml }, function(err, source) {
        t.ifError(err);
        var cb = function(err, vtile, headers) {
            t.ifError(err);
            t.ok(vtile._layerInfo);
            t.end();
        };
        cb.profile = true;
        source.getTile(0,0,0,cb);
    });
});

test('returns expected layer information', function(t) {
    new Vector({ uri:'test:///a', xml: xml }, function(err, source) {
        t.ifError(err);
        source._backend.getTile(0,0,0, function(err, vtile, headers) {
            if (err) throw err;
            var tile = vtile;
            var layerInfo = profiler.layerInfo(tile);

            // Tile has a 'coastline' layer
            var coastline = _(layerInfo).where({ name: 'coastline' })[0];
            t.ok(coastline);

            // Tile contains 4177 features
            t.equal(coastline.coordCount.length, 1437);
            t.equal(coastline.features, 1437);

            // Longest/shortest features
            t.equal(ss.max(coastline.coordCount), 380);
            t.equal(ss.min(coastline.coordCount), 2);

            // Most/least duplication
            t.equal(ss.max(coastline.duplicateCoordCount), 0);
            t.equal(ss.min(coastline.duplicateCoordCount), 0);

            // Max/Min distance between consecutive coords
            var diff = Math.abs(ss.max(coastline.coordDistance) - 570446.5598775251);
            t.ok(diff < 0.1);
            t.equal(ss.min(coastline.coordDistance), 1181.6043940629547);

            // Expected jsonsize
            t.equal(coastline.jsonsize, 520120);

            t.end();
        });
    });
});

