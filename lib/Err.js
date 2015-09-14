'use strict';

var util = require('util');

/**
 * Creates a formatted error info
 * @param message
 * @returns {Err}
 * @constructor
 */
module.exports = function Err(message) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = arguments.length < 2 ? (message || 'unknown') : util.format.apply(null, arguments);
};

module.exports.prototype.metrics = function(metrics) {
    this.metrics = metrics;
    return this;
};

util.inherits(module.exports, Error);
