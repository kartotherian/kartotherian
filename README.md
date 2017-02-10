# kartotherian-babel
Tile source that expands vector tile's string object value into multiple tags

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
