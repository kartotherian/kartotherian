var SphericalMercator = require('@mapbox/sphericalmercator');
var queue = require('d3-queue').queue;
var blend = require('mapnik').blend;
var crypto = require('crypto');

module.exports = abaculus;

function abaculus(arg, callback) {
    var z = arg.zoom || 0,
        s = arg.scale || 1,
        center = arg.center || null,
        bbox = arg.bbox || null,
        getTile = arg.getTile || null,
        format = arg.format || 'png',
        quality = arg.quality || null,
        limit = arg.limit || 19008,
        tileSize = arg.tileSize || 256;

    if (!getTile) return callback(new Error('Invalid function for getting tiles'));

    if (center) {
        // get center coordinates in px from lng,lat
        center = abaculus.coordsFromCenter(z, s, center, limit, tileSize);
    } else if (bbox) {
        // get center coordinates in px from [w,s,e,n] bbox
        center = abaculus.coordsFromBbox(z, s, bbox, limit, tileSize);
    } else {
        return callback(new Error('No coordinates provided.'));
    }
    // generate list of tile coordinates center
    var coords = abaculus.tileList(z, s, center, tileSize);

    // get tiles based on coordinate list and stitch them together
    abaculus.stitchTiles(coords, format, quality, getTile, callback);
}

abaculus.coordsFromBbox = function(z, s, bbox, limit, tileSize) {
    var sm = new SphericalMercator({ size: tileSize * s });
    var topRight = sm.px([bbox[2], bbox[3]], z),
        bottomLeft = sm.px([bbox[0], bbox[1]], z);
    var center = {};
    center.w = topRight[0] - bottomLeft[0];
    center.h = bottomLeft[1] - topRight[1];

    if (center.w <= 0 || center.h <= 0) throw new Error('Incorrect coordinates');

    var origin = [topRight[0] - center.w / 2, topRight[1] + center.h / 2];
    center.x = origin[0];
    center.y = origin[1];
    center.w = Math.round(center.w * s);
    center.h = Math.round(center.h * s);

    if (center.w >= limit || center.h >= limit) throw new Error('Desired image is too large.');
    return center;
};

abaculus.coordsFromCenter = function(z, s, center, limit, tileSize) {
    var sm = new SphericalMercator({ size: tileSize * s });
    var origin = sm.px([center.x, center.y], z);
    center.x = origin[0];
    center.y = origin[1];
    center.w = Math.round(center.w * s);
    center.h = Math.round(center.h * s);

    if (center.w >= limit || center.h >= limit) throw new Error('Desired image is too large.');
    return center;
};

// Generate the zxy and px/py offsets needed for each tile in a static image.
// x, y are center coordinates in pixels
abaculus.tileList = function(z, s, center, tileSize) {
    var x = center.x,
        y = center.y,
        w = center.w,
        h = center.h;
    var dimensions = {x: w, y: h};
    var size = tileSize || 256;
    var ts = Math.floor(size * s);

    var centerCoordinate = {
        column: x / ts,
        row: y / ts,
        zoom: z
    };

    function pointCoordinate(point) {
        var coord = {
            column: centerCoordinate.column,
            row: centerCoordinate.row,
            zoom: centerCoordinate.zoom,
        };
        coord.column += (point.x - w / 2) / ts;
        coord.row += (point.y - h / 2) / ts;
        return coord;
    }

    function coordinatePoint(coord) {
        // Return an x, y point on the map image for a given coordinate.
        if (coord.zoom != z) coord = coord.zoomTo(z);
        return {
            x: w / 2 + ts * (coord.column - centerCoordinate.column),
            y: h / 2 + ts * (coord.row - centerCoordinate.row)
        };
    }

    function floorObj(obj) {
        return {
            row: Math.floor(obj.row),
            column: Math.floor(obj.column),
            zoom: obj.zoom
        };
    }

    var maxTilesInRow = Math.pow(2, z);
    var tl = floorObj(pointCoordinate({x: 0, y:0}));
    var br = floorObj(pointCoordinate(dimensions));
    var coords = {};
    coords.tiles = [];

    for (var column = tl.column; column <= br.column; column++) {
        for (var row = tl.row; row <= br.row; row++) {
            var c = {
                column: column,
                row: row,
                zoom: z,
            };
            var p = coordinatePoint(c);

            // Wrap tiles with negative coordinates.
            c.column = c.column % maxTilesInRow;
            if (c.column < 0) c.column = maxTilesInRow + c.column;

            if (c.row < 0 || c.row >= maxTilesInRow) continue;
            coords.tiles.push({
                z: c.zoom,
                x: c.column,
                y: c.row,
                px: Math.round(p.x),
                py: Math.round(p.y)
            });
        }
    }
    coords.dimensions = { x: w, y: h };
    coords.center = floorObj(centerCoordinate);
    coords.scale = s;

    return coords;
};

