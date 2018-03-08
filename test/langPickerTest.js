/* global describe it */

const assert = require('assert');
const LanguagePicker = require('../lib/LanguagePicker');

describe('LanguagePicker', () => {
  function test(languages, expected, ...testVals) {
    return () => {
      const lp = new LanguagePicker({
        nameTag: 'name',
        multiTag: 'name_',
        languages,
      });
      const lpp = lp.newProcessor();
      testVals.forEach((val) => {
        const lang = Object.keys(val);
        assert.strictEqual(lang.length, 1, 'test values must be in this form: {lang:val}, {lang:val}, ...');
        lpp.addValue(lang, val[lang]);
      });
      assert.equal(lpp.getResult(), expected);
    };
  }

  it('nothing', test(['en'], undefined));
  it('en: name', test(['en'], '-name', { name: '-name' }));
  it('en: single match', test(['en'], '-en', { name_en: '-en' }));
  it('en: pick any', test(['en'], '-he', { name_he: '-he' }));
  it('en: en+name -> en', test(['en'], '-en', { name: '-name' }, { name_en: '-en' }));
  it('en: ru+fr -> fr (Latn)', test(['en'], '-fr', { name_ru: '-ru' }, { name_fr: '-fr' }));
  it('en: fr+name -> fr', test(['en'], '-fr', { name_fr: '-fr' }, { name: '-name' }));
  it('en: he+name -> name', test(['en'], '-name', { name_he: '-he' }, { name: '-name' }));
  it('ru: he+be -> be (same script)', test(['ru'], '-be', { name_he: '-he' }, { name_be: '-be' }));
  it('ru: he+el+es -> es (Latn)', test(['ru'], '-es', { name_he: '-he' }, { name_el: '-el' }, { name_es: '-es' }));
});
