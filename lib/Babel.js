'use strict';

let Promise = require('bluebird'),
    PbfSplicer = require('./PbfSplicer'),
    Err = require('@kartotherian/err'),
    checkType = require('@kartotherian/input-validator'),
    zlib = Promise.promisifyAll(require('zlib')),
    uptile = require('tilelive-promise'),
    core;

function Babel(uri, callback) {
    if (!new.target) {
        return new Babel(uri, callback);
    }

    let self = this,
        query;

    Promise.try(() => {
        self = uptile(self);
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
        self.source = uptile(source);
        self.splicer = new PbfSplicer({
            languages: query.languages,
            nameTag: query.tag
        });
    }).return(this).nodeify(callback);
}

Babel.prototype.getAsync = function(opts) {
    const self = this;
    return self.source.getAsync(opts).then(
        res => {
            switch (opts.type) {
                case undefined:
                case 'tile':
                    let resultP;
                    const contentEnc = res.headers && res.headers['Content-Encoding'];
                    if (contentEnc && contentEnc === 'gzip') {
                        // Re-compression should be done by the final layer
                        delete res.headers['Content-Encoding'];
                        resultP = zlib.gunzipAsync(res.tile);
                    } else {
                        resultP = Promise.resolve(res.tile);
                    }
                    return resultP.then(v => {
                        res.tile = self.splicer.processTile(v);
                        return res;
                    });
            }
            return res;
        });
};

Babel.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['json2tags:'] = Babel;
    core.tilelive.protocols['babel:'] = Babel;
};

module.exports = Babel;
