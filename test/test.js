var test = require('tape');
var tilelive = require('tilelive');
var url = require('url');
var zlib = require('zlib');
var Vector = require('..');
var path = require('path');
var fs = require('fs');
var imageEqualsFile = require('./image.js');
var Testsource = require('./testsource');
var UPDATE = process.env.UPDATE;

// Tilelive test source.
tilelive.protocols['test:'] = Testsource;

var xml = {
    a: fs.readFileSync(path.resolve(__dirname + '/fixtures/a.xml'), 'utf8'),
    b: fs.readFileSync(path.resolve(__dirname + '/fixtures/b.xml'), 'utf8'),
    c: fs.readFileSync(path.resolve(__dirname + '/fixtures/c.xml'), 'utf8'),
    i: fs.readFileSync(path.resolve(__dirname + '/fixtures/i.xml'), 'utf8')
};

test('should fail without backend', function(t) {
    new Vector({ xml: xml.c }, function(err) {
        t.equal(err.message, 'No backend');
        t.end();
    });
});
test('should fail without xml', function(t) {
    new Vector({ backend: new Testsource() }, function(err) {
        t.equal(err.message, 'No xml');
        t.end();
    });
});
test('should load with callback', function(t) {
    new Vector({ backend: new Testsource(), xml: xml.a }, function(err, source) {
        t.ifError(err);
        t.ok(source);
        t.end();
    });
});
test('#open should call all listeners', function(t) {
    var v = new Vector({ backend: new Testsource(), xml: xml.a });
    var remaining = 3;
    for (var i = 0; i < remaining; i++) v.open(function(err, source) {
        t.ifError(err);
        t.ok(source);
        if (!--remaining) t.end();
    });
});
test('should get info', function(t) {
    new Vector({ backend: new Testsource(), xml: xml.a }, function(err, source) {
        t.ifError(err);
        t.ok(source);
        source.getInfo(function(err, info) {
            t.ifError(err);
            t.equal('test-a', info.name);
            t.equal(0, info.minzoom);
            t.equal(8, info.maxzoom);
            t.deepEqual([0,0,2], info.center);
            t.deepEqual([-180,-85.0511,180,85.0511], info.bounds);
            t.deepEqual({"level2":"property"}, info.level1, 'JSON key stores deep attribute data');
            t.deepEqual('1', info.scale, 'JSON key does not overwrite other params');
            t.end();
        });
    });
});
test('should update xml, backend', function(t) {
    new Vector({xml:xml.a}, function(err, source) {
        t.ifError(err);
        source.getInfo(function(err, info) {
            t.ifError(err);
            t.equal('test-a', info.name);
            source.update({xml:xml.b}, function(err) {
                t.ifError(err);
                source.getInfo(function(err, info) {
                    t.ifError(err);
                    t.equal('test-b', info.name);
                    t.end();
                });
            });
        });
    });
});
test('should use fallback backend', function(t) {
    new Vector({ source:'test:///a', xml: xml.c }, function(err, source) {
        t.ifError(err);
        t.ok(source);
        t.end();
    });
});

