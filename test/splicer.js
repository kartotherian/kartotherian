'use strict';

let assert = require('assert'),
    Promise = require('bluebird'),
    pathLib = require('path'),
    fs = Promise.promisifyAll(require('fs')),
    tileCodec = require('../lib/tileCodec'),
    PbfSplicer = require('../lib/PbfSplicer'),
    _ = require('underscore');

describe('Tag recombination', () => {
    function test(file, languages, expected) {
        let path = pathLib.resolve(__dirname, 'data', file + '.pbf'),
            data = fs.readFileSync(path),
            splicer = new PbfSplicer({nameTag: 'name', languages: languages}),
            result = splicer.processTile(data);

        if (typeof expected === 'string') {
            // Binary compare with the stored file
            expected = fs.readFileSync(pathLib.resolve(__dirname, 'data', expected + '.pbf'));
            assert.deepStrictEqual(result, expected);
        } else if (expected !== undefined) {
            // Object compare with the provided JSON
            let dec = tileCodec.decodeTile(result);
            assert.deepStrictEqual(dec, expected);
        }
    }

    it('json to tags', () => test('02-multilingual', false, {
        "layers": [
            {
                "features": [
                    {
                        "type": 1,
                        "id": 5,
                        "tags": [0, 0, 1, 1, 2, 2, 3, 3, 4, 1, 5, 4, 6, 5, 7, 6, 8, 7, 9, 7],
                        "geometry": [9, 1599, 4288]
                    }
                ],
                "keys": [
                    "class",
                    "name",
                    "name_ar",
                    "name_bn",
                    "name_en",
                    "name_hi",
                    "name_ja",
                    "name_kn",
                    "name_ru",
                    "name_uk"
                ],
                "values": [
                    {"tag": 1, "value": "city"},
                    {"tag": 1, "value": "Vancouver"},
                    {"tag": 1, "value": "فانكوفر"},
                    {"tag": 1, "value": "বাংকূবর"},
                    {"tag": 1, "value": "वांकूवर"},
                    {"tag": 1, "value": "バンクーバー"},
                    {"tag": 1, "value": "ವಾಂಕೂವರ್"},
                    {"tag": 1, "value": "Ванкувер"}
                ],
                "version": 2,
                "name": "place",
                "extent": 4096
            }
        ]
    }));

    it('json to tags bin', () => test('02-multilingual', false, '02-multilingual-alltags'));

    it('pick en', () => test('02-multilingual-alltags', ['en'], {
        "layers": [
            {
                "features": [
                    {
                        "type": 1,
                        "id": 5,
                        "tags": [0, 0, 1, 1],
                        "geometry": [9, 1599, 4288]
                    }
                ],
                "keys": [
                    "class",
                    "name"
                ],
                "values": [
                    {"tag": 1, "value": "city"},
                    {"tag": 1, "value": "Vancouver"}
                ],
                "version": 2,
                "name": "place",
                "extent": 4096
            }
        ]
    }));

    it('pick ru', () => test('02-multilingual-alltags', ['ru'], {
        "layers": [
            {
                "features": [
                    {
                        "type": 1,
                        "id": 5,
                        "tags": [0, 0, 1, 1],
                        "geometry": [9, 1599, 4288]
                    }
                ],
                "keys": [
                    "class",
                    "name"
                ],
                "values": [
                    {"tag": 1, "value": "city"},
                    {"tag": 1, "value": "Ванкувер"}
                ],
                "version": 2,
                "name": "place",
                "extent": 4096
            }
        ]
    }));

    it('pick using fallback', () => test('02-multilingual-alltags', ['es', 'fr', 'ru'], {
        "layers": [
            {
                "features": [
                    {
                        "type": 1,
                        "id": 5,
                        "tags": [0, 0, 1, 1],
                        "geometry": [9, 1599, 4288]
                    }
                ],
                "keys": [
                    "class",
                    "name"
                ],
                "values": [
                    {"tag": 1, "value": "city"},
                    {"tag": 1, "value": "Ванкувер"}
                ],
                "version": 2,
                "name": "place",
                "extent": 4096
            }
        ]
    }));

    it('pick missing', () => test('02-multilingual-alltags', ['es', 'fr'], {
        "layers": [
            {
                "features": [
                    {
                        "type": 1,
                        "id": 5,
                        "tags": [0, 0, 1, 1],
                        "geometry": [9, 1599, 4288]
                    }
                ],
                "keys": [
                    "class",
                    "name"
                ],
                "values": [
                    {"tag": 1, "value": "city"},
                    {"tag": 1, "value": "Vancouver"}
                ],
                "version": 2,
                "name": "place",
                "extent": 4096
            }
        ]
    }));
});
