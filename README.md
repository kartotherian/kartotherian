# Maps Tile service for Wikipedia

Maps nodejs server for vector-based tiles designed for Wikipedia and other sites. It ties together a number of [MapBox components](https://github.com/mapbox) for vector and raster rendering based on [Mapnik 3](https://github.com/mapnik/mapnik), and uses [service runner](https://github.com/wikimedia/service-runner) for scalability and stability.

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
Browse to http://localhost:4000/static

The set up inside `sources.sample.yaml` does not use any storage or caching, so it will not be suitable for production. You will need to configure additional source chains and setup a proper storage to make this into a production system.

## Configuration
Inside the `conf` key:
* `sources` - (required) Either a set of subkeys, a filename, or a list of file names.  See [core](https://github.com/kartotherian/kartotherian-core) on how to configure the sources.
* `variables` (optional) - specify a set of variables (string key-value pairs) to be used inside sources, or it could be a filename or a list of filenames/objects.
* `defaultHeaders` (optional, object) - a set of extra headers that will be sent to the user unless the source provides its own. (public requests only)
* `headers` (optional, object) - a set of extra headers that will be sent to the user instead of the headers returned by the source. (public requests only)
For the rest of the configuration parameters, see [service runner](https://github.com/wikimedia/service-runner) config info.

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
port: 4000

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
    .port = "4000";
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
In browser, navigate to `http://localhost:4000/static`.

### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:
```
rm -r node_modules
npm install
```
