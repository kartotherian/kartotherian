'use strict';

var BBPromise = require('bluebird');
var zlib = require('zlib');

BBPromise.promisifyAll(require('tilelive'));
module.exports = {
    zlibGunzipAsync: BBPromise.promisify(zlib['gunzip']),
    zlibInflateAsync: BBPromise.promisify(zlib['inflate'])
};
