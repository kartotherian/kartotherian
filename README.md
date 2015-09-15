# Maps Tile service for Wikipedia

This code is cross-hosted at [gerrit](https://git.wikimedia.org/summary/maps%2Fkartotherian)

Maps nodejs server for vector-based tiles and snapshots, designed for Wikipedia and other sites. It ties together a number of [MapBox](https://github.com/mapbox) components for vector and raster rendering based on [Mapnik 3](https://github.com/mapnik/mapnik), and uses [service runner](https://github.com/wikimedia/service-runner) for scalability, performance monitoring and stability.

### Serving tiles
Kartotherin can serve vector and raster tiles in multiple formats and optional scaling:

    http://.../{source}/{zoom}/{x}/{y}[@{scale}x].{format}

* The sources are configured with the
[source config file](https://github.com/kartotherian/kartotherian-core). Sources configuration supports different methods of tile storage, such as Cassandra or files, generation from postgress db, overzoom to extract the tile from lower zooms if missing, layer extraction, mixing multiple sources together, etc.
* Optional scalling can render larger images for high resolution screens (only those enabled in the source, e.g. `[1.5, 2]`)
* Supported formats include PNG ang JPEG, SVG, PBF vectors, and JSON (with `nogeo` and `summary` debug options)

### Static map images
Kartotherian supports static image generation. Users may request a PNG or a JPEG snapshot image of any size, scaling, and zoom level:

    http://.../img/{source},{zoom},{lat},{lon},{width}x{height}[@{scale}x].{format}
    
    # image centered at 42,-3.14, at zoom level 4, size 800x600
    http://.../img/osm-intl,4,42,-3.14,800x600.png

    # the same but for higher DPI device with 1.5 scaling
    http://.../img/osm-intl,4,42,-3.14,800x600@1.5x.png

### Info data
Kartotherian can be used as a source of the PBF data for Mapbox studio. Point it to your `node_modules/osm-bright-source`, clicking layers / change layer, and providing this link:

    http://.../{style}/pbfinfo.json
    
(There is currently [a bug](https://github.com/mapbox/mapbox-studio/issues/1268) in the MapBox studio, but it should be resolved soon)

## Very quick start:
Assumes you have an OSM database (or a part of it) set up locally in the latest Postgress+Postgis, imported using `osm2pgsql --slim --hstore`.
```
cd /srv
git clone https://github.com/kartotherian/kartotherian.git  # Clone the repository
cd kartotherian
git submodule update --init                                 # update submodules
npm install                                                 # install npm dependencies
node server.js -c config.sample.yaml
```
Browse to http://localhost:6533/

The set up inside `sources.sample.yaml` does not use any storage or caching, so it will not be suitable for production. You will need to configure additional source chains and setup a proper storage to make this into a production system.

## Configuration
Inside the `conf` key:
* `sources` - (required) Either a set of subkeys, a filename, or a list of file names.  See [core](https://github.com/kartotherian/kartotherian-core) on how to configure the sources.
* `variables` (optional) - specify a set of variables (string key-value pairs) to be used inside sources, or it could be a filename or a list of filenames/objects.
* `defaultHeaders` (optional, object) - a set of extra headers that will be sent to the user unless the source provides its own. (public requests only)
* `headers` (optional, object) - a set of extra headers that will be sent to the user instead of the headers returned by the source. (public requests only)
For the rest of the configuration parameters, see [service runner](https://github.com/wikimedia/service-runner) config info.

## Components
Kartotherian platform consists of a number of elements, some of which conform to the general specifications established
by [MapBox](https://github.com/mapbox), and therefor can reuse components that confirm to the same specification.
Also, see [Tilerator](https://github.com/kartotherian/tilerator), an optional stand-alone service to pre-generate tiles.
Tilerator is separate from Kartotherian, but it reuses most of the same components.

### Components by Wikimedia Foundation
* [kartotherian-core](https://github.com/kartotherian/kartotherian-core) - Loads and configures tile sources, and provides some common utility functions
* [kartotherian-autogen](https://github.com/kartotherian/kartotherian-autogen) - Tile source that checks "storage" source for a tile, and if not found, gets it from the "generator" source and saves it into the "storage"
* [kartotherian-demultiplexer](https://github.com/kartotherian/kartotherian-demultiplexer) - Tile source that combines multiple sources by zoom level
* [kartotherian-cassandra](https://github.com/kartotherian/kartotherian-cassandra) - Tile source that stores tiles in the Cassandra database 
* [kartotherian-layermixer](https://github.com/kartotherian/kartotherian-layermixer) - Tile source capable of mixing different vector layers from multiple tile sources
* [kartotherian-overzoom](https://github.com/kartotherian/kartotherian-overzoom) - Tile source that will zoom out if the requested tile does not exist, and extracts the needed portion from the lower-zoom tile it finds.
* [osm-bright-source](https://github.com/kartotherian/osm-bright.tm2source) - SQL queries used by the `tilelive-bridge` to generate a vector tile from Postgres Database
* [osm-bright-style](https://github.com/kartotherian/osm-bright.tm2) - Style used by the `tilelive-vector` to convert vector tiles into images.

### Components by MapBox
* [tilelive](https://github.com/mapbox/tilelive) - ties together various tile sources, both vector and raster
* [tilelive-bridge](https://github.com/mapbox/tilelive-bridge) - generates vector tiles from SQL
* [tilelive-vector](https://github.com/mapbox/tilelive-vector) - converts vector tiles to raster tiles
* [abaculus](https://github.com/mapbox/abaculus) - generates raster images of any location and size from a tile source

### Other Relevant Components
* [mapnik](https://github.com/mapnik/node-mapnik) - Tile rendering library for node
* [leaflet](https://github.com/Leaflet/Leaflet) - JavaScript library for mobile-friendly interactive maps

## In depth step-by-step:

### Requirements (on Debian Jessie)
```
apt-get install sudo git unzip curl build-essential postgresql-9.4-postgis-2.1 postgresql-contrib-9.4 proj-bin libgeos-dev osm2pgsql sqlite3 nodejs-legacy npm
```

### Initial server settings (The notes are for the user "yurik")
```
useradd -m -G adm,sudo yurik
vi /etc/sudoers  # Allow nopassword sudoing by changing this line:
                 %sudo   ALL=(ALL:ALL) NOPASSWD: ALL

# As user, add some git helpers and vim syntax colors:
git config --global alias.co checkout
git config --global alias.st status
git config --global alias.br branch
git config --global alias.hist 'log --pretty=format:"%h %ad | %s%d [%an]" --graph --date=short'
```

### Setup an osm2pgsql database named gis
```
mkdir /srv/planet
cd /srv
groupadd osm
usermod -a -G osm yurik
# TODO: seems wrong, double check these 4 lines
chgrp osm planet
chgrp osm .
chmod g+w . planet
chmod g+w . osm

# Download the latest OSM dump from http://planet.osm.org/pbf/ - both md5 and the actual data
curl -O http://planet.osm.org/pbf/planet-150601.osm.pbf.md5
curl -O http://planet.osm.org/pbf/planet-150601.osm.pbf    # You can do other steps in the mean time
md5sum -c planet-150601.osm.pbf.md5  # Make sure the file downloaded ok
```

### Configure Postgres database
```
service postgresql stop
mv /var/lib/postgresql/ /srv
ln -s /srv/postgresql /var/lib

vi /etc/postgresql/9.4/main/postgresql.conf
# uncomment conf.d line in /etc/postgresql/9.4/main/postgresql.conf

mkdir /etc/postgresql/9.4/main/conf.d
vi /etc/postgresql/9.4/main/conf.d/settings.conf
```
Add this text:
```
# from http://paulnorman.ca/blog/2014/11/new-server-postgresql-tuning/
shared_buffers = 512MB
work_mem = 64MB
maintenance_work_mem = 1024MB
# full_page_writes = off
wal_buffers = 16MB
checkpoint_segments = 64
checkpoint_completion_target = 0.9
random_page_cost = 2.0
cpu_tuple_cost = 0.05
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.2

# Uncomment to log slow queries - http://www.postgresql.org/docs/9.2/static/auto-explain.html
# shared_preload_libraries = 'auto_explain'
# auto_explain.log_min_duration = '5s'
```

In bash:
```
service postgresql start
sudo -u postgres createuser -s yurik
createdb -E UTF8 -T template0 gis
psql -d gis -c 'CREATE EXTENSION hstore; CREATE EXTENSION postgis;'

# Once OSM dump is downloaded, import. Takes about 14 hours on a reasonable SSD server.
osm2pgsql --create --slim --flat-nodes nodes.bin -C 26000 --number-processes 8 --hstore planet-150601.osm.pbf
```

### Get Kartotherian code
```
cd /srv
git clone https://github.com/kartotherian/kartotherian.git  # Clone the repository
cd kartotherian
git submodule update --init                                 # update submodules
npm install                                                 # install npm dependencies
```

### Edit Kartotherian configuration - config.yaml
```
# 0 - one instance, 1+ - multi-instance with autorestart, ncpu - multi-instance, one per CPU
num_workers: 0

# Host port
port: 6533

# Comment out this line to listen to the web
# interface: localhost

# Place all variables (e.g. passwords) here - either as a filename, or as sub-items.
variables:

# Place all sources you want to serve here - either as a filename, or as sub-items.
# See sources.prod.yaml for examples
sources: sources.yaml
```

### Download Water polygons in Mercator format from http://openstreetmapdata.com/data/water-polygons
```
$ curl -O http://data.openstreetmapdata.com/water-polygons-split-3857.zip
$ unzip water-polygons-split-3857.zip && rm water-polygons-split-3857.zip
$ cd water-polygons-split-3857
$ shp2pgsql -I -s 3857 -g way water_polygons.shp water_polygons | psql -d gis
$ psql gis
gis=# select UpdateGeometrySRID('', 'water_polygons', 'way', 900913);
\q

$ psql -d gis -f node_modules/osm-bright-source/sql/water-indexes.sql
```

### Add mapbox's helper functions
```
psql -d gis -f node_modules/osm-bright-source/sql/functions.sql
```

### Configure Kartotherian
Use one of the config files, or update them, and make a link config.yaml to it.

### Add Varnish caching layer (optional)
Might require caching headers added to the source/config.
```
# From https://www.varnish-cache.org/installation/debian
sudo -Hi
apt-get install apt-transport-https
curl https://repo.varnish-cache.org/GPG-key.txt | apt-key add -
echo "deb https://repo.varnish-cache.org/debian/ jessie varnish-4.0" >> /etc/apt/sources.list.d/varnish-cache.list
apt-get update
apt-get install varnish

vi /etc/varnish/default.vcl
```
Change default backend to:
```
backend default {
    .host = "localhost";
    .port = "6533";
}
```
Add this to vcl_deliver (to track hits/misses):
```
if (obj.hits > 0) {
    set resp.http.X-Cache = "HIT";
} else {
    set resp.http.X-Cache = "MISS";
}
```
Edit /etc/systemd/system/varnish.service - set proper listening port (80) and cache size:
```
ExecStart=/usr/sbin/varnishd -a :80 -T localhost:6082 -f /etc/varnish/default.vcl -S /etc/varnish/secret -s malloc,4g
```
In bash:
```
systemctl daemon-reload  # because we changed the .service file
systemctl restart varnish.service
systemctl status varnish.service  # check the service started with the right params
varnishstat  # monitor varnish performance
```

### Run Karthotherian:
```
npm start
```
In browser, navigate to `http://localhost:6533/`.

### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:
```
rm -r node_modules
npm install
```
