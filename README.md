## abaculus
a small block of stone, tile, glass, or other material used in the construction of a mosaic

or, 

a library for creating static maps from tiles based on center or corner lng,lat coordinates.
Uses node-blend to stitch tiles together.

### usage


#### input:

`scale` is an integer between 1-4 and sets resolution (`scale: 1` is 72dpi, `scale: 4`, is 288dpi)

`zoom` denotes zoom level

`[w, s, e, n]` is the bounding box for the west (lat val), south (lng val), east (lat val), north (lng val) for the desired area

`x` is a longitude coordinate, `y` is a latitude coordinate

`width` and `height` are the desired pixel bounds for a map with a center coordinate. Will be multiplied by scale to maintain resolution.

`format` is `png` or `jpeg`, and `quality` is optional. For `jpeg` it defaults to 80, and has a range of 2-256 for `png`.

`getTile` should be a function that returns a tile buffer (png or otherwise) given `z`, `x`, `y`, and a callback, such as from [tilelive-vector](https://github.com/mapbox/tilelive-vector/blob/master/index.js#L107-L200).

```javascript
var params = {
	zoom: {zoom},
	scale: {scale}
    bbox: [{w}, {s}, {e}, {n}],
    format: {format},
    quality: {quality},
    getTile: function(z,x,y, callback){
    			// do something
			    return callback(null, buffer, headers);
			}
};
```
or 
```javascript
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
			}
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
