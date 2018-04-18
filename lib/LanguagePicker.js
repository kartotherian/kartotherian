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

  return {
    addValue: (lang, value) => {
      this.values[lang] = value;

      if (!firstChoiceValue) {
        firstChoiceValue = value;
      }
    },
    getResult: () => {
      const valueLangCodes = Object.keys(this.values);

      // Get the best value from the best language fallback:
      // 1. Requested language
      if (this.values[this.userLang]) {
        return this.values[this.userLang];
      }

      // 2. Fallback language from fallbacks.json
      for (let i = 0; i < this.fallbacks.length; i++) {
        if (this.values[this.fallbacks[i]]) {
          return this.values[this.fallbacks[i]];
        }
      }

      // 3. Any language with suffix of same script as requested language
      for (let i = 0; i < valueLangCodes.length; i++) {
        if (valueLangCodes[i].endsWith(this.langScript)) {
          return this.values[valueLangCodes[i]];
        }
      }

      // 4. Another language with the same script
      for (let i = 0; i < this.languagesInScript.length; i++) {
        if (this.values[this.languagesInScript[i]]) {
          return this.values[this.languagesInScript[i]];
        }
      }

      // 5. English
      if (this.values[this.prefix ? `${this.prefix}en` : 'en']) {
        return this.values[this.prefix ? `${this.prefix}en` : 'en'];
      }

      // 6. Any language with suffix 'Latn'
      // Only do this if the script isn't already latin;
      // otherwise, we've done it in step 3
      for (let i = 0; i < valueLangCodes.length; i++) {
        if (valueLangCodes[i].endsWith('Latn')) {
          return this.values[valueLangCodes[i]];
        }
      }

      // If nothing is found:
      // - If there's a name tag, return it
      // - IF there's no name tag, return first choice
      return this.nameTag && this.values[this.nameTag] ?
        this.values[this.nameTag] :
        firstChoiceValue;
    },
    // This is for testing purposes
    getFallbacks: () => this.fallbacks,
  };
};

module.exports = LanguagePicker;
