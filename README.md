[![Build Status](https://travis-ci.org/kartotherian/babel.svg?branch=master)](https://travis-ci.org/kartotherian/babel)
[![Coverage Status](https://coveralls.io/repos/github/kartotherian/babel/badge.svg)](https://coveralls.io/github/kartotherian/babel)

# @kartotherian/babel
Tile source to restructure vector PBFs for multilingual usecases, such as convert a single JSON object into multiple key/values, or to replace all language key/value names with a single one.  

## Usage examples

Tile is generated with 'name_' field set a JSON-encoded key-value object.
Babel can be used to convert that tile to a tile, with each value in the object becoming
a tag of its own, e.g. 'name_en', 'name_fr', ... . Also, babel can be used to replace
multiple 'name_lang' tags with a single 'name_' tag right before rendering it, choosing the best
language based on the fallback rules, but only if it is different from the 'name' tag.

```yaml
# Process tiles from 'gen' source, expanding json string into multiple tags
json2tags:
  uri: json2tags://
  params:
    source: {ref: gen}
    tag: name   # optional, 'name' is the default
```


```yaml
# Process tiles from 'store' source, replacing all 'name_*' tags with a single 'name' tag
babel:
  uri: babel://
  params:
    source: {ref: store}
    
    # optional, 'name' is the default
    tag: name
    
    # optional, used by default if no 'lang' code is passed to getAsync()
    defaultLanguage: 'en' 
    
    # optional map of fallback values. Can be a json file or an object value
    languageMap: '/my/path/fallback.json'
    
    # -- OR --
    
    languageMap:
      en: ['fr', 'es', 'de']
      ru: ['be']
```

## Language resolution
For `babel://`, the language of the `name_` is chosen based on these rules:

`getAsync({z,x,y, lang:'xx')`:
 * `name_xx`
 * Use explicitly set fallbacks from the languageMap
 * Use any `name_yy` where yy's script is the same as xx's. This way, if `lang=ru`, pick any other Cyrillic name before non-Cyrillic
 * Use any `name_zz` where zz uses Latin script

Note that `name_xx` will not be added if it is identical to `name` tag

## Scripts

Babel gets the CLDR defined script name (Latn, Cyrl, ... ) based on the language code. It also uses a few overrides from the `overrides.json`. This file should be updated with any language IDs found in OSM data.
