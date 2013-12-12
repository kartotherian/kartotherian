var tilelive = require('tilelive');
var TileJSON = require('tilejson');
var url = require('url');
var tar = require('tar');
var fstream = require('fstream');
var zlib = require('zlib');
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');
var crypto = require('crypto');
// var imageEqualsFile = require('./image.js');

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

function pack(source, callback) {
    var tarPath = source + '.tar';
    var writer = fstream.Writer({ path: tarPath, type: 'File' });
    var reader = fstream.Reader({
            path: path.dirname(source),
            type: 'Directory',
            filter: function(info) {
                if (info.props.basename.toLowerCase() === 'project.xml') return true;
            }
        })
        .pipe(tar.Pack({ noProprietary: true }))
        .pipe(writer);
    reader.on('error', callback);
    writer.on('error', callback);
    writer.on('end', function() {
        callback(null, tarPath);
    });
}

function gzip(path, callback) {
    var gzPath = path + '.gz';
    fs.createReadStream(path)
        .pipe(zlib.createGzip())
        .pipe(fs.createWriteStream(gzPath))
        .on('close', function() {
            callback(null, gzPath);
        })
        .on('error', callback);
}

// Load fixture data.
var localPath = path.resolve(__dirname + '/fixtures/tm2z/test.tm2z'),
    remotePath = 'http://mapbox.s3.amazonaws.com/tilelive-vector/test-tm2z.tm2z',
    xml = fs.readFileSync(__dirname + '/fixtures/tm2z/project.xml');

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
        tilelive.load('tm2z://' + localPath, function(err, source) {
            if (err) throw err;
            done();
        });
    });
    it('matches expected xml', function(done) {
        tilelive.load('tm2z://' + localPath, function(err, source) {
            if (err) throw err;
            assert.equal(xml, source._xml);
            done();
        });
    });
    it('errors out if not gzipped', function(done) {
        var dirpath = '/tmp/tilelive-vector/';
        mkdirp(dirpath);
        var path = dirpath + md5(xml);
        fs.writeFile(path, xml, function(err) {
            if (err) throw err;
            pack(path, function(err, tarPath) {
                if (err) throw err;
                tilelive.load('tm2z://' + tarPath, function(err, source) {
                    assert.equal('Z_DATA_ERROR', err.code);
                    done();
                });
            });
        });
    });
    it('errors out if not packed with tar', function(done) {
        var dirpath = '/tmp/tilelive-vector/';
        mkdirp(dirpath);
        var path = dirpath + md5(xml);
        fs.writeFile(path, xml, function(err) {
            if (err) throw err;
            gzip(path, function(err, gzPath) {
                if (err) throw err;
                tilelive.load('tm2z://' + gzPath, function(err, source) {
                    assert.equal('invalid tar file', err.message);
                    done();
                });
            });
        });
    });
    it('errors out if gzipped before tar', function(done) {
        var dirpath = '/tmp/tilelive-vector/';
        mkdirp(dirpath);
        var path = dirpath + md5(xml);
        fs.writeFile(path, xml, function(err) {
            if (err) throw err;
            gzip(path, function(err, gzPath) {
                if (err) throw err;
                pack(gzPath, function(err, tarPath) {
                    if (err) throw err;
                    tilelive.load('tm2z://' + tarPath, function(err, source) {
                        assert.equal('Z_DATA_ERROR', err.code);
                        done();
                    });
                });
            });
        });
    });
    it('gunzips then untars', function(done) {
        var dirpath = '/tmp/tilelive-vector/';
        mkdirp(dirpath);
        var path = dirpath + 'project.xml';
        fs.writeFile(path, xml, function(err) {
            if (err) throw err;
            pack(path, function(err, tarPath) {
                if (err) throw err;
                gzip(tarPath, function(err, gzPath) {
                    if (err) throw err;
                    tilelive.load('tm2z://' + gzPath, function(err, source) {
                        if (err) throw err;
                        done();
                    });
                });
            });
        });
    });
    /*
    it('errors out on bad deflate', function(done) {
        zlib.deflate(new Buffer('asdf'), function(err, deflated) {
            if (err) throw err;
            sources.a.getTile(1, 0, 2, function(err) {
                assert.equal('Z_DATA_ERROR', err.code);
                done();
            });
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
