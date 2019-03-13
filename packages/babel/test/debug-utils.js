/* eslint-disable import/no-extraneous-dependencies */

const Promise = require('bluebird');
const fs = require('fs');
const _ = require('underscore');
const tileCodec = require('../lib/tileCodec');
const toCompactJson = require('json-stringify-pretty-compact');
const toBuffer = require('typedarray-to-buffer');

// Enhance debugging
Promise.config({
  warnings: true,
  longStackTraces: true,
});

/**
 * Helper function to sort JSON objects recursivelly by key
 */
function sorter(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sorter);
  } else if (_.isObject(obj)) {
    const result = {};
    Object.keys(obj).sort().forEach((key) => {
      result[key] = sorter(obj[key]);
    });
    return result;
  }
  return obj;
}

exports.writeJson = function writeJson(path, obj) {
  fs.writeFileSync(path, toCompactJson(sorter(obj)));
};

exports.writePbf = function writePbf(path, data) {
  fs.writeFileSync(path, toBuffer(data), 'binary');
};

exports.decodeAndWrite = function decodeAndWrite(path, data) {
  exports.writejson(path, tileCodec.decodeTile(data));
};

exports.bufferEqual = function bufferEqual(buf1, buf2) {
  if (buf1.byteLength !== buf2.byteLength) return false;
  const arr1 = new Int8Array(buf1);
  const arr2 = new Int8Array(buf2);

  for (let i = 0; i < buf1.byteLength; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  return true;
};
