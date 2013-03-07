var assert = require('assert');
var Vector = require('..');
var path = require('path');
var fs = require('fs');
var xml = {
    a: fs.readFileSync(path.resolve(__dirname + '/test-a.xml'), 'utf8'),
    b: fs.readFileSync(path.resolve(__dirname + '/test-b.xml'), 'utf8')
};

function Testsource(uri, callback) {
    this.uri = uri;
    return callback && callback(null, this);
};

describe('init', function() {
    it('should fail without backend', function(done) {
        new Vector({}, function(err) {
            assert.equal(err.message, 'No datatile backend');
            done();
        });
    });
    it('should fail without xml', function(done) {
        new Vector({ backend: new Testsource() }, function(err) {
            assert.equal(err.message, 'No xml');
            done();
        });
    });
    it('should load with callback', function(done) {
        new Vector({ backend: new Testsource(), xml: xml.a }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            done();
        });
    });
    it('#open should call all listeners', function(done) {
        var v = new Vector({ backend: new Testsource(), xml: xml.a });
        var remaining = 3;
        for (var i = 0; i < remaining; i++) v.open(function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            if (!--remaining) done();
        });
    });
    it('should get info', function(done) {
        new Vector({ backend: new Testsource(), xml: xml.a }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.getInfo(function(err, info) {
                assert.ifError(err);
                assert.equal('test-a', info.name);
                assert.equal(0, info.minzoom);
                assert.equal(20, info.maxzoom);
                assert.deepEqual([0,20,4], info.center);
                assert.deepEqual([-180,-85.0511,180,85.0511], info.bounds);
                done();
            });
        });
    });
    it('should update xml', function(done) {
        new Vector({ backend: new Testsource(), xml: xml.a }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.getInfo(function(err, info) {
                assert.ifError(err);
                assert.equal('test-a', info.name);
                source.update({xml:xml.b}, function(err) {
                    assert.ifError(err);
                    source.getInfo(function(err, info) {
                        assert.ifError(err);
                        assert.equal('test-b', info.name);
                        done();
                    });
                });
            });
        });
    });
    it('should update backend', function(done) {
        new Vector({ backend: new Testsource('a'), xml: xml.a }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal('a',source._backend.uri);
            source.update({backend: new Testsource('b')}, function(err) {
                assert.ifError(err);
                assert.equal('b',source._backend.uri);
                done();
            });
        });
    });
});


