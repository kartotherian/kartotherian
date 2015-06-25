'use strict';

var BBPromise = require('bluebird');

BBPromise.promisifyAll(require('tilelive'));
BBPromise.promisifyAll(require('tilelive-file').prototype);
BBPromise.promisifyAll(require('zlib'));

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.Map.prototype);
BBPromise.promisifyAll(mapnik.VectorTile.prototype);