abaculus.stitchTiles = function(coords, format, quality, getTile, callback) {
    if (!coords) return callback(new Error('No coords object.'));
    var tileQueue = queue(32);
    var w = coords.dimensions.x,
        h = coords.dimensions.y,
        s = coords.scale,
        tiles = coords.tiles;

    tiles.forEach(function(t) {
        tileQueue.defer(function(z, x, y, px, py, done) {
            var cb = function(err, buffer, headers) {
                if (err) return done(err);
                done(err, {
                    buffer: buffer,
                    headers: headers,
                    x: px,
                    y: py,
                    reencode: true
                })
            };
            cb.scale = s;
            cb.format = format;
            // getTile is a function that returns
            // a tile given z, x, y, & callback
            getTile(z, x, y, cb);
        }, t.z, t.x, t.y, t.px, t.py);
    });

    function tileQueueFinish(err, data) {
        if (err) return callback(err);
        if (!data) return callback(new Error('No tiles to stitch.'));
        var headers = [];
        data.forEach(function(d) {
            headers.push(d.headers);
        });

        blend(data, {
            format: format,
            quality: quality,
            width: w,
            height: h,
            reencode: true
        }, function(err, buffer) {
            if (err) return callback(err);
            callback(null, buffer, headerReduce(headers, format));
        });
    }

    tileQueue.awaitAll(tileQueueFinish);
};

// Calculate TTL from newest (max mtime) layer.
function headerReduce(headers, format) {
    var minmtime = new Date('Sun, 23 Feb 2014 18:00:00 UTC');
    var composed = {};

    composed['Cache-Control'] = 'max-age=3600';

    switch (format) {
    case 'vector.pbf':
        composed['Content-Type'] = 'application/x-protobuf';
        composed['Content-Encoding'] = 'deflate';
        break;
    case 'jpeg':
        composed['Content-Type'] = 'image/jpeg';
        break;
    case 'png':
        composed['Content-Type'] = 'image/png';
        break;
    }

    var times = headers.reduce(function(memo, h) {
        if (!h) return memo;
        for (var k in h) if (k.toLowerCase() === 'last-modified') {
            memo.push(new Date(h[k]));
            return memo;
        }
        return memo;
    }, []);
    if (!times.length) {
        times.push(new Date());
    } else {
        times.push(minmtime);
    }
    composed['Last-Modified'] = (new Date(Math.max.apply(Math, times))).toUTCString();

    var etag = headers.reduce(function(memo, h) {
        if (!h) return memo;
        for (var k in h) if (k.toLowerCase() === 'etag') {
            memo.push(h[k]);
            return memo;
        }
        return memo;
    }, []);
    if (!etag.length) {
        composed['ETag'] = '"' + crypto.createHash('md5').update(composed['Last-Modified']).digest('hex') + '"';
    } else {
        composed['ETag'] = etag.length === 1 ? etag[0] : '"' + crypto.createHash('md5').update(etag.join(',')).digest('hex') + '"';
    }

    return composed;
}
