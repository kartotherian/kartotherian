'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var mkdirp = require('mkdirp-then');
var fsp = require('fs-promise');
var path = require('path');
var tilelive = require('tilelive');
var bridge = require('tilelive-bridge');
var Vector = require('tilelive-vector');
var mapnik = require('mapnik');

var sUtil = require('../lib/util');

// shortcut
var HTTPError = sUtil.HTTPError;

var vectorSource;
var styleSource;
var conf;
var vectorHeaders = {'Content-Encoding': 'gzip'};
var router = sUtil.router();


function tmsource(options, callback) {
    callback(null, this);
}

tmsource.prototype.getTile = function(z, x, y, callback) {
    var state = setVectorPath({
        z: z,
        x: x,
        y: y
    });
    stateToPromise(state)
        .then(getDataFromStateAsync)
        .catch(function (err) {
            // Vector file does not exist, generate it
            return generateVector(state, err)
                .then(getDataFromStateAsync);
        })
        .then(function (data) {
            callback(null, data, vectorHeaders);
        }, function (err) {
            callback(err);
        });
};

tmsource.prototype.getGrid = function(z, x, y, callback) {
    callback(null);
};

tmsource.prototype.getInfo = function(callback) {
    callback(null, {});
};

function ensureDirAsync(state) {
    return mkdirp(state.dir).then(function() { return state; });
}

function sendReplyAsync(state) {
    return new BBPromise(function(resolve, reject) {
        var res = state.response;
        if (state.error) {
            throw Error(state.error);
        } else {
            if (state.data) {
                res.set(state.headers);
                res.send(state.data);
                resolve(state);
            } else {
                res.sendFile(state.path, {headers: state.headers}, function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(state);
                    }
                });
            }
        }
    });
}

function generateVector(state, err) {
    if (!conf.generateVectors) {
        if (err) {
            throw err;
        } else {
            throw Error('Dynamic vector generation is disabled');
        }
    }
    var statePromise = stateToPromise(state).then(getVectorTileAsync);
    if (conf.saveVectors) {
        // Save vector file to disk cache
        statePromise.then(ensureDirAsync)
            .then(writeVectorFileAsync);
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
                fsp.readFile(state.path).then(resolve, reject);
            }
        }
    });
}

function setVectorPath(state) {
    if (!state.dir) {
        state.dir = path.join(__dirname, '..', conf.vectorsDir, state.z.toString());
    }
    if (!state.path) {
        state.path = path.join(state.dir, state.x.toString() + '-' + state.y.toString() + '.pbf');
    }
    if (!state.format) {
        state.format = "vector.pbf";
    }
    if (!state.headers) {
        state.headers = vectorHeaders;
    }
    return state;
}

function stateToPromise(state) {
    // Ensure that this promise does not start until needed
    return new BBPromise(function(resolve/*, reject*/) {
        resolve(state);
    });
}

function getVectorTileAsync(state) {
    return getTileAsync(vectorSource, state);
}

function getImageTileAsync(state) {
    return getTileAsync(styleSource, state);
}

function getTileAsync(source, state) {
    return new BBPromise(function(resolve, reject) {
        source.getTile(state.z, state.x, state.y, function (err, tile, headers) {
            if (err) {
                reject(err);
            } else {
                state.data = tile;
                state.headers = headers;
                resolve(state);
            }
        });
    });
}

function writeVectorFileAsync(state) {
    return fsp
        .writeFile(state.path, state.data)
        .then(function() { return state; });
}

/**
 * Initialize module
 * @param app
 * app.conf object:
 *  generateVectors - boolean, true to allow dynamic vector generation when missing as files
 *  saveVectors - boolean, true ta allow dynamic vectors to be saved as files
 *  vectorsDir - string, path to the vector file storage
 * @returns {*}
 */
