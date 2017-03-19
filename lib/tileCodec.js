'use strict';

let Pbf = require('pbf');

module.exports = {
    decodeTile: function decodeTile(data) {
        return readTile(new Pbf(data));
    },
    encodeTile: function encodeTile(tile) {
        let pbf = new Pbf();
        writeTile(tile, pbf);
        return pbf.finish();
    }
};

/************** Tile **********/

function readTile(pbf, end) {
    return pbf.readFields(readTileField, {layers: []}, end);
}

function readTileField(tag, tile, pbf) {
    //console.log('readTileField', tag, pbf.pos);
    if (tag === 3) {
        tile.layers.push(readLayer(pbf, pbf.readVarint() + pbf.pos));
    }
}

function writeTile(tile, pbf) {
    if (tile.layers !== undefined) {
        for (let i = 0; i < tile.layers.length; i++) {
            //console.log('writeTile', i, pbf.pos);
            pbf.writeMessage(3, writeLayer, tile.layers[i]);
        }
    }
}

/************** Layer **********/

let ind = 1;
function readLayer(pbf, end) {
    //console.log('readLayer', pbf.pos);
    // require('fs').writeFileSync(require('path').resolve(__dirname, 'aaa_' + (ind++) + '.pbf'),
    //     pbf.buf.slice(pbf.pos-3, end));
    return pbf.readFields(readLayerField, {features: [], keys: [], values: []}, end);
}

function readLayerField(tag, layer, pbf) {
    // let pos = pbf.pos;
    switch (tag) {
        case 15: layer.version = pbf.readVarint(); break;
        case 1: layer.name = pbf.readString(); break;
        case 2: layer.features.push(readFeature(pbf, pbf.readVarint() + pbf.pos)); break;
        case 3: layer.keys.push(pbf.readString()); break;
        case 4: layer.values.push(readValue(pbf, pbf.readVarint() + pbf.pos)); break;
        case 5: layer.extent = pbf.readVarint(); break;
        default: throw new Error('Unexpected layer tag #' + tag);
    }
    /*
    switch (tag) {
        case 15: console.log('readLayerField', tag, pos, layer.version); break;
        case 1: console.log('readLayerField', tag, pos, layer.name); break;
        case 2: console.log('readLayerField', tag, pos, layer.feature); break;
        case 3: console.log('readLayerField', tag, pos, layer.key); break;
        case 4: console.log('readLayerField', tag, pos, layer.value); break;
        case 5: console.log('readLayerField', tag, pos, layer.extent); break;
        default: throw new Error('Unexpected layer tag #' + tag);
    }
    */
}

function writeLayer(layer, pbf) {
    // Ordering in the same way as observed in mapnik-generated PBFs
    if (layer.version !== undefined) {
        //console.log('writeLayerField', 15, pbf.pos);
        pbf.writeVarintField(15, layer.version);
    }
    if (layer.name !== undefined) {
        //console.log('writeLayerField',1, pbf.pos);
        pbf.writeStringField(1, layer.name);
    }
    if (layer.extent !== undefined) {
        //console.log('writeLayerField', 5, pbf.pos);
        pbf.writeVarintField(5, layer.extent);
    }
    if (layer.keys !== undefined) {
        for (let i = 0; i < layer.keys.length; i++) {
            //console.log('writeLayerField', 3, pbf.pos);
            pbf.writeStringField(3, layer.keys[i]);
        }
    }
    if (layer.values !== undefined) {
        for (let i = 0; i < layer.values.length; i++) {
            //console.log('writeLayerField', 4, pbf.pos);
            pbf.writeMessage(4, writeValue, layer.values[i]);
        }
    }
    if (layer.features !== undefined) {
        for (let i = 0; i < layer.features.length; i++) {
            //console.log('writeLayerField', 2, pbf.pos);
            pbf.writeMessage(2, writeFeature, layer.features[i]);
        }
    }
}

/************** Feature **********/

function readFeature(pbf, end) {
    //console.log('readFeature', pbf.pos);
    return pbf.readFields(readFeatureField, {type: "UNKNOWN"}, end);
}

function readFeatureField(tag, feature, pbf) {
    //console.log('readFeatureField', tag, pbf.pos);
    switch(tag) {
        case 1: feature.id = pbf.readVarint(); break;
        case 2: feature.tags = pbf.readPackedVarint(); break;
        case 3: feature.type = pbf.readVarint(); break;
        case 4: feature.geometry = pbf.readPackedVarint(); break;
        default: throw new Error('Unexpected feature tag #' + tag);
    }
}

function writeFeature(feature, pbf) {
    // Ordering in the same way as observed in mapnik-generated PBFs
    if (feature.type !== undefined) {
        //console.log('writeFeature', 3, pbf.pos);
        pbf.writeVarintField(3, feature.type);
    }
    if (feature.geometry !== undefined) {
        //console.log('writeFeature', 4, pbf.pos);
        pbf.writePackedVarint(4, feature.geometry);
    }
    if (feature.id !== undefined) {
        //console.log('writeFeature', 1, pbf.pos);
        pbf.writeVarintField(1, feature.id);
    }
    if (feature.tags !== undefined) {
        //console.log('writeFeature', 2, pbf.pos);
        pbf.writePackedVarint(2, feature.tags);
    }
}

/************** Value **********/

function readValue(pbf, end) {
    //console.log('readValue', pbf.pos);
    return pbf.readFields(readValueField, {}, end);
}

function readValueField(tag, value, pbf) {
    let pos = pbf.pos;
    if (value.tag !== undefined) throw new Error('Only one value per field is allowed');
    value.tag = tag;
    switch (tag) {
        case 1: value.value = pbf.readString(); break;
        case 2: value.value = pbf.readFloat(); break;
        case 3: value.value = pbf.readDouble(); break;
        case 4: value.value = pbf.readVarint(); break;
        case 5: value.value = pbf.readVarint(); break;
        case 6: value.value = pbf.readSVarint(); break;
        case 7: value.value = pbf.readBoolean(); break;
        default: throw new Error('Unexpected value tag #' + tag);
    }
    //console.log('readValueField', tag, value.value, pos);
}

function writeValue(value, pbf) {
    //console.log('writeValue', value.tag, value.value, pbf.pos);
    switch (value.tag){
        case 1: pbf.writeStringField(1, value.value); break;
        case 2: pbf.writeFloatField(2, value.value); break;
        case 3: pbf.writeDoubleField(3, value.value); break;
        case 4: pbf.writeVarintField(4, value.value); break;
        case 5: pbf.writeVarintField(5, value.value); break;
        case 6: pbf.writeSVarintField(6, value.value); break;
        case 7: pbf.writeBooleanField(7, value.value); break;
        default: throw new Error('Unexpected value tag #' + value.tag);
    }
}
