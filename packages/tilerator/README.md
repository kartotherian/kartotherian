# OSM Tile service for Wikipedia

Maps nodejs server for vector-based tiles designed for Wikipedia and other sites. It ties together a number of MapBox components for vector and raster rendering.

TODO:  Introduction!

* The server code is based on the service-template-node [![Build Status](https://travis-ci.org/wikimedia/service-template-node.svg?branch=master)](https://travis-ci.org/wikimedia/service-template-node)


## Quick start:

Requirements (on Debian Jessie):
```
apt-get install git build-essential postgresql-9.4-postgis-2.1 postgresql-contrib-9.4 proj-bin libgeos-dev osm2pgsql sqlite3 nodejs-legacy
```

Get the code:
```
git clone https://github.com/nyurik/kartotherian.git    # Clone the repository
cd kartotherian
git submodule update --init                             # update submodules
npm install                                             # install npm dependencies
```

Edit configuration - config.yaml:
```
# 0 - one instance, 1+ - multi-instance with autorestart, ncpu - multi-instance, one per CPU
num_workers: 0

# Host port
port: 4000

# Comment out this line to listen to the web
# interface: localhost
```

Download Water polygons in Mercator format from http://openstreetmapdata.com/data/water-polygons:
```
$ curl -O http://data.openstreetmapdata.com/water-polygons-split-3857.zip
$ unzip water-polygons-split-3857.zip
$ cd water-polygons-split-3857
$ shp2pgsql -I -s 3857 -g way water_polygons.shp water_polygons | psql -d gis
$ psql gis
gis=# select UpdateGeometrySRID('', 'water_polygons', 'way', 900913);
\q

$ psql -d gis -f map/osm-bright.tm2source/sql/water-indexes.sql
```

Add mapbox's helper functions:
```
psql -d gis -f scripts/mbutils/lib.sql
```


Run karthotherian:
```
npm start
```

To view it, navigate to `/static` or `/static/gl`


### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:

```
rm -r node_modules
npm install
```
