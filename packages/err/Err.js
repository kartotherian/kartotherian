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
    this.message = arguments.length < 2
        ? (message || 'unknown')
        : util.format.apply(null, arguments);
}

util.inherits(Err, Error);

Err.prototype.metrics = function(metrics) {
    this.metrics = metrics;
    return this;
};

/**
 * Throw "standard" tile does not exist error.
 * The error message string is often used to check if tile existance, so it has to be exact
 */
Err.throwNoTile = function throwNoTile() {
    throw new Error('Tile does not exist');
};

/**
 * Checks if the error indicates the tile does not exist
 */
Err.isNoTileError = function isNoTileError(err) {
    return err.message === 'Tile does not exist';
};


module.exports = Err;
