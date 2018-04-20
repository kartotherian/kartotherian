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
      msg: 'Russian has no value and no fallback defined; ' +
        'no value with -Cyrl, get value from a language that uses the same script over value in English',
      langCode: 'ru',
      values: [
        { sah: 'sah value' }, // Same alphabet
        { 'foo-Arab': 'foo-Arab value' },
        { en: 'en value' },
      ],
      expected: 'sah value',
    },
    {
      msg: 'Hebrew has no value, no fallback defined,' +
        ' no other language with -Hebr suffix,' +
        ' and no English value; get value from any language that has -Latn',
      langCode: 'he',
      values: [
        { sah: 'sah value' },
        { 'zh-Latn': 'zh-Latn value' },
        { 'bar-Cyrl': 'bar-Cyrl value' },
      ],
      expected: 'zh-Latn value',
    },
    {
      msg: 'Hebrew has no value, no fallback defined,' +
        ' no other language with -Hebr suffix,' +
        ' no English value;' +
        ' no value from any language that has -Latn;' +
        ' show language with zh_pinyin value',
      langCode: 'he',
      values: [
        { sah: 'sah value' },
        { zh_pinyin: 'zh_pinyin value' },
        { 'bar-Cyrl': 'bar-Cyrl value' },
      ],
      expected: 'zh_pinyin value',
    },
    {
      msg: 'Hebrew has no value, no fallback defined,' +
        ' no other language with -Hebr suffix,' +
        ' no English value;' +
        ' no value from any language that has -Latn;' +
        ' show language with _rm suffix',
      langCode: 'he',
      values: [
        { sah: 'sah value' },
        { jp_rm: 'jp_rm value' },
        { 'bar-Cyrl': 'bar-Cyrl value' },
      ],
      expected: 'jp_rm value',
    },
    {
      msg: 'Arabic has no value, no fallback defined, ' +
        'no other language with -Arab suffix, ' +
        'no English value, ' +
        'no value from any language that has -Arab, ' +
        'no language with -Latn; ' +
        'Get local value.',
      langCode: 'ar',
      config: {
        nameTag: 'name',
      },
      values: [
        { fr: 'fr value' },
        { 'zh-Hebr': 'zh-Hebr value' },
        { 'bar-Cyrl': 'bar-Cyrl value' },
        { name: 'name value' },
      ],
      expected: 'name value',
    },
    {
      msg: 'Arabic has no value, no fallback defined, ' +
        'no other language with -Arab suffix, ' +
        'no English value, ' +
        'no value from any language that has -Arab, ' +
        'no language with -Latn; ' +
        'there is no local value (no nametag);' +
        'get first value',
      langCode: 'ar',
      values: [
        { fr: 'fr value' },
        { 'zh-Hebr': 'zh-Hebr value' },
        { 'bar-Cyrl': 'bar-Cyrl value' },
      ],
      expected: 'fr value',
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
