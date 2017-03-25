# Maps Tile service for Wikipedia

This code is cross-hosted at [gerrit](https://git.wikimedia.org/summary/maps%2Fkartotherian)

Maps nodejs server for vector-based tiles and snapshots, designed for Wikipedia and other sites. It ties together a number of [MapBox](https://github.com/mapbox) components for vector and raster rendering based on [Mapnik 3](https://github.com/mapnik/mapnik), and uses [service runner](https://github.com/wikimedia/service-runner) for scalability, performance monitoring and stability.

### Serving tiles
Kartotherian can serve vector and raster tiles in multiple formats and optional scaling:

    http://.../{source}/{zoom}/{x}/{y}[@{scale}x].{format}

* The sources are configured with the
[source config file](https://github.com/kartotherian/core). Sources configuration supports different methods of tile storage, such as Cassandra or files, generation from postgress db, overzoom to extract the tile from lower zooms if missing, layer extraction, mixing multiple sources together, etc.
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
Kartotherian can be used as a source of the PBF data for Mapbox studio. See info about style editing in  [osm-bright-source](https://github.com/kartotherian/osm-bright.tm2/blob/master/README.md). The info data is available at `http://.../{style}/pbfinfo.json` for pbf source, and `http://.../{style}/info.json` for the styled image source.

### Markers
Kartotherian can generate marker images by wrapping any of the [maki icons](https://www.mapbox.com/maki/) with a pushpin image, in any color. The URL schema is matched to the one used by the [mapbox.js](https://github.com/mapbox/mapbox.js).

    http://.../v4/marker/pin-l-cafe+de00ff@2x.png
    http://.../v4/marker/ {base} - {size:s|m|l} [-{letter-or-digit-or-icon-name}] + {color} [@2x] .png

At this point, only "pin" is supported for the base. The color is a 3 digit or 6 digit hex number. Optional scaling can only be 2x. Beyond the pre-defined maki icons, you may give a number (0-99), a single letter (a-z), or nothing.

## Very quick start

```
git clone https://github.com/kartotherian/kartotherian.git  # Clone the repository
cd kartotherian
```

Edit `package.json`
* **Add** these lines to the `dependencies` section:
```
    "tilejson": "*",
    "@kartotherian/tilelive-http": "^0.12.1",
```
* **Add** this line to the `registerSourceLibs` section:
```
    "@kartotherian/tilelive-http",
```
* **Remove** `kartotherian-geoshapes` line from `requestHandlers` section.

```
npm install
node server.js -c config.external.yaml
```

Browse to http://localhost:6533/
The set up inside [`sources.external.yaml`](sources.external.yaml) does not use any storage or caching, so it will not be suitable for production. You will need to to set up your own local database as described in [osm-bright.tm2source](https://github.com/kartotherian/osm-bright.tm2source), which is installed in `node_modules/osm-bright-source`, and configure additional source chains and setup a proper storage to make this into a production system.


## Configuration
Inside the `conf` key:
* `sources` - (required) Either a set of subkeys, a filename, or a list of file names.  See [core](https://github.com/kartotherian/core) on how to configure the sources.
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
* [kartotherian-core](https://github.com/kartotherian/core) - Loads and configures tile sources, and provides some common utility functions
* [kartotherian-server](https://github.com/kartotherian/server) - Handles user requests for tiles and source info, as well as registers additional data type handlers like maki markers and image snapshots.
* [kartotherian-maki](https://github.com/kartotherian/maki) - Request handler for maki markers - generates PNG marker images that can be used from geojson.
* [kartotherian-snapshot](https://github.com/kartotherian/snapshot) - Request handler for static images by combining multiple tiles into one snapshot image of a requested size.

#### Tile sources
* [kartotherian-autogen](https://github.com/kartotherian/autogen) - Tile source that checks "storage" source for a tile, and if not found, gets it from the "generator" source and saves it into the "storage"
* [kartotherian-cassandra](https://github.com/kartotherian/cassandra) - Tile source that stores tiles in the Cassandra database
* [kartotherian-demultiplexer](https://github.com/kartotherian/demultiplexer) - Tile source that combines multiple sources by zoom level
* [kartotherian-layermixer](https://github.com/kartotherian/layermixer) - Tile source capable of mixing different vector layers from multiple tile sources
* [kartotherian-overzoom](https://github.com/kartotherian/overzoom) - Tile source that will zoom out if the requested tile does not exist, and extracts the needed portion from the lower-zoom tile it finds.
* [kartotherian-postgres](https://github.com/kartotherian/postgres) - Tile source that stores tiles in the Postgres database
* [kartotherian-substantial](https://github.com/kartotherian/substantial) - Tile source that filters out tiles that are not significant - e.g. nothing but water or land.

#### Data and Styling
* [osm-bright-source](https://github.com/kartotherian/osm-bright.tm2source) - SQL queries used by the `tilelive-bridge` to generate a vector tile from Postgres Database
* [osm-bright-style](https://github.com/kartotherian/osm-bright.tm2) - Style used by the `tilelive-vector` to convert vector tiles into images.
* [osm-bright-fonts](https://github.com/kartotherian/osm-bright.fonts) - Fonts used by the `osm-bright-style`.


### Components by MapBox
* [tilelive](https://github.com/mapbox/tilelive) - ties together various tile sources, both vector and raster
* [tilelive-bridge](https://github.com/mapbox/tilelive-bridge) - generates vector tiles from SQL
* [tilelive-vector](https://github.com/mapbox/tilelive-vector) - converts vector tiles to raster tiles
* [abaculus](https://github.com/mapbox/abaculus) - generates raster images of any location and size from a tile source

### Other Relevant Components
* [mapnik](https://github.com/mapnik/node-mapnik) - Tile rendering library for node
* [leaflet](https://github.com/Leaflet/Leaflet) - JavaScript library for mobile-friendly interactive maps

## In depth step-by-step:

This documentation assumes that you are going to use [osm-bright.tm2](https://github.com/kartotherian/osm-bright.tm2) and [osm-bright.tm2source](https://github.com/kartotherian/osm-bright.tm2source) for a map style.

### Install dependencies

Kartotherian requires nodejs and npm. On Ubuntu these can be installed with
```
sudo apt-get install git unzip curl build-essential sqlite3 nodejs-legacy npm
```

### Get Kartotherian code

```
git clone https://github.com/kartotherian/kartotherian.git  # Clone the repository
cd kartotherian
npm install                                                 # install npm dependencies
```

### Source

Set up osm-bright.tm2source as described in [its documentation.](https://github.com/kartotherian/osm-bright.tm2source#install).

osm-bright.tm2source is installed in `node_modules/osm-bright-source`

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
