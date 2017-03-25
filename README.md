[![Build Status](https://travis-ci.org/kartotherian/core.svg?branch=master)](https://travis-ci.org/kartotherian/core)

# @kartotherian/core

The core components of the Kartotherian maps tile service

## Sources
Sources is a way to set up data processing pipelines for Kartotherian and Tilerator. Any source based on  [tilelive.js](https://github.com/mapbox/tilelive#tilelivejs) specification may be used.
Source configuration could be located in standalone files, or be embedded in the
main configuration file, or a mix of both. The sources value in the config file
could be a string (file), an object defining the source, or an array of strings and objects.

`uri` is the only mandatory field, and it specifies how [tilelive.js](https://github.com/mapbox/tilelive#tilelivejs)
will locate and initialize the new source. The protocol determines which tile provider will be used.

Since sometimes not everything can be added as query parameters to the Uri, there is a set of additional keys to help.
Values can either be hardcoded as strings/numbers/booleans, or can be calculated on the fly.

A simple source configuration to set up a tile storage as files in the ./vectors dir:
```
filestore:
    uri: file://./vectors
```
The path can also be set via a parameter:
```
filestore:
    uri: file://
    pathname: ./vectors
```
The value does not have to be given in the source, but instead could be dynamically generated.
For example, the `var` generator pulls the value from the variable store.
The variables are defined in a separate file(s), similar to sources.
```
filestore:
    uri: file://
    pathname: {var: tilepath}  # Uses a variable named tilepath
```

More parameters can be set using `params` - a set of additional values to be set in URI:
```
oz:
  # "overzoom:" is a tile source that will attempt to get a tile from another source,
  # and if tile is missing, attempt to get a portion of the lower-zoom tile.
  uri: overzoom://
  # Specify the tile source - this adds a properly escaped query parameter
  #   ?source=sourceref:///?ref=gen
  param:
    source: {ref: gen}
```

## Value substitutions

In general, these value substitutions are available:
* `{var:varname}` - the value becomes the value of the variable `varname` from the variables file / variables conf section of the main config file. This might be useful if you want to make all the settings public except for the passwords that are stored in a secure location.
* `{ref:sourceId}` - the value becomes a reference to another source. Some sources function as filters/converters, pulling data internally from other sources and converting the result on the fly. For example, the [overzoom](https://github.com/kartotherian/overzoom) source pulls data from another source, and if it's not available, tries to find a lower-zoom tile above the given one, and extract a portion of it. Internally, it uses a forwarding sourceref: source.
* `{npmloader: npm-module-name}` or `{npmloader: ['npm-module-name', 'arg1', 'arg2', ...]}` - if npm module supports loading customization, it should be loaded via the npmloader. Npmloader is only available inside the source's `xml` key.
* `{npmpath: ['npm-module-name', 'subdir', 'subdir', 'filename']}` - some files may be located inside the NPM modules added to the Kartotherian project, i.e. [osm-bright-source](https://github.com/kartotherian/osm-bright.tm2source). To reference a file inside npm, set npm's value to an array, with the first value being the name of the npm module (resolves to the root of the npm module), and all subsequent strings being subdirs and lastly - the name of the file. Subdirs may be omitted. `npmpath: ["osm-bright-source", "data.xml"]` would resolve to a rooted path `/.../node_modules/osm-bright-source/data.xml`

## XML-based sources
The `xml` parameter is used to load and alter XML for some sources like
[tilelive-bridge](https://github.com/mapbox/tilelive-bridge) (SQL→VectorTile or TIFF→RasterTile) and
[tilelive-vector](https://github.com/mapbox/tilelive-vector) (Style VectorTile → PNG).
The `xml` field must evaluate to the xml file path.

```
gen:                # The name of the source (could be referenced later)
  uri: bridge://    # Required - the URI used to construct the source
  xml:              # Init source with this xml instead of the URI's other parameters
    # Set xml to the location of the 'data.xml', which is located inside the osm-bright-source npm
    npmpath: ["osm-bright-source", "data.xml"]
  xmlSetDataSource: # Before loading, update the datasource section of the standard mapnik config file
    if:             # Only update datasources that match all these values (logical AND)
      dbname: gis   # Instead of 'gis', you can use {npmpath:...}, {ref:..}, and {var:...}
      host: ''
      type: postgis
    set:            # Replace these keys with the new values
      host: localhost
      user: {var: osmdb-user}  # Instead of hardcoding, use the value from the variables file or conf section
      password: {var: osmdb-pswd}
```

* `xmlSetAttrs` - for xml, overrides the attributes of the root element with the new ones. For example, you may change the font directory of the `<Map>` element:
```
s2:
  uri: vector://
  xml:
    npmloader: osm-bright-style    # stylesheet xml is in npm
  xmlSetAttrs:
    # Note that this is not needed for osm-bright-style because that module does this internally
    font-directory: {npmpath: ["osm-bright-fonts", "fonts/"]}
```
* `xmlSetParams` - for xml, overrides the top level `<Parameters>` values with the new ones. For example, the `vector` source requires xml stylesheet to point to the proper source of PBFs:
```
s2:
  public: true
  uri: vector://
  formats: [png,json,headers,svg,jpeg]
  xml:
    npmloader: osm-bright-style    # stylesheet xml is in npm
  xmlSetParams:
    source: {ref: gen}                          # set source parameter to the 'gen' source
```
* `xmlLayers` - keep all non-layer data, but only keep those layers that are listed in this value (whitelist):
```
s2:
  public: true
  uri: vector://
  formats: [png,json,headers,svg,jpeg]
  xml:
    npmloader: osm-bright-style    # stylesheet xml is in npm
  xmlLayers: ['landuse', 'road']                # Only include these layers when rendering
```
* `xmlExceptLayers` - same as `xmlLayers`, but instead of whitelisting, blacklist (allow all except these):
```
s2:
  public: true
  uri: vector://
  formats: [png,json,headers,svg,jpeg]
  xml:
    npmloader: osm-bright-style    # stylesheet xml is in npm
  xmlExceptLayers: ['water']                    # Exclude water layer when rendering
```
* `xmlSetDataSource` - change all layer's datasources' parameters if they match conditions:
`if` is a set of parameter values that all must match,
`xmlLayers` and `xmlExcludeLayers` just like above set which layers to address,
and `set` specifies the new parameter values to be set.

Instead of an object, `xmlSetDataSource` can be set to an array of objects to provide
multple change sets.

## Kartotherian-specific parameters:
* `public` (boolean) - should this be source be accessible via `/<sourceId>/z/x/y.format` requests. You may also set configuration parameter `allSourcesPublic` to true to make all sources public (might be dangerous)
* `minzoom` (int) - minimum allowable zoom for the public request (public requests only)
* `maxzoom` (int) - maximum allowable zoom for the public request (public requests only)
* `defaultHeaders` (object) - a set of extra headers that will be sent to the user unless the source provides its own. (public requests only)
* `headers` (object) - a set of extra headers that will be sent to the user instead of the headers returned by the source. (public requests only)
* `formats` (array of strings) - one string or a list of string values specifying allowed formats, e.g. `['png','jpeg']`
* `scales` (array of numbers) - one number or a list of number values specifying allowed scalings, e.g. `[1.3, 1.5, 2, 2.6, 3]`
* `setInfo` (object) - provide values that will be reported to the client via the `/<sourceId>/info.json`. See https://github.com/mapbox/tilejson-spec
* `overrideInfo` (object) - override values produced by the source's getInfo(), or if value is null, remove it. Result will be accessible via `/<sourceId>/info.json`. See https://github.com/mapbox/tilejson-spec
