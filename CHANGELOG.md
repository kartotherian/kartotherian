# Changlog

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