function init(app) {
    //app.set('json spaces', 4);
    conf = app.conf;

    if (typeof conf.generateVectors === 'undefined') {
        conf.generateVectors = true;
    }
    if (typeof conf.saveVectors === 'undefined') {
        conf.saveVectors = false;
    }
    if (typeof conf.vectorsDir === 'undefined') {
        conf.vectorsDir = false;
    }
    if (conf.saveVectors && !conf.vectorsDir) {
        throw new Error('vectorDir must be set if saveVectors is true');
    }
    if (conf.saveVectors && !conf.generateVectors) {
        throw new Error('generateVectors must be true when saveVectors is true');
    }

    bridge.registerProtocols(tilelive);
    tilelive.protocols['tmsource:'] = tmsource;
    mapnik.register_fonts(path.dirname(require.resolve('mapbox-studio-pro-fonts')), {recurse: true});
    mapnik.register_fonts(path.dirname(require.resolve('mapbox-studio-default-fonts')), {recurse: true});

    return new BBPromise(function (fulfill, reject) {
        tilelive.load('bridge://' + path.join(__dirname, '..', conf.data), function (err, source) {
            if (err)
                return reject(err);
            else {
                vectorSource = source;
                return fulfill(true);
            }
        });
    }).then(function () {
            return new BBPromise(function (resolve, reject) {
                new Vector('file://' + path.join(__dirname, '..', conf.style), function (err, p) {
                    if (err) {
                        return reject(err);
                    } else {
                        styleSource = p;
                        return resolve(true);
                    }
                });
            });
        });
}

/**
 * Web server (express) route handler to get requested tile
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function getTile(req, res, next) {
    // TODO: scaling is not implemented yet
    var scale = (req.params.scale) ? req.params.scale[1] | 0 : undefined;
    scale = scale > 4 ? 4 : scale; // limits scale to 4x (1024 x 1024 tiles or 288dpi)

    var format = req.params.format;

    var state = {
        z: req.params.z | 0,
        x: req.params.x | 0,
        y: req.params.y | 0,
        scale: scale,
        format: format,
        response: res
    };

    switch(format) {
        case 'vector.pbf':
            // If vector storage is set up, try to get vector tile there first
            // If missing, or no storage but can generate, generate it
            // If tile generated and conf.saveVectors is true, save it
            if (conf.vectorsDir) {
                return stateToPromise(state)
                    .then(setVectorPath)
                    .then(sendReplyAsync)
                    .catch(function(err) {
                        // Failed, probably due to missing vector file
                        return generateVector(state, err)
                            .then(sendReplyAsync)
                    });
            } else {
                return generateVector(state)
                    .then(sendReplyAsync);
            }
        case 'vector.pbf.generate':
            // Refresh vector tile if it doesn't exist
            if (!conf.vectorsDir || !conf.generateVectors || !conf.saveVectors) {
                throw new Error('Vector generation not enabled');
            }
            return stateToPromise(state)
                .then(setVectorPath)
                .then(function(state) {
                    return state.path;
                })
                .then(fsp.exists)
                .then(function(exists) {
                    if (exists) {
                        state.response.send('exists');
                        return true;
                    } else {
                        return generateVector(state)
                            .then(function (state) {
                                state.response.send('generated');
                            });
                    }
                });

        case 'vector.pbf.force':
            // Force-refresh tile
            if (!conf.vectorsDir || !conf.generateVectors || !conf.saveVectors) {
                throw new Error('Vector generation not enabled');
            }
            return generateVector(state)
                .then(function (state) {
                    state.response.send('generated');
                });
        case 'png':
            return stateToPromise(state)
                .then(getImageTileAsync)
                .then(sendReplyAsync);
        default:
            throw new Error('Unknown format');
    }
}

//function tile2(req, res, next) {
//
//    var done = function(err, data, headers) {
//        if (err && err.message === 'Tilesource not loaded') {
//            return res.redirect(req.path);
//        } else if (err) {
//            // Set errors cookie for this style.
//            style.error(id, err);
//            res.cookie('errors', _(style.error(id)).join('|'));
//            return next(err);
//        }
//
//        // If debug flag is set, reduce json data.
//        if (done.format === 'json' && 'debug' in req.query) {
//            data = _(data).reduce(function(memo, layer) {
//                memo[layer.name] = {
//                    features: layer.features.length,
//                    jsonsize: JSON.stringify(layer).length
//                };
//                return memo;
//            }, {});
//        }
//
//        headers['cache-control'] = 'max-age=3600';
//        if (req.params.format === 'vector.pbf') {
//            headers['Content-Encoding'] = 'gzip';
//        }
//        res.set(headers);
//        return res.send(data);
//    };
//    done.scale = scale;
//    if (req.params.format !== 'png') done.format = req.params.format;
//    source.getTile(z,x,y, done);
//}

router.get('/t/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w\\.]+)', getTile);
router.get('/t/:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x).:format([\\w\\.]+)', getTile);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
