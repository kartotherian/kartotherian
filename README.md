# OSM Tile service for Wikipedia

Maps nodejs server for vector-based tiles designed for Wikipedia and other sites. It ties together a number of MapBox components for vector and raster rendering based on Mapnik 3.

TODO:  Introduction!

* The server code is based on the service-template-node - https://travis-ci.org/wikimedia/service-template-node


## Quick start:

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
git clone https://github.com/nyurik/kartotherian.git    # Clone the repository
cd kartotherian
git submodule update --init                             # update submodules
npm install                                             # install npm dependencies
```

### Edit Kartotherian configuration - config.yaml
```
# 0 - one instance, 1+ - multi-instance with autorestart, ncpu - multi-instance, one per CPU
num_workers: 0

# Host port
port: 4000

# Comment out this line to listen to the web
# interface: localhost
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

$ psql -d gis -f map/osm-bright.tm2source/sql/water-indexes.sql
```

### Add mapbox's helper functions
```
psql -d gis -f scripts/mbutils/lib.sql
```

### Add Varnish caching layer (optional)
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
In browser, navigate to `localhost:4000/static`.

For GL display, go to the static/mapbox-gl-js folder and run
```
npm install
```
Then in browser, navigate to `localhost:4000/static/gl`.

### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:
```
rm -r node_modules
npm install
```
