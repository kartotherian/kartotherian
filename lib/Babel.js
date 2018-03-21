const Promise = require('bluebird');
const PbfSplicer = require('./PbfSplicer');
const LanguagePicker = require('./LanguagePicker');
const Err = require('@kartotherian/err');
const checkType = require('@kartotherian/input-validator');
const uptile = require('tilelive-promise');
const fs = require('fs');

let core;

function Babel(uri, callback) {
  if (!new.target) {
    return new Babel(uri, callback);
  }

  let self = this;

  Promise.try(() => {
    self = uptile(self);
    const { query } = checkType.normalizeUrl(uri);
    checkType(query, 'source', 'string', true);
    checkType(query, 'tag', 'string', 'name');
    self.nameTag = query.tag;
    checkType(query, 'multiTag', 'string', `${self.nameTag}_`);
    self.multiTag = query.multiTag;
    checkType(query, 'keepUncompressed', 'boolean');
    self.keepUncompressed = query.keepUncompressed;

    switch (uri.protocol) {
      case 'babel:':
        checkType(query, 'combineName', 'boolean', false);
        self.combineName = query.combineName;

        checkType(query, 'defaultLanguage', 'string');
        if (query.languageMap) {
          if (typeof query.languageMap === 'string') {
            query.languageMap = JSON.parse(fs.readFileSync(query.languageMap, 'utf8'));
          }
          if (typeof query.languageMap === 'object' &&
            !Array.isArray(query.languageMap)
          ) {
            for (const lang of Object.keys(query.languageMap)) {
              const value = { languageMap: query.languageMap[lang] };
              checkType(value, 'languageMap', 'string-array', true);
              value.languageMap.unshift(lang);
              query.languageMap[lang] = value.languageMap;
            }
          } else {
            throw new Err('languageMap must be a dictionary of' +
              ' langCodes => [list of langs codes]');
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
          throw new Err('defaultLanguage and languageMap params ' +
            'are not allowed for "json2tags://" protocol');
        }
        self.pickLanguage = false;
        self.splicer = self._createSplicer();
        break;

      default:
        throw new Error('unknown protocol');
    }
    return core.loadSource(query.source);
  }).then((source) => {
    self.source = uptile(source);

    return self;
  }).nodeify(callback);
}

Babel.prototype.getAsync = function getAsync(opts) {
  const self = this;
  return self.source.getAsync(opts).then((res) => {
    switch (opts.type) {
      case undefined:
      case 'tile': {
        let p = core.uncompressAsync(res.data, res.headers).then((v) => {
          res.data = self._getSplicer(opts).processTile(v);
          return res;
        });
        if (!self.keepUncompressed) {
          p = p.then(core.compressPbfAsync);
        }
        return p;
      }
      default:
        return res;
    }
  });
};

Babel.prototype._getSplicer = function _getSplicer(opts) {
  checkType(opts, 'lang', 'string');
  if (!this.pickLanguage || !opts.lang) {
    return this.splicer;
  }

  let splicer = this.langSplicers[opts.lang];
  if (splicer === undefined) {
    splicer = this._createSplicer(opts.lang);
    if (Object.keys(this.langSplicers).length > 1000) {
      // Safety - ensure we don't consume too much memory
      // todo: consider using some LRU cache instead of
      //       flushing everything when it gets too big
      this.langSplicers = {};
    }
    this.langSplicers[opts.lang] = splicer;
  }

  return splicer;
};

Babel.prototype._createSplicer = function _createSplicer(langCode) {
  let namePicker;
  if (this.pickLanguage) {
    namePicker = new LanguagePicker(langCode, {
      nameTag: this.nameTag,
      multiTag: this.multiTag,
      languageMap: this.languageMap,
    });
  }
  return new PbfSplicer({
    nameTag: this.nameTag,
    multiTag: this.multiTag,
    namePicker,
    combineName: this.combineName,
  });
};


Babel.initKartotherian = function initKartotherian(cor) {
  core = cor;
  core.tilelive.protocols['json2tags:'] = Babel;
  core.tilelive.protocols['babel:'] = Babel;
};

module.exports = Babel;
