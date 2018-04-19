const ls = require('language-scripts');
const dataOverrides = require('./overrides.json');

function LanguagePicker(lang = 'en', config = {}) {
  let fallbackMap = {};
  let fallbacks = [];
  const scripts = ls.adjust({ override: dataOverrides });

  this.userLang = lang;
  this.values = {};
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
  fallbackMap = config.languageMap || {};
  if (fallbackMap[lang]) {
    fallbacks = Array.isArray(fallbackMap[lang]) ?
      fallbackMap[lang] : [fallbackMap[lang]];
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
}

LanguagePicker.prototype.newProcessor = function newProcessor() {
  let firstChoiceValue;
  const prefixedEnglish = this.prefix ? `${this.prefix}en` : 'en';

  return {
    addValue: (lang, value) => {
      this.values[lang] = value;

      if (!firstChoiceValue) {
        firstChoiceValue = value;
      }
    },
    getResult: () => {
      let val;

      // Get the best value from the best language fallback:
      // 1. Requested language
      if (this.values[this.userLang]) {
        return this.values[this.userLang];
      }

      // 2. Fallback language from fallbacks.json
      for (const fallback of this.fallbacks) {
        val = this.values[fallback];
        if (val) {
          return val;
        }
      }

      // 3. Any language with suffix of same script as requested language
      const valueLangCodes = Object.keys(this.values);
      for (const langCode of valueLangCodes) {
        if (langCode.endsWith(`-${this.langScript}`)) {
          return this.values[langCode];
        }
      }

      // 4. Another language with the same script
      for (const langCode of this.languagesInScript) {
        val = this.values[langCode];
        if (val) {
          return val;
        }
      }

      // 5. English
      val = this.values[prefixedEnglish];
      if (val) {
        return val;
      }

      // 6. Any language with suffix 'Latn'
      // Only do this if the script isn't already latin;
      // otherwise, we've done it in step 3
      for (const langCode of valueLangCodes) {
        if (langCode.endsWith('-Latn')) {
          return this.values[langCode];
        }
      }

      // If nothing is found:
      // - If there's a name tag, return it
      // - If there's no name tag, return first choice
      return (this.nameTag && this.values[this.nameTag]) || firstChoiceValue;
    },
  };
};

module.exports = LanguagePicker;
