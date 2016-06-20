# kartotherian-geoshapes
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

  maxidcount: (int, optional, default=500)
```

Without this config block, the service will skip its loading

Make sure to create a Postgres index, e.g.:
```
CREATE INDEX planet_osm_polygon_wikidata
  ON planet_osm_polygon ((tags -> 'wikidata'))
  WHERE tags ? 'wikidata';
```

Service will return topojson to the queries such as `/shape?ids=Q1384,Q1166`  (get New York and Michigan state shapes).
Save result as a file and upload to http://www.mapshaper.org/ to visualize.
