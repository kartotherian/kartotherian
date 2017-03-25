'use strict';

let _ = require('underscore'),
    qidx = require('quadtile-index'),
    qs = require('querystring'),
    urllib = require('url'),
    Err = require('@kartotherian/err');

module.exports = checkType;

function getDefault(obj, field, mustHave) {
    if (mustHave === true) {
        throw new Err('Value %j is missing', field);
    }
    if (mustHave === false || mustHave === undefined) {
        delete obj[field];
    } else {
        obj[field] = mustHave;
    }
    return false;
}

/**
 * Utility method to check the type of the object's property
 */
function checkType(obj, field, expType, mustHave, min, max) {
    let value = typeof (obj) === 'object' ? obj[field] : obj;
    if (value === undefined) {
        return getDefault(obj, field, mustHave);
    }
    // Try to convert value to expected type
    let type = expType[0] === '[' ? Object.prototype.toString.call(value) : typeof value;
    if (type === 'string') {
        switch (expType) {
            case 'number':
                value = checkType.strToFloat(value);
                type = typeof value;
                break;
            case 'integer':
            case 'zoom':
                obj[field] = value = checkType.strToInt(value);
                type = typeof value;
                break;
            case 'boolean':
                obj[field] = value = !!value;
                type = typeof value;
                break;
            case 'string-array':
                obj[field] = value = [value];
                type = typeof value;
                break;
            case 'number-array':
                value = checkType.strToFloat(value);
                type = typeof value;
                if (type === 'number') {
                    obj[field] = value = [value];
                }
                break;
        }
    } else if (type === 'number' && expType === 'number-array') {
        obj[field] = value = [value];
        type = typeof value;
    }

    // validate the type
    switch (expType) {
        case 'string-array':
            if (!Array.isArray(value) ||
                !_.all(value, v => typeof v === 'string' && v.length > 0)
            ) {
                throw new Err('Invalid %s param: expecting a string or an array of strings', field);
            }
            break;
        case 'number-array':
            let isValid = Array.isArray(value);
            if (isValid) {
                value = _.map(value, v => {
                    v = checkType.strToFloat(v);
                    if (typeof v !== 'number') {
                        isValid = false;
                    }
                    return v;
                });
            }
            if (!isValid) {
                throw new Err('Invalid %s param: expecting a number or an array of numbers', field);
            }
            obj[field] = value;
            break;
        case 'array':
            if (!Array.isArray(value)) {
                throw new Err('Invalid %s param type %s given, was expecting an array',
                    field, type);
            }
            break;
        case 'integer':
            if (!Number.isInteger(value)) {
                throw new Err('Invalid %s param type %s given, was expecting an integer',
                    field, type);
            }
            break;
        case 'zoom':
            if (!qidx.isValidZoom(value)) {
                throw new Err('Invalid %s param - an integer zoom value was expected', field);
            }
            break;
        default:
            if (type !== expType) {
                throw new Err('Invalid %s param type %s given, was expecting %s',
                    field, type, expType);
            }
            break;
    }

    // validate ranges
    switch (expType) {
        case 'number':
        case 'integer':
        case 'zoom':
            if (min !== undefined && value < min) {
                throw new Err('Invalid %s param - must be at least %d, but given %d',
                    field, min, value);
            }
            if (max !== undefined && value > max) {
                throw new Err('Invalid %s param - must be at most %d, but given %d',
                    field, max, value);
            }
            break;
        case 'string':
            if (min !== undefined && value.length < min) {
                throw new Err('Invalid %s param - the string must be at least %d symbols',
                    field, min);
            }
            break;
        case 'boolean':
            if (value === false) {
                // convert false into undefined
                delete obj[field];
                return false;
            }
            break;
        case 'string-array':
        case 'number-array':
            if (min !== undefined && value.length < min) {
                throw new Err('Invalid %s param - it must have at least %d values, but given %d',
                    field, min, value.length);
            }
            if (max !== undefined && value.length > max) {
                throw new Err('Invalid %s param - it must have at least %d values, but given %d',
                    field, max, value.length);
            }
            break;
    }

    return true;
}

/**
 * Magical float regex found in http://stackoverflow.com/a/21664614/177275
 * @type {RegExp}
 */
checkType.floatRe = /^-?\d+(?:[.,]\d*?)?$/;

/**
 * Converts value to float if possible, or returns the original
 */
checkType.strToFloat = function strToFloat(value) {
    if (typeof value === 'string' && checkType.floatRe.test(value)) {
        return parseFloat(value);
    }
    return value;
};


/**
 * Magical int regex
 * @type {RegExp}
 */
const intRe = /^-?\d+$/;

/**
 * Converts value to integer if possible, or returns the original
 */
checkType.strToInt = function strToInt(value) {
    if (typeof value === 'string' && intRe.test(value)) {
        return parseInt(value);
    }
    return value;
};

/**
 * Parse and normalize URI, ensuring it returns an object with query object field
 * @param uri
 * @returns {*}
 */
checkType.normalizeUrl = function normalizeUrl(uri) {
    if (typeof uri === 'string') {
        uri = urllib.parse(uri, true);
    } else if (typeof uri.query === 'string') {
        uri.query = qs.parse(uri.query);
    }
    uri.query = uri.query || {};
    return uri;
};
