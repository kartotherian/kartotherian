var tilelive = require('tilelive');
var url = require('url');
var zlib = require('zlib');
var assert = require('assert');
var Backend = require('..').Backend;
var mapnik = require('..').mapnik;
var path = require('path');
var fs = require('fs');
var Testsource = require('./testsource');
var UPDATE = process.env.UPDATE;

// Tilelive test source.
tilelive.protocols['test:'] = Testsource;

describe('backend', function() {
    it('invalid', function(done) {
        new Backend({}, function(err) {
            assert.equal('Error: opts.uri or opts.source must be set', err.toString());
            done();
        });
    });
    it('async default opts', function(done) {
        new Backend({ uri:'test:///a' }, function(err, source) {
            assert.ifError(err);
            assert.equal(1, source._scale);
            assert.equal(0, source._minzoom);
            assert.equal(1, source._maxzoom);
            assert.equal(undefined, source._maskLevel);
            done();
        });
    });
    it('sync default opts', function(done) {
        var source = new Backend({ source: new Testsource('a') });
        assert.equal(1, source._scale);
        assert.equal(0, source._minzoom);
        assert.equal(22, source._maxzoom);
        assert.equal(undefined, source._maskLevel);

        source = new Backend({
            source: new Testsource('a'),
            minzoom: 2,
            maxzoom: 22,
            maskLevel: 4
        });
        assert.equal(1, source._scale);
        assert.equal(2, source._minzoom);
        assert.equal(22, source._maxzoom);
        assert.equal(4, source._maskLevel);
        done();
    });
    it('proxies getInfo', function(done) {
        var source = new Testsource('a');
        var wrapped = new Backend({
            source: source,
            minzoom: 0,
            maxzoom: 1
        });
        source.getInfo(function(err, a) {
            assert.ifError(err);
            wrapped.getInfo(function(err, b) {
                assert.ifError(err);
                assert.deepEqual(a, b);
                done();
            });
        });
    });
});

describe('tiles', function() {
    var sources = {
        a: new Backend({ source: new Testsource('a'), minzoom:0, maxzoom: 1 }),
        b: new Backend({ source: new Testsource('b'), minzoom:0, maxzoom: 2, maskLevel: 1 }),
        c: new Backend({ source: new Testsource('b'), minzoom:0, maxzoom: 2, maskLevel: 1, scale: 2, legacy: true }),
        h: new Backend({ source: new Testsource('b'), minzoom:0, maxzoom: 2, maskLevel: 1, scale: 2 }),
        i: new Backend({ source: new Testsource('i'), minzoom:0, maxzoom: 1 })
    };
    sources.d = new Backend({ source: sources.a, minzoom:0, maxzoom:1 });
    var tests = {
        // 2.0.0, 2.0.1 test overzooming.
        // 1.1.2, 1.1.3 test that solid bg tiles are generated even when no
        // backend tile exists.
        // 0.0.1 test that solid bg tiles are generated for 0-length protobufs.
        a: ['0.0.0', '0.0.1', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '1.1.2', '1.1.3', '2.0.0', '2.0.1'],
        // 2.1.1 should use z2 vector tile -- a coastline shapefile
        // 2.1.2 should use maskLevel -- place dots, like the others
        b: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.1.1', '2.1.2'],
        // test the a legacy flag overriding the scale factor of the request affecting the output tile size
        c: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.1.1', '2.1.2', '3.2.2', '3.2.3', '3.2.4'],
        // proxies through vector tiles (rather than PBFs) from a source.
        d: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '1.1.2', '1.1.3', '2.0.0', '2.0.1'],
        // test the scale factor of the request affecting the output tile size
        h: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.1.1', '2.1.2', '3.2.2', '3.2.3', '3.2.4'],
        // wraps image source with vector tiles.
        i: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.0.0', '2.0.1'],
    };
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(key) {
            var z = key.split('.')[0] | 0;
            var x = key.split('.')[1] | 0;
            var y = key.split('.')[2] | 0;
            var remaining = 2;
            it('should render ' + source + ' (' + key + ')', function(done) {
                var cbTile = function(err, vtile, headers) {
                    assert.ifError(err);
                    // Returns a vector tile.
                    assert.ok(vtile instanceof mapnik.VectorTile);
                    // No backend tiles last modified defaults to Date 0.
                    // Otherwise, Last-Modified from backend should be passed.
                    if (['1.1.2','1.1.3'].indexOf(key) >= 0 || (source == 'i' && ['2.0.0','2.0.1'].indexOf(key) >= 0)) {
                        assert.equal(headers['Last-Modified'], new Date(0).toUTCString());
                    } else {
                        assert.equal(headers['Last-Modified'], Testsource.now.toUTCString());
                    }
                    // Check for presence of ETag and store away for later
                    // ETag comparison.
                    assert.ok('ETag' in headers);
                    // Content-Type.
                    assert.equal(headers['Content-Type'], 'application/x-protobuf');
                    // Size stats attached to buffer.
                    assert.equal('number', typeof vtile._srcbytes);
                    // Compare vtile contents to expected fixtures.
                    // if source is c, test legacy scale factor
                    // at zoom > 1 it will compare with data at previous zoom level.
                    if (source === 'c') {
                        if (key[0] > 1) {
                            key[0] -= 1;
                            var fixtpath = __dirname + '/expected/backend-' + source + '.' + key + '.json';
                            if (UPDATE) fs.writeFileSync(fixtpath, JSON.stringify(vtile.toJSON(), null, 2));
                            assert.deepEqual(
                                JSON.parse(JSON.stringify(vtile.toJSON())),
                                JSON.parse(fs.readFileSync(fixtpath))
                            );
                        }
                    } else {
                        var fixtpath = __dirname + '/expected/backend-' + source + '.' + key + '.json';
                        if (UPDATE) fs.writeFileSync(fixtpath, JSON.stringify(vtile.toJSON(), null, 2));
                        assert.deepEqual(
                            JSON.parse(JSON.stringify(vtile.toJSON())),
                            JSON.parse(fs.readFileSync(fixtpath))
                        );
                    }
                    done();
                };
                if (source === 'c') {
                    cbTile.legacy = true;
                }
                sources[source].getTile(z,x,y, cbTile);
            });
        });
    });
    it('empty tile on bad deflate', function(done) {
        sources.a.getTile(1, 0, 2, function(err, vtile) {
            assert.ifError(err);
            assert.deepEqual([], vtile.toJSON());
            done();
        });
    });
    it('errors out on bad protobuf', function(done) {
        sources.a.getTile(1, 0, 3, function(err, vtile) {
            assert.equal('could not parse buffer as protobuf', err.message);
            done();
        });
    });
});

