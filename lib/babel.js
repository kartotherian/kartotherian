'use strict';

let Promise = require('bluebird'),
    PbfSplicer = require('./PbfSplicer'),
    core, Err;

function Xpander(uri, callback) {
    let self = this,
        query;

    Promise.try(function () {
        query = core.normalizeUri(uri).query;
        if (uri.protocol === 'babel:') {
            core.checkType(query, 'languages', 'string-array', true);
        } else {
            if (query.languages) throw new Err('languages parameter is not allowed for "json2tags" protocol');
        }
        core.checkType(query, 'source', 'string', true);
        core.checkType(query, 'tag', 'string', 'name');
        return core.loadSource(query.source);
    }).then(function (source) {
        self.source = source;
        self.splicer = new PbfSplicer({
            languages: query.languages,
            nameTag: query.tag
        });
    }).return(this).nodeify(callback);
}

Xpander.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return self.source
        .getTileAsync(z, x, y)
        .spread((data, headers) => {
            return core
                .uncompressAsync(data)
                .then(data => core.compressPbfAsync2(self.splicer.processTile(data), headers));
        }).nodeify(callback, {spread: true});
};

Xpander.prototype.getInfo = function(callback) {
    return this.source.getInfo(callback);
};

Xpander.initKartotherian = function(cor) {
    core = cor;
    Err = core.Err;
    core.tilelive.protocols['json2tags:'] = Xpander;
    core.tilelive.protocols['babel:'] = Xpander;
};

module.exports = Xpander;
