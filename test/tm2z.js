var tilelive = require('tilelive');
var TileJSON = require('tilejson');
// var url = require('url');
var tar = require('tar');
var zlib = require('zlib');
var assert = require('assert');
var path = require('path');
var fs = require('fs');
// var imageEqualsFile = require('./image.js');

// Load fixture data.
var local = 'tm2z://' + path.resolve(__dirname + '/test-tm2z.tm2z'),
    remote = 'tm2z+http://mapbox.s3.amazonaws.com/tilelive-vector/test-tm2z.tm2z',
    xml = fs.readFileSync(__dirname + '/test-tm2z-project.xml');

/*
// Additional error tile fixtures.
zlib.deflate(new Buffer('asdf'), function(err, deflated) {
    if (err) throw err;
    tiles.a['1.0.2'] = new Buffer('asdf'); // invalid deflate
    tiles.a['1.0.3'] = deflated;           // invalid protobuf
});
*/

// Register vector:, tm2z:, tm2z+http: and mapbox: tilelive protocols
require('..').registerProtocols(tilelive);
tilelive.protocols['mapbox:'] = function Source(uri, callback) {
    return new TileJSON('http://a.tiles.mapbox.com/v3' + uri.pathname + '.json', callback);
};

describe('tm2z', function() {
    it('loads a tm2z url', function(done) {
        tilelive.load(local, function(err, source) {
            if (err) throw err;
            done();
        });
    });
    it('matches expected xml', function(done) {
        tilelive.load(local, function(err, source) {
            if (err) throw err;
            assert.equal(xml, source._xml);
            done();
        });
    });
    /*
    it('errors out on bad deflate', function(done) {
        sources.a.getTile(1, 0, 2, function(err) {
            assert.equal('Z_DATA_ERROR', err.code);
            done();
        });
    });
    it('errors out on bad protobuf', function(done) {
        sources.a.getTile(1, 0, 3, function(err) {
            assert.equal('could not parse protobuf', err.message);
            done();
        });
    });
    */
});
describe('tm2z+http', function() {
    it('loads a tm2z+http url', function(done) {
        this.timeout(5000);
        tilelive.load(remote, function(err, source) {
            if (err) throw err;
            done();
        });
    });
    it('matches expected xml', function(done) {
        this.timeout(5000);
        tilelive.load(remote, function(err, source) {
            if (err) throw err;
            assert.equal(xml, source._xml);
            done();
        });
    });
    it('errors out on an invalid S3 url', function(done) {
        tilelive.load('tm2z+http://mapbox.s3.amazonaws.com/tilelive-vector/invalid.tm2z', function(err, source) {
            assert.equal('Z_DATA_ERROR', err.code);
            done();
        });
    });
});
