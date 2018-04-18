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
      msg: 'Object language map given, but no fallback exists, fall back to en',
      langCode: 'foo',
      config: {
        languageMap: { foo: 'bar' },
      },
      values: [
        { baz: 'baz value' },
        { en: 'en value' },
        { quuz: 'quuz value' },
      ],
      expected: 'en value',
    },
    {
      msg: 'No fallback value exists; fallback to en',
      langCode: 'yi',
      values: [
        { es: 'es value' },
        { en: 'en value' },
      ],
      expected: 'en value',
    },
    {
      msg: 'No fallback value exists, no en value exists, fallback to nameTag',
      langCode: 'yi',
      config: {
        nameTag: 'name',
      },
      values: [
        { ru: 'ru value' },
        { name: 'base name tag' },
        { fr: 'fr value' },
      ],
      expected: 'base name tag',
    },
    {
      msg: 'No fallback value exists, no en value exists, no nameTag given, fallback to first option given',
      langCode: 'yi',
      values: [
        { ru: 'ru value' },
        { es: 'es value' },
        { fr: 'fr value' },
      ],
      expected: 'ru value',
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
      msg: 'Language code unrecognized, fallback to en',
      langCode: 'quuz',
      values: [
        { ru: 'ru value' },
        { fr: 'fr value' },
        { en: 'en value' },
      ],
      expected: 'en value',
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

describe('LanguagePicker: Build a correct fallback list', () => {
  const cases = [
    {
      msg: 'Spanish falls back to a Latn language',
      langCode: 'es',
      expected: ['es', 'aa', 'abr', 'ace', 'ach', 'ada', 'en'],
    },
    {
      msg: 'Language with a fallback and script fallbacks',
      langCode: 'yi',
      config: {
        languageMap: {
          yi: 'he', // From fallbacks.json
          other: 'languages',
          that: 'dont',
          matter: 'at all',
        },
      },
      // Languages with 'Hebr' script come after the
      // official fallback
      expected: ['yi', 'he', 'jpr', 'jrb', 'lad', 'en'],
    },
  ];

  cases.forEach((data) => {
    const lp = new LanguagePicker(data.langCode, data.config);
    const lpp = lp.newProcessor();

    // Check the result
    it(data.msg, () => {
      assert.deepStrictEqual(
        lpp.getFallbacks(),
        data.expected
      );
    });
  });
});
