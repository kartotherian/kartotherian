const ls = require('language-scripts');
const dataOverrides = require('./overrides.json');

/**
 * Define a language picker with fallback rules.
 *
 * @param {String} [lang='en'] Requested language.
 * @param {Object} [config] Optional configuration object
 * @cfg {string} [nameTag] A tag that defines the local value in a label.
 *  If specified, will also be used as the prefix for other languages if
 *  a prefix is not already specified with `multiTag`.
 * @cfg {string} [multiTag] A specified prefix for the language keys
 * @cfg {Object} [languageMap] An object representing language fallbacks; languages
 *  may have more than one fallback, represented in a string or an array of strings.
 *  Example:
 *  {
 *    'langA': [ 'lang1', 'lang2' ]
 *    'langB': 'lang3'
 *  }
 * @cfg {boolean} [forceLocal] Force the system to fetch a local representation
 *  of the labels, if it exists. This will only work if there is a nameTag specified,
 *  since that tag dictates the key of the local value. If the value doesn't exist
 *  or if the nameTag is not specified, the system will return the first value given.
 *  Note: All fallbacks are skipped if this parameter is truthy!
 * @constructor
 */
function LanguagePicker(lang = 'en', config = {}) {
  const scripts = ls.adjust({ override: dataOverrides });

  this.userLang = lang;
  this.nameTag = config.nameTag;
  // The prefix is either given or is the nameTag
  // with an underscore
  // See Babel.js#24
  this.prefix = config.multiTag || (this.nameTag && `${this.nameTag}_`) || '';
  this.forceLocal = !!config.forceLocal;

  if (this.forceLocal) {
    // If we are forcing a local language, we don't need
    // any of the fallback calculations
    return;
  }
  // Store language script
  this.langScript = scripts[lang] || 'Latn';

  // Add known fallbacks for the language
  let fallbacks;
  if (config.languageMap) {
    fallbacks = config.languageMap[lang];
    if (fallbacks && !Array.isArray(fallbacks)) {
      fallbacks = [fallbacks];
    }
  }
  if (!fallbacks) {
    fallbacks = [];
  }

  // Use the given language as first choice
  fallbacks = [lang].concat(fallbacks);

  // Remove duplicates
  fallbacks = fallbacks.filter((item, i) => fallbacks.indexOf(item) === i);

  // Add prefix to all languages if exists
  // eslint-disable-next-line arrow-body-style
  fallbacks = fallbacks.map((code) => {
    return code === this.nameTag ? code : this.prefix + code;
  });

  // Store initial fallbacks
  this.fallbacks = fallbacks;

  this.prefixedEnglish = this.prefix ? `${this.prefix}en` : 'en';
  this.prefixedLangScript = `-${this.langScript}`;
}

/**
 * Create a processor for analyzing the values of a label
 *
 * @return {Object}
 * @return {Function} return.addValue Add a label language/value pair
 *  to this label consideration. Accepts string parameters 'lang' and 'value'
 *  for the pair.
 * @return {Function} return.getResult Get the best value from the stored
 *  language/value pairs for the label, according to the fallback consideration
 *  of the requested language.
 */
LanguagePicker.prototype.newProcessor = function newProcessor() {
  // These variables are the only "per-processor" state
  // The processor must not modify any this.* values
  let firstFoundValue;
  const values = {};

  return {
    addValue: (lang, value) => {
      values[lang] = value;

      if (firstFoundValue === undefined) {
        firstFoundValue = value;
      }
    },
    getResult: () => {
      let result;

      if (!this.forceLocal) {
        // Get the best value from the best language fallback:
        // 1. Requested language
        result = values[this.userLang];
        if (result) {
          return result;
        }

        // 2. Fallback language from fallbacks.json
        for (const fallback of this.fallbacks) {
          result = values[fallback];
          if (result) {
            return result;
          }
        }

        // 3. Any language with suffix of same script as requested language
        const valueLangCodes = Object.keys(values);
        for (const langCode of valueLangCodes) {
          if (langCode.endsWith(this.prefixedLangScript)) {
            return values[langCode];
          }
        }

        // 4. If we requested a language that is in Latin script
        // let's try to latinize the content. We only do that if
        // the requested language is Latin already; Otherwise
        // we want to fallback to the local script instead of
        // assuming latinization is expected
        if (this.langScript === 'Latn') {
          // Look for known latinized codes
          // - Suffix of _rm
          // - Code 'zh_pinyin'
          // Romanized or Chinese Pinyin
          for (const langCode of valueLangCodes) {
            // Look for language that is romanized (xx_rm), but not
            // specifically 'Romansh' which has the language code 'rm'
            if ((langCode.endsWith('_rm') && langCode !== `${this.prefix}rm`) ||
            langCode === 'zh_pinyin'
            ) {
              return values[langCode];
            }
          }
        }
      }

      // If nothing is found, return the local label if it exists
      return this.nameTag && values[this.nameTag];
    },
  };
};

module.exports = LanguagePicker;
