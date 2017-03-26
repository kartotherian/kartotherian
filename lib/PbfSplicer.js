'use strict';

let _ = require('underscore'),
    tileCodec = require('./tileCodec');

module.exports = PbfSplicer;

function PbfSplicer(options) {
    // tag which will be auto-removed and auto-injected. Usually 'name'
    this.nameTag = options.nameTag;
    // tag that contains JSON initially, and which works as a prefix for multiple values
    this.multiTag = this.nameTag + '_';

    // If options.languages is given, this class converts multiple language tags into one
    // Otherwise, it assumes that a single name_ tag exists with JSON content, and it will replace
    // it with multiple tags "name_en", "name_fr", ... depending on the JSON language codes
    if (options.languages) {
        if (!Array.isArray(options.languages)) {
            throw new Error('languages parameter must be an array of language codes');
        }
        this.languages = {};
        let order = 1;
        for (let ind = 0; ind < options.languages.length; ind++) {
            let id = this.multiTag + options.languages[ind];
            if (!this.languages.hasOwnProperty(id)) {
                this.languages[id] = order++;
            }
        }
        // Use "name" as the last fallback default
        this.languages[this.nameTag] = order;
    }
}

PbfSplicer.prototype.processTile = function processTile(data) {
    let self = this,
        tile = tileCodec.decodeTile(data),
        changed;

    for (const layer of tile.layers) {
        // Optimization - don't process layer if it has no relevant tags
        if (!_.any(layer.keys, key => key.startsWith(self.multiTag))) {
            continue;
        }
        changed = true;

        let newKeys = [],
            newValues = [],
            newKeysLookup = {},
            // One for each data type like STRING, FLOAT, ... (7 total)
            newValuesLookup = [{}, {}, {}, {}, {}, {}, {}],
            addValueFunc = (key, value, tagArray) => {
                tagArray.push(calcKeyIndex(key, newKeys, newKeysLookup));
                tagArray.push(calcValueIndex(value, newValues, newValuesLookup));
            };

        for (const feature of layer.features) {
            let tags = feature.tags;
            if ((tags.length % 2) !== 0) {
                throw new Error('Broken tile - tags count ' + tags.length);
            }

            if (self.languages) {
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

function calcKeyIndex(value, store, lookup) {
    let ind = lookup[value];
    if (ind === undefined) {
        ind = store.length;
        lookup[value] = ind;
        store.push(value);
    }
    return ind;
}

function calcValueIndex(value, store, lookup) {
    let ind = lookup[value.tag - 1][value.value];
    if (ind === undefined) {
        ind = store.length;
        lookup[value.tag - 1][value.value] = ind;
        store.push(value);
    }
    return ind;
}

PbfSplicer.prototype.jsonTagToMultiple = function jsonTagToMultiple(layer, tags, addValueFunc) {
    let newTags = [],
        jsonTag;

    for (let ind = 0; ind < tags.length; ind += 2) {
        let key = layer.keys[tags[ind]],
            value = layer.values[tags[ind + 1]];

        if (key === this.multiTag) {
            if (value.tag !== 1) {
                throw new Error('Expecting a tag of type STRING');
            } else if (jsonTag !== undefined) {
                throw new Error('Duplicate tags ' + this.multiTag);
            }
            // Decode this value into multiple tags
            jsonTag = JSON.parse(value.value);
            if (jsonTag === null || typeof jsonTag !== 'object' || Array.isArray(jsonTag)) {
                throw new Error(
                    `Tag "${this.multiTag}" must be a JSON object \{"lang-code": "value", ...}`);
            }
            // Expand object into multiple tags
            for (const lang in jsonTag) {
                if (jsonTag.hasOwnProperty(lang)) {
                    addValueFunc(this.multiTag + lang, { tag: 1, value: jsonTag[lang] }, newTags);
                }
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
    let newTags = [],
        bestValue = undefined,
        bestOrder = undefined;

    for (let ind = 0; ind < tags.length; ind += 2) {
        let key = layer.keys[tags[ind]],
            value = layer.values[tags[ind + 1]];

        if (!key.startsWith(this.multiTag) && key !== this.nameTag) {
            addValueFunc(key, value, newTags);
        } else {
            if (value.tag !== 1) {
                throw new Error('Expecting a tag of type STRING');
            }
            let order = this.languages[key] || Number.MAX_VALUE;
            if (bestOrder > order || bestOrder === undefined) {
                bestOrder = order;
                bestValue = value;
            }
        }
    }

    if (bestValue !== undefined) {
        addValueFunc(this.nameTag, bestValue, newTags);
    }

    return newTags;
};
