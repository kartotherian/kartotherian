'use strict';

let assert = require('assert'),
    Promise = require('bluebird'),
    pathLib = require('path'),
    fs = Promise.promisifyAll(require('fs')),
    tileCodec = require('../lib/tileCodec'),
    PbfSplicer = require('../lib/PbfSplicer');

describe('PBF round-trip', () => {

    function test(file, expectedData) {
        let path = pathLib.resolve(__dirname, 'data', file + '.pbf'),
            data = fs.readFileSync(path),
            dec = tileCodec.decodeTile(data),
            enc;



        // var tmp = '/home/yurik/dev/kartotherian/babel/test/data/tmp2.json';
        // require('./debug-utils').writeJson(tmp + '.json', {
        //     "layers": JSON.parse(fs.readFileSync(tmp)) } );
        // require('./debug-utils').writeJson(path + '.decoded.json', dec);

        if (expectedData) assert.deepStrictEqual(dec, expectedData);
        enc = tileCodec.encodeTile(dec);
        // require('./debug-utils').writePbf(path + '.out.pbf', enc);

        assert.deepStrictEqual(enc, data);
    }

    // This data contains negative values
    it('03-negative-val', () => test('03-negative-val', {
        "layers": [
            {
                "features": [
                    {
                        "geometry": [9, 7914, 8074, 10, 98, 344],
                        "id": 1,
                        "tags": [0, 0, 1, 1, 2, 2, 3, 3],
                        "type": 2
                    }
                ],
                "keys": ["brunnel", "class", "layer", "osm_id"],
                "name": "transport",
                "version": 2,
                "values": [
                    {"tag": 1, "value": "tunnel"},
                    {"tag": 1, "value": "path"},
                    {"tag": 4, "value": -1},
                    {"tag": 4, "value": 25024894}
                ],
                "extent": 4096
            }
        ]
    }));

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
});
