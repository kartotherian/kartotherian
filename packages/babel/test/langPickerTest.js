/* global describe it */

const assert = require('assert');
const LanguagePicker = require('../lib/LanguagePicker');

describe('LanguagePicker: Pick the correct language', () => {
  const cases = [
    {
      msg: 'No values given',
      langCode: 'en',
      values: undefined,
      expected: undefined,
    },
    {
      msg: 'Pick first (only) value',
      langCode: 'en',
      values: [
        { en: 'en value' },
      ],
      expected: 'en value',
    },
    {
      msg: 'Pick exact match language value',
      langCode: 'he',
      values: [
        { en: 'en value' },
        { he: 'he value' },
      ],
      expected: 'he value',
    },
    {
      msg: 'Fallback yi -> he',
      langCode: 'yi',
      config: {
        languageMap: {
          yi: 'he',
          foo: 'bar',
          other: 'languages',
          that: 'dont',
          matter: 'at all',
        },
      },
      values: [
        { en: 'en value' },
        { he: 'he value' },
        { es: 'es value' },
      ],
      expected: 'he value',
    },
    {
      msg: 'Fallback gan -> zh-hans (third fallback)',
      langCode: 'gan',
      config: {
        languageMap: {
          gan: [
            'gan-hant',
            'zh-hant',
            'zh-hans',
          ],
        },
      },
      values: [
        { en: 'en value' },
        { he: 'he value' },
        { 'zh-hans': 'zh-hans value' },
      ],
      expected: 'zh-hans value',
    },
    {
      msg: 'Object language map, fallback foo -> bar',
      langCode: 'foo',
      config: {
        languageMap: { foo: 'bar' },
      },
      values: [
        { baz: 'baz value' },
        { bar: 'bar value' },
        { quuz: 'quuz value' },
      ],
      expected: 'bar value',
    },
    {
      msg: 'Object language map given, no fallback exists, fall back to local',
      langCode: 'foo',
      config: {
        nameTag: 'name',
        languageMap: { foo: 'bar' },
      },
      values: [
        { baz: 'baz value' },
        { en: 'en value' },
        { quuz: 'quuz value' },
        { name: 'name value' },
      ],
      expected: 'name value',
    },
    {
      msg: 'Object language map given, no fallback exists, find suffix of same script',
      langCode: 'es', // Spanish
      config: {
        nameTag: 'name',
        languageMap: { foo: 'bar' },
      },
      values: [
        { name_baz: 'baz value' },
        { name_en: 'en value' },
        { 'name_foo-Latn': 'foo-Latn value' },
        { name_quuz: 'quuz value' },
        { name: 'name value' },
      ],
      expected: 'foo-Latn value',
    },
    {
      msg: 'Edge case: Values have value for "rm" which is also the suffix ' +
        'we used when a -Latn lang is not found.',
      // In essence, we need to make sure that when we fall back to looking for
      // things that 'end with' _rm, we don't find 'rm' language
      // (because name_rm fits the pattern) and only things that actually
      // end up with name_langcode_rm
      langCode: 'en', // English;
      config: {
        nameTag: 'name',
        languageMap: { foo: 'bar' },
      },
      values: [
        { name_baz: 'baz value' },
        { name_rm: 'rm value which should not be picked' },
        { name_quuz: 'quuz value' },
        { name: 'default name value' },
      ],
      expected: 'default name value',
    },
    {
      msg: 'Latin language requested, no fallback exists, find romanized label with _rm suffix',
      langCode: 'es', // Spanish
      config: {
        nameTag: 'name',
      },
      values: [
        { name_baz: 'baz value' },
        { name_en: 'en value' },
        { name_jp_rm: 'jp_rm value' },
        { name_quuz: 'quuz value' },
        { name: 'name value' },
      ],
      expected: 'jp_rm value',
    },
    {
      msg: 'Non-latin language requested, no fallback value exists, no value with script suffix; fallback to local',
      langCode: 'yi',
      config: {
        nameTag: 'name',
      },
      values: [
        { name_es: 'es value' },
        { name_en: 'en value' },
        { name: 'name value' },
      ],
      expected: 'name value',
    },
    {
      msg: 'Use prefixed codes',
      langCode: 'en',
      config: {
        multiTag: 'pref_',
      },
      values: [
        { pref_ru: 'ru value' },
        { pref_en: 'en value' },
        { pref_fr: 'fr value' },
      ],
      expected: 'en value',
    },
    {
      msg: 'Language code unrecognized, fallback to local',
      langCode: 'quuz',
      config: {
        nameTag: 'name',
      },
      values: [
        { name_ru: 'ru value' },
        { name_fr: 'fr value' },
        { name_en: 'en value' },
        { name: 'name value' },
      ],
      expected: 'name value',
    },
    {
      msg: 'Russian has no value and no fallback defined; ' +
        'get value from a language that has -Cyrl over value in English',
      langCode: 'ru',
      values: [
        { sah: 'sah value' }, // Same alphabet
        { 'foo-Cyrl': 'foo-Cyrl value' },
        { en: 'en value' },
      ],
      expected: 'foo-Cyrl value',
    },
    {
      msg: 'Hebrew has no value, no fallback defined,' +
        ' no other language with -Hebr suffix,' +
        'Fall back on local value',
      config: {
        nameTag: 'name',
      },
      langCode: 'he',
      values: [
        { name_sah: 'sah value' },
        { 'name_zh-Latn': 'zh-Latn value' },
        { name: 'name value' },
        { 'name_bar-Cyrl': 'bar-Cyrl value' },
      ],
      expected: 'name value',
    },
    {
      msg: 'Force local language, even if the requested language exists in values',
      config: {
        nameTag: 'name',
        forceLocal: true,
      },
      langCode: 'fr',
      values: [
        { name_fr: 'fr value' },
        { name_ar: 'ar value' },
        { name: 'name value' },
      ],
      expected: 'name value',
    },
    {
      msg: 'Force local language, without a requested language at all',
      config: {
        nameTag: 'name',
        forceLocal: true,
      },
      values: [
        { name_fr: 'fr value' },
        { name_ar: 'ar value' },
        { name: 'name value' },
      ],
      expected: 'name value',
    },
  ];

  cases.forEach((data) => {
    const lp = new LanguagePicker(data.langCode, data.config);
    const lpp = lp.newProcessor();

    // Add test values
    (data.values || []).forEach((valueData) => {
      const lang = Object.keys(valueData)[0];
      lpp.addValue(lang, valueData[lang]);
    });

    // Check the result
    it(data.msg, () => {
      assert.equal(
        lpp.getResult(),
        data.expected
      );
    });
  });
});

