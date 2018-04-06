const _ = require('underscore');
const tileCodec = require('./tileCodec');

function calcKeyIndex(value, store, lookup) {
  let ind = lookup[value];
  if (ind === undefined) {
    ind = store.length;

    // eslint-disable-next-line no-param-reassign
    lookup[value] = ind;
    store.push(value);
  }
  return ind;
}

function calcValueIndex(value, store, lookup) {
  let ind = lookup[value.tag - 1][value.value];
  if (ind === undefined) {
    ind = store.length;

    // eslint-disable-next-line no-param-reassign
    lookup[value.tag - 1][value.value] = ind;
    store.push(value);
  }
  return ind;
}

/**
 * Transform vector tile tags
 * @param {object} options
 * @param {string} options.nameTag
 * @param {string} options.multiTag
 * @param {LanguagePicker} [options.namePicker]
 * @constructor
 */
function PbfSplicer(options) {
  // tag which will be auto-removed and auto-injected. Usually 'name'
  this.nameTag = options.nameTag;
  // tag that contains JSON initially, and which works as a prefix for multiple values
  this.multiTag = options.multiTag;

  // If options.namePicker is given, this class converts multiple language tags into one
  // Otherwise, it assumes that a single name_ tag exists with JSON content, and it will replace
  // it with multiple tags "name_en", "name_fr", ... depending on the JSON language codes
  this.namePicker = options.namePicker;

  // Flag to make requested_name (local_name) form
  this.combineName = options.combineName;
}

PbfSplicer.prototype.processTile = function processTile(data) {
  const self = this;
  const tile = tileCodec.decodeTile(data);
  let changed;

  for (const layer of tile.layers) {
    // Optimization - don't process layer if it has no relevant tags
    if (!_.any(layer.keys, key => key.startsWith(self.multiTag))) {
      // eslint-disable-next-line no-continue
      continue;
    }
    changed = true;

    const newKeys = [];
    const newValues = [];
    const newKeysLookup = {};
    // One for each data type like STRING, FLOAT, ... (7 total)
    const newValuesLookup = [{}, {}, {}, {}, {}, {}, {}];
    const addValueFunc = (key, value, tagArray) => {
      tagArray.push(calcKeyIndex(key, newKeys, newKeysLookup));
      tagArray.push(calcValueIndex(value, newValues, newValuesLookup));
    };

    for (const feature of layer.features) {
      const { tags } = feature;
      if ((tags.length % 2) !== 0) {
        throw new Error(`Broken tile - tags count ${tags.length}`);
      }

      if (self.namePicker) {
        feature.tags = self.pickOneLanguage(layer, tags, addValueFunc);
      } else {
        feature.tags = self.jsonTagToMultiple(layer, tags, addValueFunc);
      }
    }

    layer.keys = newKeys;
    layer.values = newValues;
  }

  return !changed ? data : tileCodec.encodeTile(tile);
};

PbfSplicer.prototype.jsonTagToMultiple = function jsonTagToMultiple(layer, tags, addValueFunc) {
  const newTags = [];
  let jsonTag;

  for (let ind = 0; ind < tags.length; ind += 2) {
    const key = layer.keys[tags[ind]];
    const value = layer.values[tags[ind + 1]];

    if (key === this.multiTag) {
      if (value.tag !== 1) {
        throw new Error('Expecting a tag of type STRING');
      } else if (jsonTag !== undefined) {
        throw new Error(`Duplicate tags ${this.multiTag}`);
      }
      // Decode this value into multiple tags
      jsonTag = JSON.parse(value.value);
      if (jsonTag === null || typeof jsonTag !== 'object' || Array.isArray(jsonTag)) {
        throw new Error(`Tag "${this.multiTag}" must be a JSON object {"lang-code": "value", ...}`);
      }
      // Expand object into multiple tags
      for (const lang of Object.keys(jsonTag)) {
        addValueFunc(this.multiTag + lang, { tag: 1, value: jsonTag[lang] }, newTags);
      }
    } else {
      addValueFunc(key, value, newTags);
    }
  }

  return newTags;
};

/**
 * Replace all "name_*" tags with the most appropriate "name" tag.
 * @param {object} layer
 * @param {int[]} tags
 * @param {function} addValueFunc
 * @return {int[]}
 */
PbfSplicer.prototype.pickOneLanguage = function pickOneLanguage(layer, tags, addValueFunc) {
  const newTags = [];
  const langPicker = this.namePicker.newProcessor();
  let nameValue;

  for (let ind = 0; ind < tags.length; ind += 2) {
    const key = layer.keys[tags[ind]];
    const value = layer.values[tags[ind + 1]];

    if (key === this.nameTag) {
      if (value.tag !== 1) {
        throw new Error('Expecting a tag of type STRING');
      }
      nameValue = value;
      langPicker.addValue(key, value);
    } else if (!key.startsWith(this.multiTag)) {
      // Keep all non "name_*" tags
      addValueFunc(key, value, newTags);
    } else {
      if (value.tag !== 1) {
        throw new Error('Expecting a tag of type STRING');
      }
      langPicker.addValue(key, value);
    }
  }

  const langValue = langPicker.getResult();

  if (this.combineName
    && nameValue && langValue
    && nameValue.value !== langValue.value) {
    // combined format: translated name (local name)
    const combinedNameTag = { value: `${langValue.value} (${nameValue.value})`, tag: nameValue.tag };
    addValueFunc(this.nameTag, combinedNameTag, newTags);
  } else if (langValue) {
    // only translated name
    addValueFunc(this.nameTag, langValue, newTags);
  } else if (nameValue) {
    // only local name
    addValueFunc(this.nameTag, nameValue, newTags);
  }

  return newTags;
};

module.exports = PbfSplicer;
