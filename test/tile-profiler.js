var tilelive = require('tilelive');
var Vector = require('..');
var Profiler = require('../tile-profiler');
var Testsource = require('./testsource');
var ss = require('simple-statistics');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var zlib = require('zlib');

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
    it('finds geometry statistics', function(done) {
        var cb = function(err, vtile, headers) {
            assert.ifError(err);
            assert(vtile._geometryStats);
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
    it('returns tile size', function(done) {
        var p = new Profiler(tile);
        assert.equal(p.tileSize(), tile._srcbytes);
        done();
    });
    it('returns geometry statistics', function(done) {
        var p = new Profiler(tile);
        var geomStats = p.geometryStatistics();

        // Tile has a 'coastline' layer
        assert.equal(geomStats.coastline.name, 'coastline');

        // Tile contains 4177 features
        assert.equal(
            geomStats.coastline.coordCount.length,
            geomStats.coastline.coordCount.length,
            geomStats.coastline.duplicateCoordCount.length,
            geomStats.coastline.coordDistance.length,
            4177
        );

        // Longest/shortest features
        assert.equal(ss.max(geomStats.coastline.coordCount), 381);
        assert.equal(ss.min(geomStats.coastline.coordCount), 2);

        // Most/least duplication
        assert.equal(ss.max(geomStats.coastline.duplicateCoordCount), 9);
        assert.equal(ss.min(geomStats.coastline.duplicateCoordCount), 0);

        // Max/Min distance between consecutive coords
        assert.equal(ss.max(geomStats.coastline.coordDistance), 570446.5598775251);
        assert.equal(ss.min(geomStats.coastline.coordDistance), 0);
        done();
    });
});