var sources = {
    a: new Vector({ backend: new Testsource('a'), xml: xml.a }),
    'a@vt': new Vector({ backend: new Vector.Backend('test:///a'), xml: xml.a }),
    b: new Vector({ backend: new Testsource('b'), xml: xml.b }),
    'b@2x': new Vector({ backend: new Testsource('b'), xml: xml.b }),
    c: new Vector({ backend: new Testsource('b'), xml: xml.b, scale: 2 }),
    d: new Vector({ backend: new Testsource('a'), xml: xml.a }),
    e: new Vector({ backend: new Testsource('a'), xml: xml.a, format:'png8:c=2' }),
    f: new Vector({ backend: new Testsource('a'), xml: xml.a.replace('png8:m=h', 'png8:c=2') }),
    g: new Vector({ backend: new Testsource('a'), xml: xml.a.replace('"scale">1', '"scale">2') }),
    h: new Vector({ backend: new Testsource('b'), xml: xml.b, scale: 2 }),
    i: new Vector({ backend: new Testsource('i'), xml: xml.i }),
    'i@2x': new Vector({ backend: new Testsource('i'), xml: xml.i })
};
var tests = {
    // 2.0.0, 2.0.1 test overzooming.
    // 1.1.2, 1.1.3 test that solid bg tiles are generated even when no
    // backend tile exists.
    a: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '1.1.2', '1.1.3', '2.0.0', '2.0.1'],
    'a@vt': ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '1.1.2', '1.1.3', '2.0.0', '2.0.1'],
    // 2.1.1 should use z2 vector tile -- a coastline shapefile
    // 2.1.2 should use maskLevel -- place dots, like the others
    b: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.1.1', '2.1.2'],
    // test legacy scale factor which holds 256x256 tile size constant.
    c: ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.1.1', '2.1.2', '3.2.2', '3.2.3', '3.2.4'],
    // should match results for 'h' which has a 2x factor map object.
    'b@2x': ['0.0.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.1.1', '2.1.2', '3.2.2', '3.2.3', '3.2.4'],
    // Checks for ETag stability.
    d: ['0.0.0', '1.0.0', '1.0.1', '1.1.0'],
    // Checks that explicit format in source URI overrides map parameters.
    e: ['0.0.0'],
    // Checks that format in map parameters beats default code fallback.
    f: ['0.0.0'],
    // Checks that scale in map parameters beats default code fallback.
    g: ['0.0.0'],
    // Image sources.
    i: ['0.0.0', '1.0.0'],
    // Image sources.
    'i@2x': ['0.0.0', '1.0.0']
};
var formats = {
    json: { ctype: 'application/json' },
    jpeg: { ctype: 'image/jpeg' },
    png: { ctype: 'image/png' },
    svg: { ctype: 'image/svg+xml', renderer: 'cairo' },
    svg: { ctype: 'image/svg+xml', renderer: 'svg' },
    utf: { ctype: 'application/json' }
};
var etags = {};
Object.keys(tests).forEach(function(source) {
    tests[source].forEach(function(key) {
        var z = key.split('.')[0] | 0;
        var x = key.split('.')[1] | 0;
        var y = key.split('.')[2] | 0;
        var remaining = 2;
        test('should render ' + source + ' (' + key + ')', function(t) {
            var cbTile = function(err, buffer, headers) {
                t.ifError(err);
                // No backend tiles last modified defaults to Date 0.
                // Otherwise, Last-Modified from backend should be passed.
                if (['1.1.2','1.1.3'].indexOf(key) >= 0) {
                    t.equal(headers['Last-Modified'], new Date(0).toUTCString());
                } else {
                    t.equal(headers['Last-Modified'], Testsource.now.toUTCString());
                }
                // Check for presence of ETag and store away for later
                // ETag comparison.
                t.ok('ETag' in headers);
                etags[source] = etags[source] || {};
                etags[source][key] = headers['ETag'];
                // Content-Type.
                t.equal(headers['Content-Type'], 'image/png');
                // Load/draw stats attached to buffer.
                t.equal('number', typeof buffer._loadtime);
                t.equal('number', typeof buffer._drawtime);
                if (UPDATE) {
                    fs.writeFileSync(__dirname + '/expected/' + source + '.' + key + '.png', buffer);
                }
                imageEqualsFile(buffer, __dirname + '/expected/' + source + '.' + key + '.png', function(err) {
                    t.ifError(err);
                    if (!--remaining) t.end();
                });
            };
            var cbHead = function(err, headers) {
                t.ifError(err);
                // No backend tiles last modified defaults to Date 0.
                // Otherwise, Last-Modified from backend should be passed.
                if (['1.1.2','1.1.3'].indexOf(key) >= 0) {
                    t.equal(headers['Last-Modified'], new Date(0).toUTCString());
                } else {
                    t.equal(headers['Last-Modified'], Testsource.now.toUTCString());
                }
                // Content-Type.
                t.equal(undefined, headers['Content-Type']);
                if (!--remaining) t.end();
            };
            if (/\@2x/.test(source)) {
                cbTile.scale = 2;
                cbHead.scale = 2;
            }
            if (source === 'c') {
                cbTile.legacy = true;
                cbHead.legacy = true;
            }
            sources[source].getTile(z,x,y, cbTile);
            sources[source].getHeaders(z,x,y, cbHead);
        });
    });
});
Object.keys(formats).forEach(function(format) {
    test('format a (0.0.0) as ' + format, function(t) {
        var source = 'a';
        var key = '0.0.0';
        var filepath = __dirname + '/expected/' + source + '.' + key + '.' + format;
        var cbTile = function(err, buffer, headers) {
            t.ifError(err);
            t.equal(headers['Content-Type'], formats[format].ctype);
            if (format === 'utf' || format === 'json') {
                if (UPDATE) {
                    fs.writeFileSync(filepath, JSON.stringify(buffer, null, 2));
                }
                t.deepEqual(buffer, JSON.parse(fs.readFileSync(filepath, 'utf8')));
                t.end();
            } else if (format === 'svg') {
                filepath = filepath.replace(key,key+'-'+formats[format].renderer);
                if (UPDATE) {
                    fs.writeFileSync(filepath, buffer);
                }
                t.equal(buffer.length, fs.readFileSync(filepath).length);
                t.end();
            } else {
                if (UPDATE) {
                    fs.writeFileSync(filepath, buffer);
                }
                imageEqualsFile(buffer, filepath, function(err) {
                    t.ifError(err);
                    t.end();
                });
            }
        };
        cbTile.format = format;
        if (format == 'png') cbTile.format = 'png8:m=h';
        if (formats[format].renderer) {
            cbTile.renderer = formats[format].renderer;
        }
        sources[source].getTile(0,0,0, cbTile);
    });
});
test('query', function(t) {
    var lonlat = [-77.0131, 38.8829];
    var filepath = __dirname + '/expected/query-' + lonlat.join(',') + '.json';
    sources.a.queryTile(22, lonlat[0], lonlat[1], { tolerance: 10000 }, function(err, data, headers) {
        t.ifError(err);
        t.equal(headers['Content-Type'], 'application/json');
        if (UPDATE) {
            fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        }
        t.deepEqual(
            JSON.parse(JSON.stringify(data)),
            JSON.parse(fs.readFileSync(filepath, 'utf8'))
        );
        t.end();
    });
});
test('errors out on bad deflate', function(t) {
    sources.a.getTile(1, 0, 2, function(err) {
        t.equal('image_reader: can\'t determine type from input data', err.message);
        t.end();
    });
});
test('errors out on bad protobuf', function(t) {
    sources.a.getTile(1, 0, 3, function(err) {
        t.equal('could not parse buffer as protobuf', err.message);
        t.end();
    });
});
test('same backend/xml => same ETags', function(t) {
    tests.a.slice(0,4).forEach(function(key) {
        t.equal(etags.a[key], etags.d[key]);
    });
    t.end();    });
test('diff blank tiles => diff ETags', function(t) {
    t.notEqual(etags.a['1.1.2'], etags.a['1.1.3']);
    t.end();
});
test('diff backend => diff ETags', function(t) {
    tests.a.slice(0,4).forEach(function(key) {
        t.notEqual(etags.a[key], etags.b[key]);
    });
    t.end();
});
test('diff scale => diff ETags', function(t) {
    tests.a.slice(0,4).forEach(function(key) {
        t.notEqual(etags.b[key], etags.c[key]);
    });
    t.end();
});
