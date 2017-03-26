'use strict';

let assert = require('assert'),
    Promise = require('bluebird'),
    pathLib = require('path'),
    fs = Promise.promisifyAll(require('fs')),
    tileCodec = require('../lib/tileCodec'),
    PbfSplicer = require('../lib/PbfSplicer');

// Enhance debugging
Promise.config({
    warnings: true,
    longStackTraces: true
});

describe('PBF round-trip', () => {

    function test(file, expectedData) {
        let path = pathLib.resolve(__dirname, 'data', file + '.pbf'),
            data = fs.readFileSync(path),
            dec = tileCodec.decodeTile(data),
            enc;


        // To dump a JSON form of a PBF
        // $ npm install json-stringify-pretty-compact
        //
        // fs.writeFileSync(path + '.expected.out.pbf', new Buffer(tileCodec.encodeTile(expectedData)), 'binary');
        // fs.writeFileSync(path + '.json', require('json-stringify-pretty-compact')(dec));

        assert.deepStrictEqual(dec, expectedData);

        enc = tileCodec.encodeTile(dec);
        assert.deepStrictEqual(enc, data);

        // fs.writeFileSync(path + '.out.pbf', new Buffer(enc), 'binary');
        // assert.ok(bufferEqual(enc, data));
    }

    it('simple', () => test('01-simple', {
        "layers": [{
            "features": [{
                "type": 3,
                "geometry": [9, 6, 8448, 26, 261, 0, 0, 8453, 262, 0, 15],
                "id": 1,
                "tags": [0, 0]
            }],
            "keys": ["osm_id"],
            "values": [{"tag": 4, "value": 0}],
            "version": 2,
            "name": "water",
            "extent": 4096
        }]
    }));

    it('multilingual', () => test('02-multilingual', {
        "layers": [
            {
                "features": [
                    {
                        "type": 1,
                        "id": 5,
                        "tags": [0, 0, 1, 1, 2, 2],
                        "geometry": [9, 1599, 4288]
                    }
                ],
                "keys": ["class", "name", "name_"],
                "values": [
                    {"tag": 1, "value": "city"},
                    {"tag": 1, "value": "Vancouver"},
                    {
                        "tag": 1,
                        "value": "{\"ar\": \"فانكوفر\", \"bn\": \"বাংকূবর\", \"en\": \"Vancouver\", \"hi\": \"वांकूवर\", \"ja\": \"バンクーバー\", \"kn\": \"ವಾಂಕೂವರ್\", \"ru\": \"Ванкувер\", \"uk\": \"Ванкувер\"}"
                    }
                ],
                "version": 2,
                "name": "place",
                "extent": 4096
            }
        ]
    }));

    it('multilingual alltags', () => test('02-multilingual-alltags', {
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
});

// function bufferEqual(buf1, buf2) {
//     if (buf1.byteLength !== buf2.byteLength) return false;
//     let arr1 = new Int8Array(buf1),
//         arr2 = new Int8Array(buf2);
//     for (let i = 0; i < buf1.byteLength; i++) {
//         if (arr1[i] !== arr2[i]) {
//             return false;
//         }
//     }
//     return true;
// }
