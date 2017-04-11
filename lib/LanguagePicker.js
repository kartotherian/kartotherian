'use strict';

const ls = require('language-scripts');
const dataOverrides = require('./overrides.json');

module.exports = LanguagePicker;

function LanguagePicker(opts) {
    if (!Array.isArray(opts.languages)) {
        throw new Error('languages parameter must be an array of language codes');
    }

    this._nameTag = opts.nameTag;
    this._multiTag = opts.multiTag;
    this._languages = {};

    this._priority = 0;
    this._addLangsArray(opts.languages, this._multiTag);

    const scripts = ls.adjust({prefix: this._multiTag, override: dataOverrides});

    // Use any language code that hasn't been explicitly listed if it uses the same script
    const primaryScript = (opts.languages.length > 0 && scripts[this._multiTag + opts.languages[0]]) || 'Latn';
    this._addLangsArray(Object.keys(scripts).filter(lng => scripts[lng] === primaryScript));

    // Use any Latn language if the primary script is not Latn
    if (primaryScript !== 'Latn') {
        this._addLangsArray(Object.keys(scripts).filter(lng => scripts[lng] === 'Latn'));
    }

    // Use "name" as the last fallback by default
    this._languages[this._nameTag] = Number.MAX_VALUE;
}

LanguagePicker.prototype._addLangsArray = function (langs, prefix) {
    for (const lang of langs) {
        const id = prefix ? prefix + lang : lang;
        if (!this._languages.hasOwnProperty(id)) {
            this._languages[id] = (++this._priority);
        }
    }
};

LanguagePicker.prototype.newProcessor = function () {
    const fallbackLanguages = this._languages;
    let bestValue, bestIndex, firstUnk;
    return {
        addValue: function (lang, value) {
            const order = fallbackLanguages[lang];
            if (order) {
                if (bestIndex === undefined || bestIndex > order) {
                    bestIndex = order;
                    bestValue = value;
                }
            } else if (firstUnk === undefined) {
                firstUnk = value;
            }
        },
        getResult: () => bestValue || firstUnk
    };
};
