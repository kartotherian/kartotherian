'use strict';

var BBPromise = require('bluebird');

BBPromise.promisifyAll(require('tilelive'));
BBPromise.promisifyAll(require('tilelive-file').prototype);
BBPromise.promisifyAll(require('tilelive-bridge').prototype);
BBPromise.promisifyAll(require('./dynogen').prototype);
BBPromise.promisifyAll(require('./overzoomer').prototype);
BBPromise.promisifyAll(require('./cassandra').prototype);

BBPromise.promisifyAll(require('zlib'));
BBPromise.promisifyAll(require('fs'));

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.Map.prototype);
BBPromise.promisifyAll(mapnik.VectorTile.prototype);
