
function LanguagePicker(lang = 'en', config = {}) {
  let fallbackMap = {};
  let fallbacks = [];

  this.nameTag = config.nameTag;
  // The prefix is either given or is the nameTag
  // with an underscore
  // See Babel.js#24
  this.prefix = config.multiTag || (this.nameTag && `${this.nameTag}_`) || '';
  fallbackMap = config.languageMap || {};

  // Add known fallbacks for the language
  if (fallbackMap[lang]) {
    fallbacks = Array.isArray(fallbackMap[lang]) ?
      fallbackMap[lang] : [fallbackMap[lang]];
  }

  // Use the given language as first choice
  fallbacks = [lang].concat(fallbacks);

  // Fallback to English
  if (fallbacks.indexOf('en') === -1) {
    fallbacks.push('en');
  }

  // Fallback to nameTag
  if (this.nameTag) {
    fallbacks.push(this.nameTag);
  }

  // Add prefix to all languages if exists
  // eslint-disable-next-line arrow-body-style
  fallbacks = fallbacks.map((code) => {
    return code === this.nameTag ? code : this.prefix + code;
  });

  this.fallbacks = fallbacks;
}

LanguagePicker.prototype.newProcessor = function newProcessor() {
  const { fallbacks, nameTag, prefix } = this;
  let bestChoiceLang = nameTag || (prefix ? `${prefix}en` : 'en');
  let bestChoiceValue;
  let firstChoiceValue;

  return {
    addValue(lang, value) {
      const langIndex = fallbacks.indexOf(lang);
      if (
        langIndex > -1 &&
        langIndex <= fallbacks.indexOf(bestChoiceLang)
      ) {
        // Given language is a better fallback
        bestChoiceLang = lang;
        bestChoiceValue = value;
      }

      // Store the value of the first value given
      firstChoiceValue = firstChoiceValue !== undefined ?
        firstChoiceValue : value;
    },
    getResult: () => bestChoiceValue ||
        (bestChoiceLang && fallbacks[bestChoiceLang]) ||
        firstChoiceValue,
  };
};

module.exports = LanguagePicker;
