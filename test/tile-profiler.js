var tilelive = require('tilelive');
var Vector = require('..');
var Profiler = require('../tile-profiler');
var Testsource = require('./testsource');
var ss = require('simple-statistics');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var zlib = require('zlib');
var _ = require('underscore');

// Tilelive test source.
tilelive.protocols['test:'] = Testsource;

var xml = fs.readFileSync(path.resolve(__dirname + '/fixtures/a.xml'), 'utf8');

describe('getTile', function() {
    var source;
    before(function(done) {
        new Vector({ uri:'test:///a', xml: xml }, function(err, s) {
            if (err) throw err;
            source = s;
            done();
        });
    });
    it('finds layer information', function(done) {
        var cb = function(err, vtile, headers) {
            assert.ifError(err);
            assert(vtile._layerInfo);
            done();
        };
        cb.profile = true;
        source.getTile(0,0,0,cb);
    });
});

describe('profiler', function() {
    var tile;
    before(function(done) {
        new Vector({ uri:'test:///a', xml: xml }, function(err, source) {
            if (err) throw err;
            source._backend.getTile(0,0,0, function(err, vtile, headers) {
                if (err) throw err;
                tile = vtile;
                done();
            });
        });
    });
    it('returns expected layer information', function(done) {
        var p = new Profiler(tile);
        var layerInfo = p.layerInfo();

        // Tile has a 'coastline' layer
        var coastline = _(layerInfo).where({ name: 'coastline' })[0];
        assert(coastline);

        // Tile contains 4177 features
        assert.equal(coastline.coordCount.length, 4177);
        assert.equal(coastline.features, 4177);

        // Longest/shortest features
        assert.equal(ss.max(coastline.coordCount), 381);
        assert.equal(ss.min(coastline.coordCount), 2);

        // Most/least duplication
        assert.equal(ss.max(coastline.duplicateCoordCount), 9);
        assert.equal(ss.min(coastline.duplicateCoordCount), 0);

        // Max/Min distance between consecutive coords
        assert.equal(ss.max(coastline.coordDistance), 570446.5598775251);
        assert.equal(ss.min(coastline.coordDistance), 0);

        // Expected jsonsize
        assert.equal(coastline.jsonsize, 520120);
        done();
    });
});
