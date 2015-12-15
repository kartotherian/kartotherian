# Changelog

## 3.6.0

 - No longer uses screen blending mode for image tiles.
 - Adds `transparent` option to xray source to render xray tiles without a background color.
 - Renames `maskLevel` to `fillzoom` for backfilled tiles.
 - Sets and passes through `x-vector-backend-object` header for describing backend object type.

## 3.5.2

 - Fix error handling bug in tm2z loading.
 - Update several dependencies.

## 3.5.1

 - Fix a bug where potentially incomplete tm2z downloads would be marked as complete.

## 3.5.0

 - Updated to use newest version of tilelive.

## 3.4.0

 - Updated to use mapnik 3.4.6

## 3.2.7

 - Update tilelive.js to 5.8.x

## 3.2.4

 - Updated to tilelive.js 5.6.x again (3.2.3 ended up getting tilelive.js 5.5.x)

## 3.2.3

 - Upgrade node-mapnik to 3.2.0

## 3.2.2

 - Update tilelive.js to 5.6.x

## 3.2.1

 - Update tilelive.js dependency

## 3.2.0

- Allow a filepath to a mapnik XML file to be passed in constructor URI

## 3.0.4

- Update tilelive.js dependency

## 3.0.3

- Update request dependency

## 3.0.2

- Calls to #update() always update regardless of XML diff.

## 3.0.1

- Updates tilelive.js and node-mapnik dependencies

## 3.0.0

- Update to node-mapnik@3.0.x. Requires C++11 support.

## 2.3.0

- Remove in-memory cache of tm2z sources.

## 2.2.0

- Update to tilelive v5.2.x

## 2.1.0

- Detects and supports gzipped vector tiles

## 2.0.0

- Update to tilelive v5.0.x

## 1.1.0

- Windows support

## 1.0.0

- Adds support for embedded rasters in mapnik vector tiles

## 0.13.0

- Tile size as function of scale for retina and print - 512px at scale 2, 1024px at scale 4
- Legacy flag for api-maps v1-3

## 0.12.0

 - Adds queryTile method and removes xray interactivity for inspection

## 0.11.0

 - Add xray constructor for auto-generating inspection styles for backends

## 0.10.0

 - Loosen node-mapnik semver to any ~1.4.0 version

## 0.9.0

 - Backend: remove caching of VT tiles

## 0.8.0

 - Use lru-cache to replace internal backend VT cache

## 0.7.0

 - Update to mapnik 1.4.x (packaged binaries!)

## 0.6.0

 - Backend: share a parsed mapnik.VectorTile instances between getTile calls

## 0.5.0

 - Update to mapnik 1.3.x
 - Split out overzoom/mask logic to backend source

## 0.4.0

 - Use mapnik strict mode

## 0.3.0

 - Adds errors when tm2z unpacking streams exceed a configurable size

## 0.2.0

 - Adds unpacking of tm2z archives
 - Drops node v0.6.x support

## 0.1.3

 - Updated to work with and expect >= node-mapnik v1.1.1
 - Added vector json output
