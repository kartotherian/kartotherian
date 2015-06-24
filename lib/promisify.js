'use strict';

var BBPromise = require('bluebird');
var zlib = require('zlib');

BBPromise.promisifyAll(require('tilelive'));
BBPromise.promisifyAll(require('tilelive-file').prototype);
BBPromise.promisifyAll(zlib);

var mapnik = require('mapnik');
BBPromise.promisifyAll(mapnik.Map.prototype);

//BBPromise.promisifyAll(require('tilelive'));
//BBPromise.promisifyAll(require('tilelive'));
//var filestore = require('tilelive-file');
//var tilelive = require('tilelive');
//var dynogen = require('./dynogen');
//var overzoomer = require('./overzoomer');


module.exports = {
    zlibGunzipAsync: BBPromise.promisify(zlib['gunzip']),
    zlibInflateAsync: BBPromise.promisify(zlib['inflate'])
};
