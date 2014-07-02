var test = require('tape');
var tilelive = require('tilelive');
var TileJSON = require('tilejson');
var url = require('url');
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var Vector = require('..');

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

// Load fixture data.
var fixtureDir = path.resolve(__dirname, 'fixtures', 'tm2z'),
    remotePath = 'http://mapbox.s3.amazonaws.com/tilelive-vector/test-tm2z.tm2z',
    xml = fs.readFileSync(path.join(fixtureDir, 'project', 'project.xml'), 'utf8');

// Register vector:, tm2z:, tm2z+http: and mapbox: tilelive protocols
Vector.registerProtocols(tilelive);
tilelive.protocols['mapbox:'] = function Source(uri, callback) {
    return new TileJSON('http://a.tiles.mapbox.com/v3' + uri.pathname + '.json', callback);
};

// Register font
Vector.mapnik.register_fonts(path.join(__dirname, 'fonts', 'source-sans-pro'));

test('exposes the mapnik binding', function(t) {
    t.ok(Vector.mapnik);
    t.end();
});
test('loads a tm2z url', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'project.tm2z'), function(err, source) {
        t.ifError(err);
        t.end();
    });
});
test('matches expected xml', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'project.tm2z'), function(err, source) {
        t.ifError(err);
        t.equal(source._xml, xml);
        t.end();
    });
});
test('gunzips then untars', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'project.tar.gz'), function(err, source) {
        t.ifError(err);
        t.end();
    });
});
test('errors out if not gzipped', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'project.tar'), function(err, source) {
        t.equal(err.code, 'Z_DATA_ERROR');
        t.equal(err.message, 'incorrect header check');
        t.end();
    });
});
test('errors out on bad gunzip', function(t) {
   tilelive.load('tm2z://' + path.join(fixtureDir, 'doublezip.tm2z'), function(err, source) {
        t.equal(err.message, 'invalid tar file');
        t.end();
    });
});
test('errors out if file size exceeds max size', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'filesize.tm2z'), function(err, source) {
        t.equal(err instanceof RangeError, true);
        t.equal(err.message, 'Upload size should not exceed 750KB.');
        t.end();
    });
});
test('errors out if file size exceeds custom max size', function(t) {
    tilelive.load({
        protocol: 'tm2z:',
        pathname: path.join(fixtureDir, 'filesize.tm2z'),
        filesize: 500 * 1024
    }, function(err, source) {
        t.equal(err instanceof RangeError, true);
        t.equal(err.message, 'Upload size should not exceed 500KB.');
        t.end();
    });
});
test('errors out if unzipped size exceeds max size', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'gunzipsize.tm2z'), function(err, source) {
        t.equal(err instanceof RangeError, true);
        t.equal(err.message, 'Unzipped size should not exceed 5MB.');
        t.end();
    });
});
test('errors out if unzipped size exceeds custom max size', function(t) {
    tilelive.load({
        protocol: 'tm2z:',
        pathname: path.join(fixtureDir, 'gunzipsize.tm2z'),
        gunzipsize: 1024 * 1024
    }, function(err, source) {
        t.equal(err instanceof RangeError, true);
        t.equal(err.message, 'Unzipped size should not exceed 1MB.');
        t.end();
    });
});
test('errors out if unzipped project.xml size exceeds max size', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'xmlsize.tm2z'), function(err, source) {
        t.equal(err instanceof RangeError, true);
        t.equal(err.message, 'Unzipped project.xml size should not exceed 750KB.');
        t.end();
    });
});
test('errors out if unzipped project.xml size exceeds custom max size', function(t) {
    tilelive.load({
        protocol: 'tm2z:',
        pathname: path.join(fixtureDir, 'xmlsize.tm2z'),
        xmlsize: 300 * 1024
    }, function(err, source) {
        t.equal(err instanceof RangeError, true);
        t.equal(err.message, 'Unzipped project.xml size should not exceed 300KB.');
        t.end();
    });
});
test('errors out if not a directory', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'nodirectory.tm2z'), function(err, source) {
        t.equal(err.message.split(',')[0], 'EISDIR');
        t.end();
    });
});
test('errors out if missing project.xml', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'empty.tm2z'), function(err, source) {
        t.equal(err.message, 'project.xml not found in package');
        t.end();
    });
});
test('errors out on invalid project.xml', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'malformed.tm2z'), function(err, source) {
        t.equal('EMAPNIK', err.code);
        // err.message on windows is completely different
        //assert(err.message.split(':')[0], 'expected < at line 1');
        t.end();
    });
});
test('errors out if style references a missing font', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'missing_font.tm2z'), function(err, source) {
        t.equal('EMAPNIK', err.code);
        t.equal(err.message.split("'")[0], 'Failed to find font face ');
        t.end();
    });
});
test('does not error out if style references a registered font', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'project.tm2z'), function(err, source) {
        t.ifError(err);
        t.end();
    });
});
test('errors out if style references a missing image', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'missing_image.tm2z'), function(err, source) {
        t.equal('EMAPNIK', err.code);
        t.equal(err.message.split(':')[0], 'file could not be found');
        t.end();
    });
});
test('profiles a tm2z file', function(t) {
    tilelive.load('tm2z://' + path.join(fixtureDir, 'project.tm2z'), function(err, source) {
        t.ifError(err);
        source.profile(function(err, profile) {
            t.ifError(err);
            t.deepEqual([
                'tiles',
                'xmltime',
                'drawtime',
                'loadtime',
                'srcbytes',
                'imgbytes'
            ], Object.keys(profile));
            t.equal('number', typeof profile.xmltime);
            t.deepEqual(['avg','min','max'], Object.keys(profile.drawtime));
            t.deepEqual(['avg','min','max'], Object.keys(profile.loadtime));
            t.deepEqual(['avg','min','max'], Object.keys(profile.srcbytes));
            t.deepEqual(['avg','min','max'], Object.keys(profile.imgbytes));
            t.deepEqual([
                '0/0/0',
                '1/1/0',
                '2/2/1',
                '3/4/3',
                '4/9/7',
                '5/19/14',
                '6/39/29',
                '7/79/58',
                '8/159/117',
                '9/319/235',
                '10/638/470',
                '11/1276/940',
                '12/2553/1880',
                '13/5106/3761',
                '14/10212/7522',
                '15/20424/15045',
                '16/40849/30091',
                '17/81699/60182',
                '18/163398/120364',
                '19/326797/240728',
                '20/653594/481456',
                '21/1307188/962913',
                '22/2614376/1925826'
            ], profile.tiles.map(function(t) { return t.z + '/' + t.x + '/' + t.y }));
            t.end();
        });
    });
});

test('loads a tm2z+http url', function(t) {
    tilelive.load('tm2z+' + remotePath, function(err, source) {
        t.ifError(err);
        t.end();
    });
});
test('matches expected xml', function(t) {
    tilelive.load('tm2z+' + remotePath, function(err, source) {
        t.ifError(err);
        t.equal(xml, source._xml);
        t.end();
    });
});
test('errors out on an invalid S3 url', function(t) {
    tilelive.load('tm2z+http://mapbox.s3.amazonaws.com/tilelive-vector/invalid.tm2z', function(err, source) {
        t.equal('Z_DATA_ERROR', err.code);
        t.end();
    });
});

