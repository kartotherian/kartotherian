var sm = new (require('sphericalmercator'));
var queue = require('queue-async');
var blend = require('blend');

module.exports = abaculus;

var limit = 19008;

function abaculus(arg, callback){
    var z = arg.zoom || 1,
        s = arg.scale || 1,
        center = arg.center || null,
        bbox = arg.bbox || null,
        getTile = arg.getTile || null,
        format = arg.format || 'png';
    if (!getTile) 
        return callback(new Error('Invalid function for getting tiles'));

    if (center) {
        // get center coordinates in px from lng,lat
        center = abaculus.coordsFromCenter(z, s, center);
    } else if (bbox) {
        // get center coordinates in px from ne & sw corners
        center = abaculus.coordsFromBbox(z, s, bbox);
    } else {
        return callback(new Error('No coordinates provided.'));
    }
    // generate list of tile coordinates center
    var coords = abaculus.tileList(z, s, center);

    // get tiles based on coordinate list and stitch them together
    abaculus.stitchTiles(coords, format, getTile, callback);
}

abaculus.coordsFromBbox = function(z, s, bbox){
    sm.size = 256 * s;
    var topRight = sm.px([bbox[3], bbox[2]], z),
        bottomLeft = sm.px([bbox[1], bbox[0]], z);
    var center = {};
    center.w = topRight[0] - bottomLeft[0];
    center.h = bottomLeft[1] - topRight[1];

    if (center.w <= 0 || center.h <= 0) throw new Error('Incorrect coordinates');

    var origin = [topRight[0] - center.w/2, topRight[1] + center.h/2];
    center.x = origin[0];
    center.y = origin[1];
    center.w = center.w * s;
    center.h = center.h * s;

    if (center.w >= limit || center.h >= limit) throw new Error('Desired image is too large.');
    return center;
};

abaculus.coordsFromCenter = function(z, s, center){
    var origin = sm.px([center.x, center.y], z);
    center.x = origin[0];
    center.y = origin[1];
    center.w = center.w * s;
    center.h = center.h * s;

    if (center.w >= limit || center.h >= limit) throw new Error('Desired image is too large.');
    return center;
};

// Generate the zxy and px/py offsets needed for each tile in a static image.
// x, y are center coordinates in pixels
abaculus.tileList = function(z, s, center) {
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

    return coords;
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