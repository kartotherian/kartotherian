var test = require('tape');
var tilelive = require('tilelive');
var imageEqualsFile = require('./image.js');
var Testsource = require('./testsource');
var xray = require('..').xray;
var fs = require('fs');
var UPDATE = process.env.UPDATE;
var path = require('path');

// Tilelive test source.
tilelive.protocols['test:'] = Testsource;

test('invalid', function(t) {
    new xray({}, function(err) {
        t.equal('Error: opts.uri or opts.source must be set', err.toString());
        t.end();
    });
});
test('invalid-novector', function(t) {
    new xray({uri:'test:///invalid-novector'}, function(err) {
        t.equal('Error: source must contain a vector_layers property', err.toString());
        t.end();
    });
});
test('loads uri', function(t) {
    new xray({uri:'test:///a'}, function(err, source) {
        t.ifError(err);
        t.ok(!!source);
        source.getTile(0,0,0, function(err,buffer) {
            t.ifError(err);
            if (UPDATE) {
                fs.writeFileSync(path.join(__dirname, 'expected', 'xray-a-0-0-0.png'), buffer);
            }
            imageEqualsFile(buffer, path.join(__dirname, 'expected', 'xray-a-0-0-0.png'), function(err) {
                t.ifError(err);
                t.end();
            });
        });
    });
});
test('loads source', function(t) {
    var source = new Testsource('a');
    new xray({
        source: source,
        minzoom: 0,
        maxzoom: 1,
        vector_layers: [{ id:'coastline' }]
    }, function(err, source) {
        t.ifError(err);
        t.ok(!!source);
        t.end();
    });
});
test('loads raster source', function(t) {
    new xray({uri:'test:///i'}, function(err, source) {
        t.ifError(err);
        t.ok(!!source);
        source.getTile(0,0,0, function(err,buffer) {
            t.ifError(err);
            if (UPDATE) {
                fs.writeFileSync(__dirname + '/expected/xray-i-0-0-0.png', buffer);
            }
            imageEqualsFile(buffer, __dirname + '/expected/xray-i-0-0-0.png', function(err) {
                t.ifError(err);
                t.end();
            });
        });
    });
});
test('color', function(t) {
    var results = {
        '': [68,68,68],
        'a': [68,170,68],
        'ab': [68,170,85],
        'world': [136,221,102],
        'rivers and lakes': [170,153,85]
    };
    for (var key in results) {
        t.deepEqual(xray.color(key), results[key]);
    }
    t.end();
});
test('xml', function(t) {
    var results = {
        'xray-single.xml': xray.xml({
            vector_layers: [
                { "id": "coastline" }
            ]
        }),
        'xray-multi.xml': xray.xml({
            vector_layers: [
                { "id": "coastline" },
                { "id": "countries" },
                { "id": "water" },
                { "id": "landuse" }
            ]
        })
    };
    for (var key in results) {
        if (UPDATE) {
            fs.writeFileSync(path.join(__dirname, 'expected', key), results[key]);
        }
        var expected = fs.readFileSync(path.join(__dirname, 'expected', key), 'utf8');
        t.equal(expected, results[key]);
    }
    t.end();
});
