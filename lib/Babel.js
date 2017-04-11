'use strict';

const Promise = require('bluebird');
const PbfSplicer = require('./PbfSplicer');
const LanguagePicker = require('./LanguagePicker');
const Err = require('@kartotherian/err');
const checkType = require('@kartotherian/input-validator');
const zlib = Promise.promisifyAll(require('zlib'));
const uptile = require('tilelive-promise');

let core;

function Babel(uri, callback) {
    if (!new.target) {
        return new Babel(uri, callback);
    }

    let self = this;

    Promise.try(() => {
        self = uptile(self);
        const query = checkType.normalizeUrl(uri).query;
        checkType(query, 'source', 'string', true);
        checkType(query, 'tag', 'string', 'name');
        self.nameTag = query.tag;
        checkType(query, 'multiTag', 'string', self.nameTag + '_');
        self.multiTag = query.multiTag;

        switch (uri.protocol) {
            case 'babel:':
                checkType(query, 'defaultLanguage', 'string');
                if (query.languageMap) {
                    if (typeof query.languageMap === 'string') {
                        query.languageMap = require(query.languageMap);
                    }
                    if (typeof query.languageMap === 'object' && !Array.isArray(query.languageMap)) {
                        for (const lang of Object.keys(query.languageMap)) {
                            let value = {languageMap: query.languageMap[lang]};
                            checkType(value, 'languageMap', 'string-array', true);
                            value.languageMap.unshift(lang);
                            query.languageMap[lang] = value.languageMap;
                        }
                    } else {
                        throw new Err('languageMap must be a dictionary of langCodes => [list of lang codes]');
                    }
                    self.languageMap = query.languageMap;
                } else {
                    self.languageMap = {};
                }
                self.langSplicers = {};
                self.pickLanguage = true;
                self.splicer = self._createSplicer(query.defaultLanguage);
                break;
            case 'json2tags:':
                if (query.defaultLanguage || query.languageMap) {
                    throw new Err('defaultLanguage and languageMap parameters are not allowed for "json2tags" protocol');
                }
                self.pickLanguage = false;
                self.splicer = self._createSplicer();
                break;
            default:
                throw new Error('unknown protocol');
        }
        return core.loadSource(query.source);
    }).then(source => {
        self.source = uptile(source);

        return self;
    }).nodeify(callback);
}

Babel.prototype.getAsync = function (opts) {
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
                        res.tile = self._getSplicer(opts).processTile(v);
                        return res;
                    });
            }
            return res;
        });
};

Babel.prototype._getSplicer = function (opts) {
    checkType(opts, 'lang', 'string');
    if (!this.pickLanguage || !opts.lang) {
        return this.splicer;
    }

    let splicer = this.langSplicers[opts.lang];
    if (splicer === undefined) {
        splicer = this._createSplicer(opts.lang);
        if (Object.keys(this.langSplicers) > 1000) {
            // Safety - ensure we don't consume too much memory
            this.langSplicers = {};
        }
        this.langSplicers[opts.lang] = splicer;
    }

    return splicer;
};

Babel.prototype._createSplicer = function (langCode) {
    let namePicker;
    if (this.pickLanguage) {
        namePicker = new LanguagePicker({
            nameTag: this.nameTag,
            multiTag: this.multiTag,
            languages: (langCode && (this.languageMap[langCode] || [langCode])) || []
        });
    }
    return new PbfSplicer({
        nameTag: this.nameTag,
        multiTag: this.multiTag,
        namePicker: namePicker
    });
};


Babel.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['json2tags:'] = Babel;
    core.tilelive.protocols['babel:'] = Babel;
};

module.exports = Babel;
