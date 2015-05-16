'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var mkdirp = require('mkdirp-then');
var fsp = require('fs-promise');
var pathLib = require('path');
var tilelive = require('tilelive');
var bridge = require('tilelive-bridge');
var Vector = require('tilelive-vector');
var mapnik = require('mapnik');

var sUtil = require('../lib/util');

// shortcut
var HTTPError = sUtil.HTTPError;

var conf;
var vectorHeaders = {'Content-Encoding': 'gzip'};
var router = sUtil.router();

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
    if (!state.source.generate) {
        if (err) {
            throw err;
        } else {
            throw Error('Dynamic vector generation is disabled');
        }
    }
    var statePromise = stateToPromise(state);
    if (state.source.saveGenerated) {
        statePromise = statePromise.then(ensureDirAsync);
    }
    statePromise = statePromise.then(function(state) {
        return new BBPromise(function(resolve, reject) {
            state.source.source.getTile(state.z, state.x, state.y, function (err, tile, headers) {
                if (err) {
                    reject(err);
                } else {
                    state.data = tile;
                    state.headers = headers;
                    resolve(state);
                }
            });
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
                return fsp.writeFile(state.path, state.data)
            })
            .then(function() {
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

function stateToPromise(state) {
    // Ensure that this promise does not start until needed
    return new BBPromise(function(resolve/*, reject*/) {
        if (!state.source.style) {
            // This is a data source, set paths & headers
            if (!state.dir) {
                state.dir = pathLib.join(state.source.cacheDir, state.z.toString());
            }
            if (!state.path) {
                state.path = pathLib.join(state.dir, state.x.toString() + '-' + state.y.toString() + '.pbf');
            }
            if (!state.headers) {
                state.headers = vectorHeaders;
            }
        }
        resolve(state);
    });
}

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param path
 * @returns {*}
 */
function normalizePath(path) {
    return pathLib.resolve(__dirname, '..', path);
}

/**
 * Initialize module
 * @param app
 * @returns {*}
 */
function init(app) {
    //app.set('json spaces', 4);
    var log = app.logger.log.bind(app.logger);

    bridge.registerProtocols(tilelive);
    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-pro-fonts')), {recurse: true});
    mapnik.register_fonts(pathLib.dirname(require.resolve('mapbox-studio-default-fonts')), {recurse: true});
    tilelive.protocols['tmsource:'] = tmsource;

    // todo: need to crash if this fails to load
    loadConfiguration(app.conf)
        .then(function (c) {
            conf = c;
        });
}

function loadConfiguration(conf) {
    var hasSources = false,
        hasStyles = false;

    if (typeof conf.sources !== 'object')
        throw new Error('conf.sources must be an object');
    if (typeof conf.styles !== 'object')
        throw new Error('conf.styles must be an object');
    _.each(conf.sources, function (cfg, key) {
        hasSources = true;
        if (!/^\w+$/.test(key.toString()))
            throw new Error('conf.sources.' + key + ' key must contain chars and digits only');
        if (typeof cfg !== 'object')
            throw new Error('conf.sources.' + key + ' must be an object');
        if (typeof cfg.tm2source !== 'string')
            throw new Error('conf.sources.' + key + '.tm2source must be a string');
        cfg.tm2source = normalizePath(cfg.tm2source);
        if (typeof cfg.generate !== 'boolean')
            throw new Error('conf.sources.' + key + '.generate must be boolean');
        if (typeof cfg.saveGenerated !== 'boolean')
            throw new Error('conf.sources.' + key + '.saveGenerated must be boolean');
        if (cfg.saveGenerated && !cfg.generate)
            throw new Error('conf.sources.' + key + '.generate must be true when saveGenerated is true');

        if (typeof cfg.cacheBaseDir !== 'undefined') {
            if (typeof cfg.cacheBaseDir !== 'string')
                throw new Error('conf.sources.' + key + '.cacheBaseDir must be a string');
            cfg.cacheDir = pathLib.join(normalizePath(cfg.cacheBaseDir), key);
        } else if (cfg.saveGenerated) {
            throw new Error('conf.sources.' + key + '.cacheBaseDir must be set if saveGenerated is true');
        }
    });
    _.each(conf.styles, function (cfg, key) {
        hasStyles = true;
        if (!/^\w+$/.test(key.toString()))
            throw new Error('conf.styles.' + key + ' key must contain chars and digits only');
        if (conf.sources.hasOwnProperty(key))
            throw new Error('conf.styles.' + key + ' key already exists in conf.sources');
        if (typeof cfg !== 'object')
            throw new Error('conf.styles.' + key + ' must be an object');
        if (typeof cfg.tm2 !== 'string')
            throw new Error('conf.styles.' + key + '.tm2 must be a string');
        cfg.tm2 = normalizePath(cfg.tm2);
        if (typeof cfg.sourceId !== 'string' && typeof cfg.sourceId !== 'number')
            throw new Error('conf.styles.' + key + '.sourceId must be a string or a number');
        if (!conf.sources.hasOwnProperty(cfg.sourceId))
            throw new Error('conf.styles.' + key + '.sourceId "' + cfg.sourceId + '" does not exist in conf.sources');
    });
    if (!hasSources)
        throw new Error('conf.sources is empty');
    if (!hasStyles)
        throw new Error('conf.styles is empty');

    return BBPromise.all(_.map(conf.sources, function (cfg) {
        return new BBPromise(function (fulfill, reject) {
            tilelive.load('bridge://' + cfg.tm2source, function (err, source) {
                if (err) {
                    return reject(err);
                } else {
                    cfg.source = source;
                    return fulfill(true);
                }
            });
        });
    })).then(function () {
        return BBPromise.all(_.map(conf.styles, function (cfg) {
            return fsp
                .readFile(cfg.tm2, 'utf8')
                .then(function (xml) {
                    return new BBPromise(function (resolve, reject) {
                        // HACK: replace 'source' parameter with something we can recognize later
                        // Expected format:
                        // <Parameter name="source"><![CDATA[tmsource:///.../osm-bright.tm2source]]></Parameter>
                        var replCount = 0;
                        xml = xml.replace(
                            /(<Parameter name="source">)(<!\[CDATA\[)?(tmsource:\/\/\/)([^\n\]]*)(]]>)?(<\/Parameter>)/g,
                            function (whole, tag, cdata, prot, src, cdata2, tag2) {
                                replCount++;
                                return tag + cdata + prot + cfg.sourceId + cdata2 + tag2;
                            }
                        );
                        if (replCount !== 1) {
                            throw new Error('Unable to find "source" parameter in style ' + cfg.tm2);
                        }
                        new Vector({
                            xml: xml,
                            base: pathLib.dirname(cfg.tm2)
                        }, function (err, style) {
                            if (err) {
                                return reject(err);
                            } else {
                                cfg.style = style;
                                return resolve(true);
                            }
                        });
                    });
                });
        }))
    }).then(function () {
        return _.extend({
            cache: conf.cache,
        }, conf.sources, conf.styles);
    });
}

function getTileFromStore(state) {
    switch (state.format) {
        case 'vector.pbf':
            // If vector storage is set up, try to get vector tile there first
            // If missing, or no storage but can generate, generate it
            // If tile generated and source.saveGenerated is true, save it
            if (state.source.cacheDir) {
                return stateToPromise(state)
                    .then(sendReplyAsync)
                    .catch(function (err) {
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
            if (!state.source.saveGenerated)
                throw new Error('Vector generation not enabled');
            return stateToPromise(state)
                .then(function (state) { return state.path; })
                .then(fsp.exists)
                .then(function (exists) {
                    if (exists) {
                        state.response.send('exists');
                        return true;
                    } else {
                        return generateVector(state)
                            .then(function (state) { state.response.send('generated'); });
                    }
                });

        case 'vector.pbf.force':
            // Force-refresh tile
            if (!state.source.saveGenerated)
                throw new Error('Vector generation not enabled');
            return generateVector(state)
                .then(function (state) {
                    state.response.send('generated');
                });

        default:
            throw new Error('Unknown format');
    }
}

function getTileFromStyle(state) {
    switch (state.format) {
        case 'json':
            state.debugJson = 'debug' in req.query;
        // fallthrough
        case 'headers':
        case 'svg':
        case 'png':
        case 'jpeg':
            return stateToPromise(state)
                .then(function (state) {
                    return new BBPromise(function (resolve, reject) {
                        var callback = function (err, data, headers) {
                            if (err) {
                                reject(err);
                            } else {
                                if (state.debugJson) {
                                    data = _(data).reduce(function (memo, layer) {
                                        memo[layer.name] = {
                                            features: layer.features.length,
                                            jsonsize: JSON.stringify(layer).length
                                        };
                                        return memo;
                                    }, {});
                                }
                                state.data = data;
                                state.headers = headers;
                                resolve(state);
                            }
                        };
                        callback.scale = state.scale;
                        callback.format = state.format;
                        state.source.style.getTile(state.z, state.x, state.y, callback);
                    });
                })
                .then(sendReplyAsync);

        default:
            throw new Error('Unknown format');
    }
}
/**
 * Web server (express) route handler to get requested tile
 * @param req request object
 * @param res response object
 * @param next callback to call if this function cannot handle the request
 */
function getTile(req, res, next) {

    if (conf.cache) {
        res.header('Cache-Control', conf.cache);
    }

    var scale = (req.params.scale) ? req.params.scale[1] | 0 : undefined;
    scale = scale > 4 ? 4 : scale; // limits scale to 4x (1024 x 1024 tiles or 288dpi)

    if (!conf.hasOwnProperty(req.params.src)) {
        throw new Error('Unknown source');
    }
    var source = conf[req.params.src];

    var state = {
        source: source,
        z: req.params.z | 0,
        x: req.params.x | 0,
        y: req.params.y | 0,
        format: req.params.format,
        scale: scale,
        response: res
    };

    return !source.style ? getTileFromStore(state) : getTileFromStyle(state);
}

function tmsource(options, callback) {
    if (options.path[0] !== '/')
        throw new Error('Unexpected path ' + options.path);
    this.sourceId = options.path.substr(1);
    callback(null, this);
}

tmsource.prototype.getTile = function(z, x, y, callback) {
    if (!conf.hasOwnProperty(this.sourceId)) {
        return callback(new Error('Unknown source'));
    }

    var state = {source: conf[this.sourceId], z: z, x: x, y: y};
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


router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w\\.]+)', getTile);
router.get('/:src(\\w+)/:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x).:format([\\w\\.]+)', getTile);

module.exports = function(app) {

    init(app);

    return {
        path: '/',
        api_version: 1,
        skip_domain: true,
        router: router
    };

};
