const ls = require('language-scripts');
const dataOverrides = require('./overrides.json');

function LanguagePicker(lang = 'en', config = {}) {
  const scripts = ls.adjust({ override: dataOverrides });

  this.userLang = lang;
  this.nameTag = config.nameTag;
  // The prefix is either given or is the nameTag
  // with an underscore
  // See Babel.js#24
  this.prefix = config.multiTag || (this.nameTag && `${this.nameTag}_`) || '';

  // Store language script
  this.langScript = scripts[lang] || 'Latn';
  // Collect languages that have the same script as requested language
  this.languagesInScript = [];
  Object.keys(scripts).forEach((code) => {
    const langScript = scripts[code];
    if (langScript === this.langScript) {
      this.languagesInScript.push(code);
    }
  });

  // Add prefix to all languages if exists
  // eslint-disable-next-line arrow-body-style
  this.languagesInScript = this.languagesInScript.map((code) => {
    return code === this.nameTag ? code : this.prefix + code;
  });

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

      // 4. Another language with the same script
      for (const langCode of this.languagesInScript) {
        result = values[langCode];
        if (result) {
          return result;
        }
      }

      // 5. English
      result = values[this.prefixedEnglish];
      if (result) {
        return result;
      }

      // 6. Any language with suffix 'Latn'
      // Only do this if the script isn't already latin;
      // otherwise, we've done it in step 3
      if (this.langScript !== 'Latn') {
        for (const langCode of valueLangCodes) {
          // Latin or Romanized
          if (langCode.endsWith('-Latn')) {
            return values[langCode];
          }
        }
      }

      // 7. Look for known latinized codes
      // - Suffix of -rm
      // - Code 'zh_pinyin'
      for (const langCode of valueLangCodes) {
        // Romanized or Chinese Pinyin
        if (langCode.endsWith('_rm') || langCode === 'zh_pinyin') {
          return values[langCode];
        }
      }

      // If nothing is found:
      // - If there's a name tag, return it
      // - Otherwise, return the first found value
      return (this.nameTag && values[this.nameTag]) || firstFoundValue;
    },
  };
};

module.exports = LanguagePicker;
