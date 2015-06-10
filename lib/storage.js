'use strict';

var BBPromise = require('bluebird');
var mkdirp = require('mkdirp-then');
var fsp = require('fs-promise');
var pathLib = require('path');

function ensureDirAsync(state) {
    return mkdirp(state.dir).then(function() { return state; });
}

function initState(state) {
    if (state.source.cacheDir) {
        if (!state.dir) {
            state.dir = pathLib.join(state.source.cacheDir, state.z.toString());
        }
        if (!state.path) {
            state.path = pathLib.join(state.dir, state.x.toString() + '-' + state.y.toString() + '.pbf');
        }
    }
}

// Refresh tile if it doesn't exist
function ensureVectorExists(state) {
    if (!state.source.saveGenerated)
        throw new Error('Tile generation not enabled');
    return state.regenerate
        ? generateVector(state)
        : fsp.exists(state.path).then(function (exists) {
            if (exists) {
                state.storageState = 'exists';
                return state;
            } else {
                return generateVector(state);
            }
        });
}

function generateVector(state) {
    if (!state.source.generate) {
        throw Error('Vector generation is disabled');
    }
    var statePromise = BBPromise.resolve(state);
    if (state.source.saveGenerated) {
        statePromise = statePromise.then(ensureDirAsync);
    }
    statePromise = statePromise.then(function(state) {
        return new BBPromise(function(resolve, reject) {
            var callback = function (err, tile, headers) {
                if (err) {
                    reject(err);
                } else {
                    state.data = tile;
                    state.headers = headers;
                    resolve(state);
                }
            };
            if (state.isRaster) {
                callback.scale = state.scale || 1;
                callback.format = state.format;
            }
            state.source.source.getTile(state.z, state.x, state.y, callback);
        });
    });
    if (state.source.saveGenerated) {
        statePromise = statePromise
            .catch(function(err){
                if (err.message === 'Tile does not exist') {
                    state.data = '';
                    return state;
                } else {
                    throw err;
                }
            })
            .then(function(state) {
                return fsp.writeFile(state.path, state.data);
            })
            .then(function() {
                state.storageState = 'generated';
                return state;
            });
    }
    return statePromise;
}

function getDataFromStateAsync(state) {
    return new BBPromise(function(resolve, reject) {
        if (state.error) {
            reject(state.error);
        } else {
            if (state.data) {
                resolve(state.data);
            } else {
                return fsp
                    .stat(state.path)
                    .then(function(info) {
                        if (info.size === 0) {
                            resolve('');
                        } else {
                            resolve(fsp.readFile(state.path));
                        }
                    })
                    .catch(reject);
            }
        }
    });
}

function sendResponse(state) {
    return new BBPromise(function(resolve, reject) {
        state.response.sendFile(state.path, {headers: state.headers}, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(state);
            }
        });
    });
}


module.exports = {
    initState: initState,
    ensureVectorExists: ensureVectorExists,
    generateVector: generateVector,
    getDataFromStateAsync: getDataFromStateAsync,
    sendResponse: sendResponse
};

