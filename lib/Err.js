'use strict';

let util = require('util');

/**
 * Creates a formatted error info
 * @param message
 * @returns {Err}
 * @constructor
 */
function Err(message) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = arguments.length < 2 ? (message || 'unknown') : util.format.apply(null, arguments);
}

util.inherits(Err, Error);

Err.prototype.metrics = function(metrics) {
    this.metrics = metrics;
    return this;
};

module.exports = Err;
