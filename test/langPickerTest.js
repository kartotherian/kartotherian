/* global describe it */

const assert = require('assert');
const LanguagePicker = require('../lib/LanguagePicker');
const defaultMap = require('../lib/fallbacks.json');

describe('LanguagePicker', () => {
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
        { en: '_en' },
      ],
      expected: '_en',
    },
    {
      msg: 'Pick exact match language value',
      langCode: 'he',
      values: [
        { en: '_en' },
        { he: '_he' },
      ],
      expected: '_he',
    },
    {
      msg: 'Fallback yi -> he',
      langCode: 'yi',
      config: {
        languageMap: defaultMap,
      },
      values: [
        { en: '_en' },
        { he: '_he' },
        { es: '_es' },
      ],
      expected: '_he',
    },
    {
      msg: 'Fallback gan -> zh-hans (third fallback)',
      langCode: 'gan',
      config: {
        languageMap: defaultMap,
      },
      values: [
        { en: '_en' },
        { he: '_he' },
        { 'zh-hans': '_zh-hans' },
      ],
      expected: '_zh-hans',
    },
    {
      msg: 'Object language map, fallback foo -> bar',
      langCode: 'foo',
      config: {
        languageMap: { foo: 'bar' },
      },
      values: [
        { baz: '_baz' },
        { bar: '_bar' },
        { quuz: '_quuz' },
      ],
      expected: '_bar',
    },
    {
      msg: 'Object language map given, but no fallback exists, fall back to en',
      langCode: 'foo',
      config: {
        languageMap: { foo: 'bar' },
      },
      values: [
        { baz: '_baz' },
        { en: '_en' },
        { quuz: '_quuz' },
      ],
      expected: '_en',
    },
    {
      msg: 'No fallback value exists; fallback to en',
      langCode: 'yi',
      values: [
        { es: '_es' },
        { en: '_en' },
      ],
      expected: '_en',
    },
    {
      msg: 'No fallback value exists, no en value exists, fallback to nameTag',
      langCode: 'yi',
      config: {
        nameTag: 'name',
      },
      values: [
        { ru: '_ru' },
        { name: '_nameTag' },
        { fr: '_fr' },
      ],
      expected: '_nameTag',
    },
    {
      msg: 'No fallback value exists, no en value exists, no nameTag given, fallback to first option given',
      langCode: 'yi',
      values: [
        { ru: '_ru' },
        { es: '_es' },
        { fr: '_fr' },
      ],
      expected: '_ru',
    },
    {
      msg: 'Use prefixed codes',
      langCode: 'en',
      config: {
        multiTag: 'pref_',
      },
      values: [
        { pref_ru: '_ru' },
        { pref_en: '_en' },
        { pref_fr: '_fr' },
      ],
      expected: '_en',
    },
    {
      msg: 'Language code unrecognized, fallback to en',
      langCode: 'quuz',
      values: [
        { ru: '_ru' },
        { fr: '_fr' },
        { en: '_en' },
      ],
      expected: '_en',
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
