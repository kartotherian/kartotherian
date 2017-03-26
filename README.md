[![Build Status](https://travis-ci.org/kartotherian/babel.svg?branch=master)](https://travis-ci.org/kartotherian/babel)
[![Coverage Status](https://coveralls.io/repos/github/kartotherian/babel/badge.svg)](https://coveralls.io/github/kartotherian/babel)

# @kartotherian/babel
Tile source to restructure vector PBFs for multilingual usecases, such as convert a single JSON object into multiple key/values, or to replace all language key/value names with a single one.  

## Usage examples

Tile is generated with 'name_' field set a JSON-encoded key-value object.
Babel can be used to convert that tile to a tile, with each value in the object becoming
a tag of its own, e.g. 'name_en', 'name_fr', ... . Also, babel can be used to replace
multiple 'name_lang' tags with a single 'name' tag right before rendering it.

```
# Process tiles from 'gen' source, expanding json string into multiple tags
json2tags:
  uri: json2tags://
  params:
    source: {ref: gen}
    tag: name   # optional, 'name' is the default
```


```
# Process tiles from 'store' source, replacing all 'name_*' tags with a single 'name' tag
babel:
  uri: babel://
  params:
    source: {ref: store}
    tag: name   # optional, 'name' is the default
    languages: ['en', 'fr', 'ru']
```
