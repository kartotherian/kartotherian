[![Build Status](https://travis-ci.org/kartotherian/geoshapes.svg?branch=master)](https://travis-ci.org/kartotherian/geoshapes)

# @kartotherian/geoshapes
Kartotherian service to generate geometric shapes from PostgreSQL data

See https://github.com/kartotherian/kartotherian

To configure, add `geoshapes` section to the kartotherian configuration with the following parameters:

```
geoshapes:
  host: localhost
  database: gis
  table: planet_osm_polygon
  user: ...
  password: ...

  maxidcount: (int, optional, default=500) - Maximum number of IDs to allow per request
  allowUserQueries: (bool, optional, default=false) - If true, allow sql parameter + args to specify which SQL to use
  wikidataQueryService: (string, optional, default=https://query.wikidata.org/bigdata/namespace/wdq/sparql) - Lets user get a list of WikidataIDs from an external Wikidata Query Service. if false, disables.
```

Without this config block, the service will skip its loading

Make sure to create a Postgres index, e.g.:
```
CREATE INDEX planet_osm_polygon_wikidata
  ON planet_osm_polygon ((tags -> 'wikidata'))
  WHERE tags ? 'wikidata';
```

Service will return topojson to the queries such as `/geoshape?ids=Q1384,Q1166`  (get New York and Michigan state shapes).
Save result as a file and upload to http://www.mapshaper.org/ to visualize.

Additionally, the service allows `query=...` parameter to get the Wikidata IDs from the http://query.wikidata.org service. It calls the service to execute
a query, extracts IDs, and matches them with the shapes in the OSM database. All other values are returned as topojson object properties.

Optional truthy parameter `getgeojson=1` will force the result to be returned as geojson rather than topojson.
