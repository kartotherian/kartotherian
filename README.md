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
Browse to localhost:4000

## Service Configuration - General
Inside the conf key, you must specify sources - either as a set of subkeys, or as a filename. You may also optionally specify a set of variables (string key-value pairs) to be used inside sources, or it could be a filename as well. For the resot of the configuration, see [service runner](https://github.com/wikimedia/service-runner) config info.

## Service Configuration - Sources
Sources, either as a standalone file or as a set of sub-keys inside the `conf` config key, tell Kartotherian what data sources to use:
```
gen:                # The name of the source (could be referenced later)
  uri: bridge://    # The URI used to construct the source
  xml:              # Init source with this xml instead of the URI's other parameters
    # Set xml to the location of the 'data.xml', which is located inside the osm-bright-source npm
    npm: ["osm-bright-source", "data.xml"]
  xmlSetDataSource: # Before loading, update the datasource section of the standard mapnik config file
    if:             # Only update datasources that match all these values (logical AND)
      dbname: gis   # Instead of 'gis', you can use {npm:...}, {ref:..}, and {var:...}
      host: ''
      type: postgis
    set:            # Replace these keys with the new values
      host: localhost
      user: {var: osmdb-user}  # Instead of hardcoding, use the value from the variables file or conf section
      password: {var: osmdb-pswd}
```
URI is the only mandatory field, and it specifies how [tilelive.js](https://github.com/mapbox/tilelive.js) will locate and initialize the new source.  Since sometimes not everything can be added as query parameters to the Uri, Kartotherian has a set of additional keys to help.  Values can either be hardcoded as strings/numbers/booleans, or can be calculated on the fly. Sources support these subkeys:

* `public` (boolean) - should this be source be accessible via `/<sourceId>/z/x/y.format` requests

* `minzoom` (int) - minimum allowable zoom for the public request (public requests only)
* `maxzoom` (int) - maximum allowable zoom for the public request (public requests only)
* `defaultHeaders` (object) - a set of extra headers that will be sent to the user unless the source provides its own. (public requests only)
* `headers` (object) - a set of extra headers that will be sent to the user instead of the headers returned by the source. (public requests only)
* `formats` (array) - a list of string values specifyng allowed formats, e.g. `['png','jpeg']`

* `xml` - Some sources such as [tilelive-bridge](https://github.com/mapbox/tilelive-bridge) and [tilelive-vector](https://github.com/mapbox/tilelive-vector) can be initialized with the XML string instead of a URI, which could be used to alter XML before loading it. The `xml` field must evaluate to the xml file path.
* `xmlSetParams` - for xml, overrides the top level `<Parameters>` values with the new ones. For example, the `vector` source requires xml stylesheet to point to the proper source of PBFs:
```
s2:
  public: true
  uri: vector://
  formats: [png,json,headers,svg,jpeg]
  xml:
    npm: ["osm-bright-style", "project.xml"]    # stylesheet xml is in npm
  xmlSetParams:
    source: {ref: gen}                          # set source parameter to the 'gen' source
```
* `xmlLayers` - for xml, keep all non-layer data, but only keep those layers that are listed in this value (whitelist):
```
s2:
  public: true
  uri: vector://
  formats: [png,json,headers,svg,jpeg]
  xml:
    npm: ["osm-bright-style", "project.xml"]    # stylesheet xml is in npm
  xmlLayers: ['landuse', 'road']                # Only include these layers when rendering
```
* `xmlExceptLayers` - for xml, same as `xmlLayers`, but instead of whitelisting, blacklist (allow all except these):
```
s2:
  public: true
  uri: vector://
  formats: [png,json,headers,svg,jpeg]
  xml:
    npm: ["osm-bright-style", "project.xml"]    # stylesheet xml is in npm
  xmlExceptLayers: ['water']                    # Exclude water layer when rendering
```
* `xmlSetDataSource` - for xml, change all layer's datasources' parameters if they match conditions:  `if` is a set of parameter values that all must match, `xmlLayers` and `xmlExcludeLayers` just like above set which layers to address, and `set` specifies the new parameter values to be set.

The following value substitutions are available:

* `{var:varname}` - the value becomes the value of the variable `varname` from the variables file / variables conf section of the main config file. This might be useful if you want to make all the settings public except for the passwords that are stored in a secure location.
* `{ref:sourceId}` - the value becomes a reference to another source. Some sources function as filters/converters, pulling data internally from other sources and converting the result on the fly. For example, the [overzoom](https://github.com/kartotherian/kartotherian-overzoom) source pulls data from another source, and if it's not available, tries to find a lower-zoom tile above the given one, and extract a portion of it. Internally, it uses a forwarding sourceref: source.
```
oz:
  uri: overzoom://
  # this adds a query parameter to uri: ?source=sourceref:///?ref=gen with proper escaping
  param:
    source: {ref: gen}
```
* `{npm: ['npm-module-name', 'subdir', 'subdir', 'filename']}`
Some files may be located inside the NPM modules added to the Kartotherian project, i.e. [osm-bright-source](https://github.com/kartotherian/osm-bright.tm2source). To reference a file inside npm, set npm's value to an array, with the first value being the name of the npm module (resolves to the root of the npm module), and all subsequent strings being subdirs and lastly - the name of the file. Subdirs may be ommited:
```
# resolves to a rooted path ..../node_modules/osm-bright-source/data.xml
npm: ["osm-bright-source", "data.xml"]
```

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
In browser, navigate to `localhost:4000/static`.

### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:
```
rm -r node_modules
npm install
```
