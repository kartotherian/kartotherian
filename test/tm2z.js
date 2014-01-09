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
       tilelive.load('tm2z://' + fixtureDir + '/doublezip.tm2z', function(err, source) {
            assert.equal(err.message, 'invalid tar file');
            done();
        });
    });
    it('errors out if file size exceeds max size', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/filesize.tm2z', function(err, source) {
            assert.equal(err instanceof RangeError, true);
            assert.equal(err.message, 'Upload size should not exceed 750KB.');
            done();
        });
    });
    it('errors out if file size exceeds custom max size', function(done) {
        tilelive.load({
            protocol: 'tm2z:',
            pathname: fixtureDir + '/filesize.tm2z',
            filesize: 500 * 1024
        }, function(err, source) {
            assert.equal(err instanceof RangeError, true);
            assert.equal(err.message, 'Upload size should not exceed 500KB.');
            done();
        });
    });
    it('errors out if unzipped size exceeds max size', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/gunzipsize.tm2z', function(err, source) {
            assert.equal(err instanceof RangeError, true);
            assert.equal(err.message, 'Unzipped size should not exceed 5MB.');
            done();
        });
    });
    it('errors out if unzipped size exceeds custom max size', function(done) {
        tilelive.load({
            protocol: 'tm2z:',
            pathname: fixtureDir + '/gunzipsize.tm2z',
            gunzipsize: 1024 * 1024
        }, function(err, source) {
            assert.equal(err instanceof RangeError, true);
            assert.equal(err.message, 'Unzipped size should not exceed 1MB.');
            done();
        });
    });
    it('errors out if unzipped project.xml size exceeds max size', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/xmlsize.tm2z', function(err, source) {
            assert.equal(err instanceof RangeError, true);
            assert.equal(err.message, 'Unzipped project.xml size should not exceed 750KB.');
            done();
        });
    });
    it('errors out if unzipped project.xml size exceeds custom max size', function(done) {
        tilelive.load({
            protocol: 'tm2z:',
            pathname: fixtureDir + '/xmlsize.tm2z',
            xmlsize: 300 * 1024
        }, function(err, source) {
            assert.equal(err instanceof RangeError, true);
            assert.equal(err.message, 'Unzipped project.xml size should not exceed 300KB.');
            done();
        });
    });
    it('errors out if not a directory', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/nodirectory.tm2z', function(err, source) {
            assert.equal(err.message.split(',')[0], 'EISDIR');
            done();
        });
    });
    it('errors out if missing project.xml', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/empty.tm2z', function(err, source) {
            assert.equal(err.message, 'project.xml not found in package');
            done();
        });
    });
    it('errors out on invalid project.xml', function(done) {
        tilelive.load('tm2z://' + fixtureDir + '/malformed.tm2z', function(err, source) {
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
