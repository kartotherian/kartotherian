var sm = new (require('sphericalmercator'));
var queue = require('queue-async');
var blend = require('blend');

module.exports = abaculus;

var limit = 19008;

function abaculus(arg, callback){
    var z = arg.zoom || 1,
        s = arg.scale || 1,
        center = arg.center || null,
        corners = arg.corners || null,
        getTile = arg.getTile || null,
        format = arg.format || 'png';
    if (!getTile) 
        return callback(new Error('Invalid function for getting tiles'));

    if (center) {
        // get center coordinates in px from lng,lat
        abaculus.coordsFromCenter(z, s, center, function(err, center){
            if (err) return callback(err);
            // generate list of tile coordinates center
            abaculus.tileList(z, s, center, function(err, coords){
                if (err) return callback(err);
                // get tiles based on coordinate list and stitch them together
                abaculus.stitchTiles(coords, format, getTile, callback);
            });
        });
    } else if (corners) {
        // get center coordinates in px from ne & sw corners
        abaculus.coordsFromCorners(z, s, corners, function(err, center){
            if (err) return callback(err);
            // generate list of tile coordinates center
            abaculus.tileList(z, s, center, function(err, coords){
                if (err) return callback(err);
                // get tiles based on coordinate list and stitch them together
                abaculus.stitchTiles(coords, format, getTile, callback);
            });
        });
    } else {
        return callback(new Error('No coordinates provided.'));
    }
}

abaculus.coordsFromCorners = function(z, s, corners, done){
    sm.size = 256 * s;
    var topLeft = sm.px([corners.topLeft.x, corners.topLeft.y], z),
        bottomRight = sm.px([corners.bottomRight.x, corners.bottomRight.y], z);
    var center = {};
    center.w = bottomRight[0] - topLeft[0];
    center.h = bottomRight[1] - topLeft[1];
    if (center.w <= 0 || center.h <= 0) return done(new Error('Incorrect coordinates -- bottom right corner must be lower and to the east of the top left corner'));
    
    var origin = [topLeft[0] + center.w/2, topLeft[1] + center.h/2];
    center.x = origin[0];
    center.y = origin[1];
    center.w = center.w * s;
    center.h = center.h * s;

    if (center.w >= limit || center.h >= limit) return done(new Error('Desired image is too large.'));
    return done(null, center);
};

abaculus.coordsFromCenter = function(z, s, center, done){
    var origin = sm.px([center.x, center.y], z);
    center.x = origin[0];
    center.y = origin[1];
    center.w = center.w * s;
    center.h = center.h * s;

    if (center.w >= limit || center.h >= limit) return done(new Error('Desired image is too large.'));
    return done(null, center);
};

// Generate the zxy and px/py offsets needed for each tile in a static image.
// x, y are center coordinates in pixels
abaculus.tileList = function(z, s, center, callback) {
    var x = center.x,
        y = center.y,
        w = center.w,
        h = center.h;
    var dimensions = {x: w, y: h};
    var tileSize = 256 * s;

    var centerCoordinate = {
            column: x / 256,
            row: y / 256,
            zoom: z
        };

    function pointCoordinate(point) {
        var coord = { column: centerCoordinate.column,
                    row: centerCoordinate.row,
                    zoom: centerCoordinate.zoom,
                    };
        coord.column += (point.x - w / 2) / tileSize;
        coord.row += (point.y - h / 2) / tileSize;
        return coord;
    }

    function coordinatePoint(coord) {
        // Return an x, y point on the map image for a given coordinate.
        if (coord.zoom != z) coord = coord.zoomTo(z);
        return {
            x: w / 2 + tileSize * (coord.column - centerCoordinate.column),
            y: h / 2 + tileSize * (coord.row - centerCoordinate.row)
        };
    }

    function floorObj(obj) {
        return {
                row: Math.floor(obj.row),
                column: Math.floor(obj.column),
                zoom: Math.floor(obj.zoom)
            };
    }

    var tl = floorObj(pointCoordinate({x: 0, y:0}));
    var br = floorObj(pointCoordinate(dimensions));
    var coords = {};
    coords.tiles = [];
    var tileCount = (br.column - tl.column + 1) * (br.row - tl.row + 1);

    for (var column = tl.column; column <= br.column; column++) { 
        for (var row = tl.row; row <= br.row; row++) {
            var c = { column: column,
                    row: row,
                    zoom: z,
                    };
            var p = coordinatePoint(c);

            // Wrap tiles with negative coordinates.
            c.column = c.column < 0 ?
                Math.pow(2,c.zoom) + c.column :
                c.column % Math.pow(2,c.zoom);

            if (c.row < 0) continue;
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

    return callback(null, coords);
};

abaculus.stitchTiles = function(coords, format, getTile, callback){
    if (!coords) return callback(new Error('No coords object.'));
    var tileQueue = new queue(1);
    var dat = [];
    var w = coords.dimensions.x,
        h = coords.dimensions.y,
        s = coords.scale,
        tiles = coords.tiles;

    tiles.forEach(function(t){
        tileQueue.defer(function(z, x, y, done){
            done.scale = s;
            done.format = format;
            // getTile is a function that returns 
            // a tile given z, x, y, & done
            getTile(z, x, y, done);
        }, t.z, t.x, t.y);
    });

    function tileQueueFinish(err, data) {
        if (err) console.log(err, data);
        if (!data) return callback(new Error('No tiles to stitch.'));
        data.forEach(function(d, i){
            dat.push({buffer: d, x: tiles[i].px, y: tiles[i].py});
        });
        blend(dat, {
            width: w,
            height: h
        }, callback);
    }

    tileQueue.awaitAll(tileQueueFinish);
};