describe('LanguagePicker: Isolation', () => {
  const lp = new LanguagePicker('foo', { nameTag: 'name' });
  // We are always asking for 'foo' language
  // Let's make sure that cases are not found where
  // foo is not given as a value
  const cases = [
    {
      msg: 'foo language is defined: Found value in foo',
      values: [
        { bar: 'The first bar value' },
        { baz: 'The first baz value' },
        { foo: 'The first foo value' },
      ],
      expected: 'The first foo value',
    },
    {
      msg: 'foo language is not defined, neither are all other fallbacks, exept nameTag. Make sure we fall back on nameTag',
      values: [
        { blip: 'The first blip value' },
        { blop: 'The first blop value' },
        { name: 'The first name value' },
        { bloop: 'The first bloop value' },
      ],
      expected: 'The first name value',
    },
    {
      msg: 'foo language is not defined, neither are all other fallbacks, and there is no nameTag. Show empty result (do not display label)',
      values: [
        { me: 'The first me value' },
        { meo: 'The first meo value' },
        { meow: 'The first meow value' },
      ],
      expected: undefined,
    },
  ];

  cases.forEach((data) => {
    const lpp = lp.newProcessor();

    // Add test values
    (data.values || []).forEach((valueData) => {
      const lang = Object.keys(valueData)[0];
      lpp.addValue(lang, valueData[lang]);
    });

    // Check the result
    it(data.msg, () => {
      assert.equal(
        lpp.getResult(),
        data.expected
      );
    });
  });
});
