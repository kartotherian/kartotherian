# Server for map tiles

Maps server for vector-based tiles, targeting Wikipedia and other sites. It ties together a number of MapBox components for vector and raster rendering.

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

Run karthotherian:
```
npm start
```


### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:

```
rm -r node_modules
npm install
```
