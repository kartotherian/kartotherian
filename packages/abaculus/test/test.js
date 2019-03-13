var assert = require('assert');
var printer = require('../');
var fs = require('fs');
var path = require('path');
var mapnik = require('mapnik');

// defaults
var zoom = 5,
    scale = 4,
    x = 4096,
    y = 4096,
    quality = 256,
    format = 'png',
    limit = 19008;


// fixtures
var tiles = fs.readdirSync(path.resolve(__dirname + '/fixtures/')).reduce(function(memo, basename) {
    var key = basename.split('.').slice(0, 4).join('.');
    memo[key] = fs.readFileSync(path.resolve(__dirname + '/fixtures/' + basename));
    return memo;
}, {});

describe('Get center from bbox', function() {
    it('should fail if (x1, y1) and (x2,y2) are equal', function() {
        var bbox = [0, 0, 0, 0];

        assert.throws( function() {
            printer.coordsFromBbox(zoom, scale, bbox, limit);
        }, /Incorrect coordinates/);
    });
    it('should fail if the image is too large', function() {
        var bbox = [-60, -60, 60, 60];

        assert.throws( function() {
            printer.coordsFromBbox(7, 2, bbox, limit);
        }, /Desired image is too large./);
    });
    it('should return the correct coordinates', function() {
        var bbox = [-60, -60, 60, 60];

        var center = printer.coordsFromBbox(zoom, scale, bbox, limit);
        assert.deepEqual(center.w, 10920);
        assert.deepEqual(center.h, 13736);
        assert.deepEqual(center.x, x);
        assert.deepEqual(center.y, y);
    });
});

describe('get coordinates from center', function() {
    it('should should fail if the image is too large', function() {
        var center = {
            x: 0,
            y: 0,
            w: 4752,
            h: 4752
        };
        assert.throws( function() {
            printer.coordsFromCenter(zoom, scale, center, limit);
        }, /Desired image is too large./);
    });
    it('should return correct origin coords', function() {
        var center = {
            x: 0,
            y: 20,
            w: 800,
            h: 800
        };
        center = printer.coordsFromCenter(zoom, scale, center, limit);
        assert.equal(center.x, x);
        assert.equal(center.y, 3631);
    });
    it('should return correct origin coords for negative y', function() {
        var zoom = 2,
            center = {
                x: 39,
                y: -14,
                w: 1000,
                h: 1000
            };
        center = printer.coordsFromCenter(zoom, scale, center, limit);
        assert.equal(center.x, 623);
        assert.equal(center.y, 552);
    });
});

describe('create list of tile coordinates', function() {
    it('should return a tiles object with correct coords', function() {
        var zoom = 5,
            scale = 4,
            width = 250,
            height = 250,
            center = printer.coordsFromCenter(zoom, scale, { x: -47.368, y: -24.405, w: width, h: height }, limit, 256);

        var expectedCoords = {
            tiles: [
                { z: zoom, x: 11, y: 17, px: -308, py: -768 },
                { z: zoom, x: 11, y: 18, px: -308, py: 256 },
                { z: zoom, x: 12, y: 17, px: 716, py: -768 },
                { z: zoom, x: 12, y: 18, px: 716, py: 256 }
            ],
            dimensions: { x: Math.round(width*scale), y: Math.round(height*scale) },
            center: { row: 18, column: 11, zoom: zoom },
            scale: scale
        };
        var coords = printer.tileList(zoom, scale, center);
        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });

    it('should return a tiles object with correct coords when image exceeds y coords', function() {
        var zoom = 2,
            scale = 1,
            width = 1000,
            height = 1000,
            center = {x: 623, y: 552, w: width, h: height};

        var expectedCoords = {
            tiles: [
                { z: zoom, x: 0, y: 0, px: -123, py: -52 },
                { z: zoom, x: 0, y: 1, px: -123, py: 204 },
                { z: zoom, x: 0, y: 2, px: -123, py: 460 },
                { z: zoom, x: 0, y: 3, px: -123, py: 716 },
                { z: zoom, x: 1, y: 0, px:  133, py: -52 },
                { z: zoom, x: 1, y: 1, px:  133, py: 204 },
                { z: zoom, x: 1, y: 2, px:  133, py: 460 },
                { z: zoom, x: 1, y: 3, px:  133, py: 716 },
                { z: zoom, x: 2, y: 0, px:  389, py: -52 },
                { z: zoom, x: 2, y: 1, px:  389, py: 204 },
                { z: zoom, x: 2, y: 2, px:  389, py: 460 },
                { z: zoom, x: 2, y: 3, px:  389, py: 716 },
                { z: zoom, x: 3, y: 0, px:  645, py: -52 },
                { z: zoom, x: 3, y: 1, px:  645, py: 204 },
                { z: zoom, x: 3, y: 2, px:  645, py: 460 },
                { z: zoom, x: 3, y: 3, px:  645, py: 716 },
                { z: zoom, x: 0, y: 0, px:  901, py: -52 },
                { z: zoom, x: 0, y: 1, px:  901, py: 204 },
                { z: zoom, x: 0, y: 2, px:  901, py: 460 },
                { z: zoom, x: 0, y: 3, px:  901, py: 716 }
            ],
            dimensions: {x: width, y: height},
            center: {row: 2, column: 2, zoom: zoom},
            scale: scale
        };
        var coords = printer.tileList(zoom, scale, center);
        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });

    it('should return a tiles object with correct coords when image is much bigger than world', function() {
        var zoom = 1,
            scale = 1,
            width = 2000,
            height = 2100,
            center = {x: 100, y: 100, w: width, h: height};

        var expectedCoords = {
            tiles: [
                {z: zoom, x: 0, y: 0, px: -124, py: 950},
                {z: zoom, x: 0, y: 1, px: -124, py: 1206},
                {z: zoom, x: 1, y: 0, px: 132, py: 950},
                {z: zoom, x: 1, y: 1, px: 132, py: 1206},
                {z: zoom, x: 0, y: 0, px: 388, py: 950},
                {z: zoom, x: 0, y: 1, px: 388, py: 1206},
                {z: zoom, x: 1, y: 0, px: 644, py: 950},
                {z: zoom, x: 1, y: 1, px: 644, py: 1206},
                {z: zoom, x: 0, y: 0, px: 900, py: 950},
                {z: zoom, x: 0, y: 1, px: 900, py: 1206},
                {z: zoom, x: 1, y: 0, px: 1156, py: 950},
                {z: zoom, x: 1, y: 1, px: 1156, py: 1206},
                {z: zoom, x: 0, y: 0, px: 1412, py: 950},
                {z: zoom, x: 0, y: 1, px: 1412, py: 1206},
                {z: zoom, x: 1, y: 0, px: 1668, py: 950},
                {z: zoom, x: 1, y: 1, px: 1668, py: 1206},
                {z: zoom, x: 0, y: 0, px: 1924, py: 950},
                {z: zoom, x: 0, y: 1, px: 1924, py: 1206}
            ],
            dimensions: {x: width, y: height},
            center: {row: 0, column: 0, zoom: zoom},
            scale: scale
        };
        var coords = printer.tileList(zoom, scale, center);
        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });
});

