var tilelive = require('tilelive');
var TileJSON = require('tilejson');
var url = require('url');
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

// Load fixture data.
var fixtureDir = path.resolve(__dirname + '/fixtures/tm2z'),
    remotePath = 'http://mapbox.s3.amazonaws.com/tilelive-vector/test-tm2z.tm2z',
    xml = fs.readFileSync(fixtureDir + '/project/project.xml');

// Register vector:, tm2z:, tm2z+http: and mapbox: tilelive protocols
require('..').registerProtocols(tilelive);
tilelive.protocols['mapbox:'] = function Source(uri, callback) {
    return new TileJSON('http://a.tiles.mapbox.com/v3' + uri.pathname + '.json', callback);
};

describe('tm2z', function() {
    it('loads a tm2z url', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/project.tm2z', function(err, source) {
            if (err) throw err;
            done();
        });
    });
    it('matches expected xml', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/project.tm2z', function(err, source) {
            if (err) throw err;
            assert.equal(source._xml, xml);
            done();
        });
    });
    it('gunzips then untars', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/project.tar.gz', function(err, source) {
            if (err) throw err;
            done();
        });
    });
    it('errors out if not gzipped', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/project.tar', function(err, source) {
            assert.equal(err.code, 'Z_DATA_ERROR');
            assert.equal(err.message, 'incorrect header check');
            done();
        });
    });
    it('errors out on bad gunzip', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/doublezip.tar.gz', function(err, source) {
            assert.equal(err.message, 'invalid tar file');
            done();
        });
    });
    it('errors out if missing project.xml', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/empty.tar.gz', function(err, source) {
            assert.equal(err.message, 'project.xml not found in package');
            done();
        });
    });
    it('errors out on invalid project.xml', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/malformed.tar.gz', function(err, source) {
            assert.equal(err.message.split(':')[0], 'XML document not well formed');
            done();
        });
    });
});

describe('tm2z+http', function() {
    it('loads a tm2z+http url', function(done) {
        this.timeout(5000);
        tilelive.load('tm2z+' + remotePath, function(err, source) {
            if (err) throw err;
            done();
        });
    });
    it('matches expected xml', function(done) {
        this.timeout(5000);
        tilelive.load('tm2z+' + remotePath, function(err, source) {
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
