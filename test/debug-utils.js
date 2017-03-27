'use strict';

let Promise = require('bluebird'),
    fs = require('fs'),
    _ = require('underscore'),
    tileCodec = require('../lib/tileCodec'),
    toCompactJson = require('json-stringify-pretty-compact'),
    toBuffer = require('typedarray-to-buffer');

// Enhance debugging
Promise.config({
    warnings: true,
    longStackTraces: true
});

exports.writeJson = function (path, obj) {
    fs.writeFileSync(path, toCompactJson(sorter(obj)));
};

exports.writePbf = function (path, data) {
    fs.writeFileSync(path, toBuffer(data), 'binary');
};

exports.decodeAndWrite = function (path, data) {
    exports.writejson(path, tileCodec.decodeTile(data));
};

/**
 * Helper function to sort JSON objects recursivelly by key
 */
function sorter(obj) {
    if (Array.isArray(obj)) {
        return obj.map(sorter);
    } else if (_.isObject(obj)) {
        let result = {};
        Object.keys(obj).sort().forEach(key => {
            result[key] = sorter(obj[key]);
        });
        return result;
    } else {
        return obj;
    }
}

exports.bufferEqual = function (buf1, buf2) {
    if (buf1.byteLength !== buf2.byteLength) return false;
    let arr1 = new Int8Array(buf1),
        arr2 = new Int8Array(buf2);
    for (let i = 0; i < buf1.byteLength; i++) {
        if (arr1[i] !== arr2[i]) {
            return false;
        }
    }
    return true;
};
