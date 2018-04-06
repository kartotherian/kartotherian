/* eslint-disable camelcase */
/* global describe it */

const assert = require('assert');
const Promise = require('bluebird');
const pathLib = require('path');
const fs = Promise.promisifyAll(require('fs'));
const zlib = require('zlib');
const babel = Promise.promisify(require('..'));
const tileCodec = require('../lib/tileCodec');

// eslint-disable-next-line import/no-extraneous-dependencies
const core = require('@kartotherian/core');

const fauxSource = class {
  static getAsync(o) {
    return Promise.resolve({ type: o.type, data: o.t, headers: o.h });
  }
};

core.tilelive = {
  protocols: {},
};
core.loadSource = () => fauxSource;

babel.initKartotherian(core);


describe('Tag recombination', () => {
  function test2(file, opts, expected) {
    const path = pathLib.resolve(__dirname, 'data', `${file}.pbf`);
    let pbfData = fs.readFileSync(path);

    return babel({
      protocol: opts.lng !== undefined ? 'babel:' : 'json2tags:',
      query: {
        nameTag: 'name',
        defaultLanguage: opts.lng || undefined,
        languageMap: opts.map,
        source: 'a',
        combineName: opts.comb,
        keepUncompressed: opts.keepUncompressed,
      },
    }).then((bbl) => {
      const headers = { xyz: 'abc' };
      if (opts.gzip) {
        headers['Content-Encoding'] = 'gzip';
        pbfData = zlib.gzipSync(pbfData);
      }
      const getParams = {
        type: opts.type, t: pbfData, h: headers, lang: opts.rlang,
      };
      return bbl.getAsync(getParams);
    }).then((result) => {
      const expectedHeaders = { xyz: 'abc' };
      let resultData = result.data;
      if (!opts.keepUncompressed && (opts.type === undefined || opts.type === 'tile')) {
        expectedHeaders['Content-Encoding'] = 'gzip';
        resultData = zlib.unzipSync(resultData);
      }
      assert.deepStrictEqual(result.headers, expectedHeaders);
      if (typeof expected === 'string') {
        // Binary compare with the stored file
        const expectedData = fs.readFileSync(pathLib.resolve(__dirname, 'data', `${expected}.pbf`));
        assert.deepStrictEqual(resultData, expectedData);
      } else if (expected !== undefined) {
        // Object compare with the provided JSON
        const dec = tileCodec.decodeTile(resultData);
        assert.deepStrictEqual(dec, expected);
      }
    });
  }

  function test(file, opts, expected) {
    // Try the test both with and without uncompressed setting
    return test2(file, opts, expected)
      .then(() => {
        // eslint-disable-next-line no-param-reassign
        opts.keepUncompressed = true;
        return test2(file, opts, expected);
      });
  }

  const expected_02_multilingual = {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1, 2, 2, 3, 3, 4, 1, 5, 4, 6, 5, 7, 6, 8, 7, 9, 7],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
          'name_ar',
          'name_bn',
          'name_en',
          'name_hi',
          'name_ja',
          'name_kn',
          'name_ru',
          'name_uk',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Vancouver' },
          { tag: 1, value: 'فانكوفر' },
          { tag: 1, value: 'বাংকূবর' },
          { tag: 1, value: 'वांकूवर' },
          { tag: 1, value: 'バンクーバー' },
          { tag: 1, value: 'ವಾಂಕೂವರ್' },
          { tag: 1, value: 'Ванкувер' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  };

  it('json to tags', () => test('02-multilingual', {}, expected_02_multilingual));
  it('json to tags (gzip)', () => test('02-multilingual', { gzip: 1 }, expected_02_multilingual));

  it('json to tags bin', () => test('02-multilingual', {}, '02-multilingual-alltags'));
  it('json to tags bin (gzip)', () => test('02-multilingual', { gzip: 1 }, '02-multilingual-alltags'));

  const expected_pick_en = {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Vancouver' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  };
  it('pick en', () => test('02-multilingual-alltags', { lng: 'en' }, expected_pick_en));
  it('pick en (gzip)', () => test('02-multilingual-alltags', { lng: 'en', gzip: 1 }, expected_pick_en));

  it('pick ru', () => test('02-multilingual-alltags', { lng: 'ru' }, {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Ванкувер' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  }));

  it('pick ru combine', () => test('02-multilingual-alltags', { lng: 'ru', comb: true }, {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Ванкувер (Vancouver)' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  }));

  it('pick ru dyn', () => test('02-multilingual-alltags', { lng: false, rlang: 'ru' }, {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Ванкувер' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  }));

  it('pick using fallback', () => test('02-multilingual-alltags', { lng: 'es', map: { es: ['fr', 'ru'] } }, {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Ванкувер' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  }));

  it('Verify existence of default fallback', () => {
    babel({
      protocol: 'babel:',
      query: {
        nameTag: 'name',
        defaultLanguage: 'en',
        source: 'a',
      },
    }).then((bbl) => {
      // NOTE: These are known fallbacks from within fallbacks.json
      // if the file changes, these test cases may need to change as well
      assert.deepStrictEqual(
        bbl.languageMap.av,
        ['av', 'ru']
      );

      assert.deepStrictEqual(
        bbl.languageMap.cdo,
        ['cdo', 'nan', 'zh-hant']
      );
    });
  });

  it('pick missing', () => test('02-multilingual-alltags', { lng: 'es', map: { es: ['fr'] } }, {
    layers: [
      {
        features: [
          {
            type: 1,
            id: 5,
            tags: [0, 0, 1, 1],
            geometry: [9, 1599, 4288],
          },
        ],
        keys: [
          'class',
          'name',
        ],
        values: [
          { tag: 1, value: 'city' },
          { tag: 1, value: 'Vancouver' },
        ],
        version: 2,
        name: 'place',
        extent: 4096,
      },
    ],
  }));

  it('getGrid', () => test('02-multilingual-alltags', { type: 'grid' }));
});
