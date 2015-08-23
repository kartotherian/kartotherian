'use strict';

var BBPromise = require('bluebird');
var _ = require('underscore');
var core = require('kartotherian-core');
var Err = core.Err;


function Autogen(uri, callback) {
    var self = this;
    BBPromise.try(function () {
        uri = core.normalizeUri(uri);
        core.checkType(uri.query, 'mingen', 'zoom');
        self.mingen = uri.query.mingen;
        core.checkType(uri.query, 'maxgen', 'zoom');
        self.maxgen = uri.query.maxgen;
        core.checkType(uri.query, 'minstore', 'zoom');
        self.minstore = uri.query.minstore;
        core.checkType(uri.query, 'maxstore', 'zoom');
        self.maxstore = uri.query.maxstore;
        core.checkType(uri.query, 'storage', 'string', true);
        core.checkType(uri.query, 'generator', 'string', true);
        return Autogen._tilelive.loadAsync(uri.query.storage);
    }).then(function (storage) {
        self.storage = storage;
        return Autogen._tilelive.loadAsync(uri.query.generator);
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


Autogen.registerProtocols = function(tilelive) {
    Autogen._tilelive = tilelive;
    tilelive.protocols['layermixer:'] = Autogen;
};

module.exports = Autogen;
