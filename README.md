## abaculus
a small block of stone, tile, glass, or other material used in the construction of a mosaic

or, 

a library for creating static maps from tiles based on center or corner lng,lat coordinates.
Uses node-mapnik to stitch tiles together.

[![Build Status](https://travis-ci.org/mapbox/abaculus.svg?branch=master)](https://travis-ci.org/mapbox/abaculus)

[![Build status](https://ci.appveyor.com/api/projects/status/k5e2v42uhbda1ihx)](https://ci.appveyor.com/project/Mapbox/abaculus)

### usage

#### input:
`scale`: integer between 1-4 and sets resolution (`scale: 1` is 72dpi, `scale: 4`, is 288dpi)

`zoom`: zoom level

`[w, s, e, n]`: the bounding box for the west (lat val), south (lng val), east (lat val), north (lng val) for the desired area

`x`: longitude coordinate

`y`: latitude coordinate

`width` and `height`: desired pixel bounds for a map with a center coordinate. Will be multiplied by scale to maintain resolution.

`format` (optional): `png` or `jpeg`, default is `png`. 

`quality` (optional): for `jpeg` defaults to 80, and has a range of 2-256 for `png`.

`getTile`: a function that returns a tile buffer (png or otherwise) and headers given `z`, `x`, `y`, and a callback, such as from [tilelive-vector](https://github.com/mapbox/tilelive-vector/blob/master/index.js#L107-L200).

`limit` (optional): max image size in pixels. Default is 19008px.

```javascript
// Calculate image bounds from W,S,E,N bounding box.
var params = {
	zoom: {zoom},
	scale: {scale}
    bbox: [{w}, {s}, {e}, {n}],
    format: {format},
    quality: {quality},
    getTile: function(z,x,y, callback){
    			// do something
			    return callback(null, buffer, headers);
			},
	limit: {limit}
};
```
or 
```javascript
// Calculate image bounds from center lng,lat coordinates and 
// pixel dimensions of final image (will be multipled by scale).
var params = {
	zoom: {zoom},
	scale: {scale}
    center: {   
    	x: {x},
    	y: {y},
    	w: {width},
    	h: {height}
    },
    format: {format},
    quality: {quality},
    getTile: function(z,x,y, callback){
    			// do something
			    return callback(null, buffer, headers);
			},
	limit: {limit}
};
```
#### usage:
``` javascript
abaculus(params, function(err, image){
       if (err) return err;
       // do something with image
	});
```

#### output:
an image of desired resolution for the selected area.
