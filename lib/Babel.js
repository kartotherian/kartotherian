const Promise = require('bluebird');
const PbfSplicer = require('./PbfSplicer');
const LanguagePicker = require('./LanguagePicker');
const Err = require('@kartotherian/err');
const checkType = require('@kartotherian/input-validator');
const uptile = require('tilelive-promise');

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
        self.langSplicers = {};
        self.pickLanguage = true;
        self.splicer = self._createSplicer(query.defaultLanguage);
        break;

      case 'json2tags:':
        if (query.defaultLanguage) {
          throw new Err('defaultLanguage param ' +
            'is not allowed for "json2tags://" protocol');
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
    if (Object.keys(this.langSplicers) > 1000) {
      // Safety - ensure we don't consume too much memory
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
