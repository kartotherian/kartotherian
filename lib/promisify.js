'use strict';

var BBPromise = require('bluebird');
var zlib = require('zlib');

BBPromise.promisifyAll(require('tilelive'));
BBPromise.promisifyAll(require('tilelive-file').prototype);
BBPromise.promisifyAll(zlib);

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.Map.prototype);
BBPromise.promisifyAll(mapnik.VectorTile.prototype);

module.exports = {
    zlibGunzipAsync: BBPromise.promisify(zlib['gunzip']),
    zlibInflateAsync: BBPromise.promisify(zlib['inflate'])
};
