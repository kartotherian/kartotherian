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
    if (tag === 3) {
        tile.layers.push(readLayer(pbf, pbf.readVarint() + pbf.pos));
    }
}

function writeTile(tile, pbf) {
    if (tile.layers !== undefined) {
        for (let i = 0; i < tile.layers.length; i++) {
            pbf.writeMessage(3, writeLayer, tile.layers[i]);
        }
    }
}

/************** Layer **********/

function readLayer(pbf, end) {
    return pbf.readFields(readLayerField, {features: [], keys: [], values: []}, end);
}

function readLayerField(tag, layer, pbf) {
    switch (tag) {
        case 15: layer.version = pbf.readVarint(); break;
        case 1: layer.name = pbf.readString(); break;
        case 2: layer.features.push(readFeature(pbf, pbf.readVarint() + pbf.pos)); break;
        case 3: layer.keys.push(pbf.readString()); break;
        case 4: layer.values.push(readValue(pbf, pbf.readVarint() + pbf.pos)); break;
        case 5: layer.extent = pbf.readVarint(); break;
        default: throw new Error('Unexpected layer tag #' + tag);
    }
}

function writeLayer(layer, pbf) {
    // Ordering in the same way as observed in mapnik-generated PBFs
    if (layer.version !== undefined) {
        pbf.writeVarintField(15, layer.version);
    }
    if (layer.name !== undefined) {
        pbf.writeStringField(1, layer.name);
    }
    if (layer.extent !== undefined) {
        pbf.writeVarintField(5, layer.extent);
    }
    if (layer.keys !== undefined) {
        for (let i = 0; i < layer.keys.length; i++) {
            pbf.writeStringField(3, layer.keys[i]);
        }
    }
    if (layer.values !== undefined) {
        for (let i = 0; i < layer.values.length; i++) {
            pbf.writeMessage(4, writeValue, layer.values[i]);
        }
    }
    if (layer.features !== undefined) {
        for (let i = 0; i < layer.features.length; i++) {
            pbf.writeMessage(2, writeFeature, layer.features[i]);
        }
    }
}

/************** Feature **********/

function readFeature(pbf, end) {
    return pbf.readFields(readFeatureField, {type: "UNKNOWN"}, end);
}

function readFeatureField(tag, feature, pbf) {
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
    if (feature.type !== undefined) pbf.writeVarintField(3, feature.type);
    if (feature.geometry !== undefined) pbf.writePackedVarint(4, feature.geometry);
    if (feature.id !== undefined) pbf.writeVarintField(1, feature.id);
    if (feature.tags !== undefined) pbf.writePackedVarint(2, feature.tags);
}

/************** Value **********/

function readValue(pbf, end) {
    return pbf.readFields(readValueField, {}, end);
}

function readValueField(tag, value, pbf) {
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
}

function writeValue(value, pbf) {
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
