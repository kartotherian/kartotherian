'use strict';

let BBPromise = require('bluebird'),
    checkType = require('kartotherian-input-validator'),
    core;

function Autogen(uri, callback) {
    let self = this,
        query;
    BBPromise.try(function () {
        query = core.normalizeUri(uri).query;
        checkType(query, 'mingen', 'zoom');
        self.mingen = query.mingen;
        checkType(query, 'maxgen', 'zoom');
        self.maxgen = query.maxgen;
        checkType(query, 'minstore', 'zoom');
        self.minstore = query.minstore;
        checkType(query, 'maxstore', 'zoom');
        self.maxstore = query.maxstore;
        checkType(query, 'storage', 'string', true);
        checkType(query, 'generator', 'string', true);
        return core.loadSource(query.storage);
    }).then(function (storage) {
        self.storage = storage;
        return core.loadSource(query.generator);
    }).then(function (generator) {
        self.generator = generator;
    }).return(this).nodeify(callback);
}

Autogen.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return self.storage
        .getTileAsync(z, x, y)
        .catch(function (err) {
            if ((self.mingen !== undefined && z < self.mingen) ||
                (self.maxgen !== undefined && z > self.maxgen) ||
                !core.isNoTileError(err)
            ) {
                throw err;
            }
            let p = self.generator.getTileAsync(z, x, y);
            if ((self.minstore === undefined || z >= self.minstore) && (self.maxstore === undefined || z <= self.maxstore)) {
                p = p.spread(function (tile, headers) {
                    return self.storage.putTileAsync(z, x, y, tile)
                        .catch(function (err) {
                            core.log('error', err); // log and ignore
                        }).return([tile, headers]);
                });
            }
            return p;
        }).nodeify(callback, {spread: true});
};

Autogen.prototype.getInfo = function(callback) {
    return this.storage.getInfo(callback);
};


Autogen.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['autogen:'] = Autogen;
};

module.exports = Autogen;
