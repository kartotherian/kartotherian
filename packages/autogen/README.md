[![Build Status](https://travis-ci.org/kartotherian/autogen.svg?branch=master)](https://travis-ci.org/kartotherian/autogen)

# @kartotherian/autogen
Tile source to dynamically create tiles if its missing in the storage

## Usage examples

Scenario: Tiles are stored in a storage (e.g. Cassandra), but not all zoom levels are done. This source will attempt
 to get the tile from the storage, but if its not available, will get the tile from the generator source, and save
 it in the storage.

```
store:
  uri: cassandra://...

gen:
  uri: bridge://
  xml:
    npm: ["osm-bright-source", "data.xml"]

dyn:
  uri: autogen://
  params:
    storage: {ref: store}
    generator: {ref: gen}
    # Optional:
    mingen: 10  # Only generate tiles if missing within this zoom range
    maxgen: 18
    minstore: 10  # if generated, only store them if within this zoom range 
    maxstore: 15
```

See https://github.com/kartotherian/kartotherian
