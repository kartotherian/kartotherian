/* eslint-disable no-param-reassign,func-names */

const Pbf = require('pbf');

// Tile ========================================

const Tile = {};

Tile.read = function (pbf, end) {
  return pbf.readFields(Tile._readField, { layers: [] }, end);
};

Tile._readField = function (tag, obj, pbf) {
  if (tag === 3) {
    obj.layers.push(Tile.Layer.read(pbf, pbf.readVarint() + pbf.pos));
  }
};

Tile.write = function (obj, pbf) {
  if (obj.layers !== undefined) {
    for (let i = 0; i < obj.layers.length; i++) {
      pbf.writeMessage(3, Tile.Layer.write, obj.layers[i]);
    }
  }
};

// Tile.Value ========================================

Tile.Value = {};

Tile.Value.read = function (pbf, end) {
  return pbf.readFields(Tile.Value._readField, {}, end);
};

Tile.Value._readField = function (tag, obj, pbf) {
  if (obj.tag !== undefined) {
    throw new Error('Only one value per field is allowed');
  }
  obj.tag = tag;
  switch (tag) {
    case 1:
      obj.value = pbf.readString();
      break;
    case 2:
      obj.value = pbf.readFloat();
      break;
    case 3:
      obj.value = pbf.readDouble();
      break;
    case 4:
      obj.value = pbf.readVarint(true);
      break;
    case 5:
      obj.value = pbf.readVarint();
      break;
    case 6:
      obj.value = pbf.readSVarint();
      break;
    case 7:
      obj.value = pbf.readBoolean();
      break;
    default:
      throw new Error(`Unexpected value tag #${tag}`);
  }
};

Tile.Value.write = function (obj, pbf) {
  switch (obj.tag) {
    case 1:
      pbf.writeStringField(1, obj.value);
      break;
    case 2:
      pbf.writeFloatField(2, obj.value);
      break;
    case 3:
      pbf.writeDoubleField(3, obj.value);
      break;
    case 4:
      pbf.writeVarintField(4, obj.value);
      break;
    case 5:
      pbf.writeVarintField(5, obj.value);
      break;
    case 6:
      pbf.writeSVarintField(6, obj.value);
      break;
    case 7:
      pbf.writeBooleanField(7, obj.value);
      break;
    default:
      throw new Error(`Unexpected value tag #${obj.tag}`);
  }
};

// Tile.Feature ========================================

Tile.Feature = {};

Tile.Feature.read = function (pbf, end) {
  return pbf.readFields(Tile.Feature._readField, { type: 'UNKNOWN' }, end);
};

Tile.Feature._readField = function (tag, obj, pbf) {
  switch (tag) {
    case 1:
      obj.id = pbf.readVarint();
      break;
    case 2:
      obj.tags = pbf.readPackedVarint();
      break;
    case 3:
      obj.type = pbf.readVarint();
      break;
    case 4:
      obj.geometry = pbf.readPackedVarint();
      break;
    default:
      throw new Error(`Unexpected feature tag #${tag}`);
  }
};

Tile.Feature.write = function (obj, pbf) {
  if (obj.id !== undefined) pbf.writeVarintField(1, obj.id);
  if (obj.tags !== undefined) pbf.writePackedVarint(2, obj.tags);
  if (obj.type !== undefined) pbf.writeVarintField(3, obj.type);
  if (obj.geometry !== undefined) pbf.writePackedVarint(4, obj.geometry);
};

// Tile.Layer ========================================

Tile.Layer = {};

Tile.Layer.read = function (pbf, end) {
  return pbf.readFields(Tile.Layer._readField, { features: [], keys: [], values: [] }, end);
};

Tile.Layer._readField = function (tag, obj, pbf) {
  switch (tag) {
    case 15:
      obj.version = pbf.readVarint();
      break;
    case 1:
      obj.name = pbf.readString();
      break;
    case 2:
      obj.features.push(Tile.Feature.read(pbf, pbf.readVarint() + pbf.pos));
      break;
    case 3:
      obj.keys.push(pbf.readString());
      break;
    case 4:
      obj.values.push(Tile.Value.read(pbf, pbf.readVarint() + pbf.pos));
      break;
    case 5:
      obj.extent = pbf.readVarint();
      break;
    default:
      throw new Error(`Unexpected layer tag #${tag}`);
  }
};

Tile.Layer.write = function (obj, pbf) {
  if (obj.version !== undefined) pbf.writeVarintField(15, obj.version);
  if (obj.name !== undefined) pbf.writeStringField(1, obj.name);
  if (obj.features !== undefined) {
    for (let i = 0; i < obj.features.length; i++) {
      pbf.writeMessage(2, Tile.Feature.write, obj.features[i]);
    }
  }
  if (obj.keys !== undefined) {
    for (let i = 0; i < obj.keys.length; i++) {
      pbf.writeStringField(3, obj.keys[i]);
    }
  }
  if (obj.values !== undefined) {
    for (let i = 0; i < obj.values.length; i++) {
      pbf.writeMessage(4, Tile.Value.write, obj.values[i]);
    }
  }
  if (obj.extent !== undefined) pbf.writeVarintField(5, obj.extent);
};

// exports ========================================

module.exports = {
  decodeTile: function decodeTile(data) {
    return Tile.read(new Pbf(data));
  },

  encodeTile: function encodeTile(tile) {
    const pbf = new Pbf();
    Tile.write(tile, pbf);
    return pbf.finish();
  },
};

