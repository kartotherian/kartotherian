'use strict';

let Promise = require('bluebird'),
    PbfSplicer = require('./PbfSplicer'),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator'),
    core;

function Babel(uri, callback) {
    let self = this,
        query;

    Promise.try(() => {
        query = checkType.normalizeUrl(uri).query;
        switch (uri.protocol) {
            case 'babel:':
                checkType(query, 'languages', 'string-array', true);
                break;
            case 'json2tags:':
                if (query.languages) {
                    throw new Err('languages parameter is not allowed for "json2tags" protocol');
                }
                break;
            default:
                throw new Error();
        }
        checkType(query, 'source', 'string', true);
        checkType(query, 'tag', 'string', 'name');
        return core.loadSource(query.source);
    }).then(source => {
        self.source = source;
        self.splicer = new PbfSplicer({
            languages: query.languages,
            nameTag: query.tag
        });
    }).return(this).nodeify(callback);
}

Babel.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return self.source
        .getTileAsync(z, x, y)
        .spread((data, headers) => {
            // TODO: decompressing and recompressing is inefficient
            return core
                .uncompressAsync(data)
                .then(data => core.compressPbfAsync2(self.splicer.processTile(data), headers));
        }).nodeify(callback, { spread: true });
};

Babel.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};

Babel.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['json2tags:'] = Babel;
    core.tilelive.protocols['babel:'] = Babel;
};

module.exports = Babel;
