'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var core, Err;

function Autogen(uri, callback) {
    var self = this;
    var query;
    BBPromise.try(function () {
        query = core.normalizeUri(uri).query;
        core.checkType(query, 'mingen', 'zoom');
        self.mingen = query.mingen;
        core.checkType(query, 'maxgen', 'zoom');
        self.maxgen = query.maxgen;
        core.checkType(query, 'minstore', 'zoom');
        self.minstore = query.minstore;
        core.checkType(query, 'maxstore', 'zoom');
        self.maxstore = query.maxstore;
        core.checkType(query, 'storage', 'string', true);
        core.checkType(query, 'generator', 'string', true);
        return core.loadSource(query.storage);
    }).then(function (storage) {
        self.storage = storage;
        return core.loadSource(query.generator);
    }).then(function (generator) {
        self.generator = generator;
    }).return(this).nodeify(callback);
}

Autogen.prototype.getTile = function(z, x, y, callback) {
    var self = this;
    return self.storage
        .getTileAsync(z, x, y)
        .catch(function (err) {
            if ((self.mingen !== undefined && z < self.mingen) ||
                (self.maxgen !== undefined && z > self.maxgen) ||
                !core.isNoTileError(err)
            ) {
                throw err;
            }
            var p = self.generator.getTileAsync(z, x, y);
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
    Err = core.Err;
    core.tilelive.protocols['autogen:'] = Autogen;
};

module.exports = Autogen;