[256, 512, 1024].forEach(function(size) {
    describe('stitch tiles into single png', function() {
        var expectedCoords = {
            tiles: [
                { z: 1, x: 0, y: 0, px: 0, py: 0 },
                { z: 1, x: 0, y: 1, px: 0, py: size },
                { z: 1, x: 1, y: 0, px: size, py: 0 },
                { z: 1, x: 1, y: 1, px: size, py: size }
            ],
            dimensions: {
                x: size * 2,
                y: size * 2
            },
            center: { row: 1, column: 1, zoom: 1 },
            scale: 1,
            tileSize: size
        };

        it('should fail if no coordinates object', function(done) {
            printer.stitchTiles(null, format, quality, function() {}, function(err) {
                assert.equal(err.message, 'No coords object.');
                done();
            });
        });

        it('should return tiles and stitch them together', function(done) {
            var expectedImage = fs.readFileSync(path.resolve(__dirname + '/expected/expected.' + size + '.png'));

            printer.stitchTiles(expectedCoords, format, quality, getTileTest, function(err, image, header) {
                fs.writeFile(__dirname + '/outputs/expected.' + size + '.png', image, function(err){
                    checkImage(image, expectedImage);
                    done();
                });
            });
        });
    });

    describe('run entire function', function() {
        it('stitches images with a center coordinate', function(done) {
            var expectedImage = fs.readFileSync(path.resolve(__dirname + '/expected/center.' + size + '.png'));

            var params = {
                zoom: 1,
                scale: 1,
                center: {
                    x: 0,
                    y: 0,
                    w: 200,
                    h: 200
                },
                format: 'png',
                quality: 50,
                tileSize: size,
                getTile: getTileTest
            };

            printer(params, function(err, image) {
                assert.equal(err, null);

                fs.writeFile(__dirname + '/outputs/center.' + size + '.png', image, function(err){
                    assert.equal(err, null);
                    console.log('\tVisually check image at '+ __dirname + '/outputs/center.' + size + '.png');

                    // byte by byte check of image:
                    checkImage(image, expectedImage);
                    done();
                });
            });
        });

        it('stitches images with a wsen bbox', function(done) {
            var expectedImage = fs.readFileSync(path.resolve(__dirname + '/expected/bbox.' + size + '.png'));

            var params = {
                zoom: 1,
                scale: 1,
                bbox: [-140, -80, 140, 80],
                format: 'png',
                quality: 50,
                tileSize: size,
                getTile: getTileTest
            };

            printer(params, function(err, image, headers) {
                assert.equal(err, null);
                fs.writeFile(__dirname + '/outputs/bbox.' + size + '.png', image, function(err){
                    assert.equal(err, null);
                    console.log('\tVisually check image at '+ __dirname + '/outputs/bbox.'+ size +'.png');

                    // byte by byte check of image:
                    checkImage(image, expectedImage);
                    done();
                });
            });
        })
    });

    // This approximates a tilelive's getTile function
    // (https://github.com/mapbox/tilelive-vector/blob/master/index.js#L119-L218)
    // by loading a series of local png tiles
    // and returning the tile requested with the x, y, & z,
    // parameters along with the appropriate headers
    function getTileTest(z, x, y, callback) {
        var key = [z, x, y, size].join('.');

        // Headers.
        var headers = {
            'Last-Modified': new Date().toUTCString(),
            'ETag':'73f12a518adef759138c142865287a18',
            'Content-Type':'application/x-protobuf'
        };

        if (!tiles[key]) {
            return callback(new Error('Tile does not exist'));
        } else {
            return callback(null, tiles[key], headers);
        }
    }

    function checkImage(actual, expected) {
        actual = new mapnik.Image.fromBytes(actual);
        expected = new mapnik.Image.fromBytes(expected);
        var max_diff_pixels = 0;
        var compare_alpha = true;
        var threshold = 16;
        var diff_pixels = actual.compare(expected, {
            threshold: threshold,
            alpha: compare_alpha
        });
        if (diff_pixels > max_diff_pixels) {
            expected.save('test/outputs/center.fail.png');
        }
        assert.equal(max_diff_pixels, diff_pixels);
    }

});
