tilelive-vector
---------------
Implements the tilelive API for rendering mapnik vector tiles to raster images.

[![Build Status](https://secure.travis-ci.org/mapbox/tilelive-vector.png)](http://travis-ci.org/mapbox/tilelive-vector)

### new Vector(options, callback)

- *xml*: a Mapnik XML string that will be used to render vector tiles.
- *source*: Optional, a uri string suitable for use with `tilelive.load()`. This is fallback source that will be used if no source is found as part of the Mapnik XML parameters.
- *base*: Optional, basepath for Mapnik map. Defaults to `__dirname`.
- *format*: Optional, target output format. Defaults to `png8:m=h`.
- *scale*: Optional, Mapnik scale factor. Defaults to `1`.
- *deflate*: Optional, whether to expect deflated vector tiles. Defaults to `true`.

### Code concepts

- *Backend z/x/y*: a request for a raster tile at, say, 3/3/3 does not always mean 3/3/3 is requested from the backend source. The z/x/y requested from the backend source is referred in code by `bz/bx/by` and generally represent the same or lower zoom level. This allows for features like *overzooming*, *maskLevel tiles*, and *scale factor adjustment*.
- *Overzooming*: if a tile beyond the `maxzoom` of the backend is requested, Vector will attempt to render the tile using the parent of the request at `maxzoom`.
- *maskLevel tiles*: to avoid requiring many duplicate or empty vector tiles to be generated at high zoom levels, the backend source can specify a `maskLevel`. If a vector tile is not initially found at some `z > maskLevel`, Vector will issue an additional request to the backend using the parent tile of of the request at `maskLevel`. This allows a lower zoom level to "backfill" high zoom levels.
- *Scale factor adjustment*: the scale argument decrements the backend zoom level such that the requested tile is the visual equivalent (when viewed on the proper dpi device) of its parent counterpart. For example, `scale: 2` decrements `bz` by 1, `scale: 4` decrements by 2, and so on.
