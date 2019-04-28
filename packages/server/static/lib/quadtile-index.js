require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({"quadtile-index":[function(require,module,exports){
'use strict';

/**
 * Maximum supported zoom level (26)
 */
const maxZoom = 26;
exports.maxZoom = maxZoom;

/**
 * Maximum x or y coordinate for the maximum zoom level
 */
const maxXY = Math.pow(2, maxZoom) - 1;

/**
 * Maximum index for the maximum zoom level
 */
const maxIndex = Math.pow(4, maxZoom) - 1;


/**
 * Tests if x or y coordinate is valid for the given zoom
 * @param {number} value
 * @param {number} [zoom] if not given, uses maxZoom
 * @return {boolean}
 */
exports.isValidCoordinate = function isValidCoordinate(value, zoom) {
    return Number.isInteger(value) && 0 <= value && (
            zoom === undefined
                ? value <= maxXY
                : exports.isValidZoom(zoom) && value < Math.pow(2, zoom)
        );
};

/**
 * Tests if index is valid for the given zoom
 * @param {number} index
 * @param {number} [zoom] if not given, uses maxZoom
 * @return {boolean}
 */
exports.isValidIndex = function isValidIndex(index, zoom) {
    return Number.isInteger(index) && 0 <= index && (
            zoom === undefined
                ? index <= maxIndex
                : exports.isValidZoom(zoom) && index < Math.pow(4, zoom)
        );
};

/**
 * Tests if zoom is valid. Zoom may not exceed 26 because the index coordinate we use
 * will exceed the largest JavaScript int of 2^53  (which is 4^26)
 * @param {number} zoom
 * @return {boolean}
 */
exports.isValidZoom = function isValidZoom(zoom) {
    return Number.isInteger(zoom) && 0 <= zoom && zoom <= maxZoom;
};

/**
 * Convert x,y into a single integer with alternating bits
 * @param {number} x
 * @param {number} y
 * @param {number} [zoom] optional zoom level to validate x,y coordinates
 * @return {number}
 */
exports.xyToIndex = function xyToIndex(x, y, zoom) {
    if (!exports.isValidCoordinate(x, zoom) || !exports.isValidCoordinate(y, zoom)) {
        throw new Error(`Invalid X,Y coordinates ${x}, ${y}`);
    }

    let result = expandEven26(x & 0x1fff) + expandEven26(y & 0x1fff) * 2;
    if (x >= 0x2000) {
        result += expandEven26((x & 0x3ffe000) >> 13) * (1 << 26);
    }
    if (y >= 0x2000) {
        result += expandEven26((y & 0x3ffe000) >> 13) * (1 << 27);
    }
    return result;
};

/**
 * Convert index into the x,y coordinates
 * @param {number} index
 * @param {number} [zoom] optional zoom level to validate x,y coordinates
 * @return {number[]} returns a two value array as [x,y]
 */
exports.indexToXY = function indexToXY(index, zoom) {
    if (!exports.isValidIndex(index, zoom)) {
        throw new Error(`Invalid index ${index}`);
    }

    if (index < (1 << 26)) {
        return [compactEven26(index), compactEven26(index >> 1)];
    }

    let low = (index % (1 << 26)) | 0,
        high = (index / (1 << 26)) | 0;
    return [compactEven26(high) * (1 << 13) + compactEven26(low),
        compactEven26(high >> 1) * (1 << 13) + compactEven26(low >> 1)];
};


/**
 * Fast function to extract all even (0th, 2nd, 4th, ..., 24th) bits, and compact them together
 * into a single 13bit number (0->0, 2->1, 4->2, ..., 24->12).
 * @param {number} value integer within the range 0..2^26-1
 * @return {number}
 */
function compactEven26(value) {
    value = value | 0;
    return (value & 1)
        | (value & 1 << 2) >> 1
        | (value & 1 << 4) >> 2
        | (value & 1 << 6) >> 3
        | (value & 1 << 8) >> 4
        | (value & 1 << 10) >> 5
        | (value & 1 << 12) >> 6
        | (value & 1 << 14) >> 7
        | (value & 1 << 16) >> 8
        | (value & 1 << 18) >> 9
        | (value & 1 << 20) >> 10
        | (value & 1 << 22) >> 11
        | (value & 1 << 24) >> 12;
}

/**
 * Fast function to extract first 13 bits and expand them to use every other bit slot,
 * into a 26bit number (0->0, 1->2, 2->4, ..., 12->24).
 * @param {number} value integer within the range 0..2^13-1
 * @return {number}
 */
function expandEven26(value) {
    value = value | 0;
    return (value & 1)
        | (value & 1 << 1) << 1
        | (value & 1 << 2) << 2
        | (value & 1 << 3) << 3
        | (value & 1 << 4) << 4
        | (value & 1 << 5) << 5
        | (value & 1 << 6) << 6
        | (value & 1 << 7) << 7
        | (value & 1 << 8) << 8
        | (value & 1 << 9) << 9
        | (value & 1 << 10) << 10
        | (value & 1 << 11) << 11
        | (value & 1 << 12) << 12;
}

},{}]},{},[]);
