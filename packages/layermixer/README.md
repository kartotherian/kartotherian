[![Build Status](https://travis-ci.org/kartotherian/layermixer.svg?branch=master)](https://travis-ci.org/kartotherian/layermixer)

# @kartotherian/layermixer
Vector tile mixing source, allowing layers from multiple vector tile to be merged into one tile

## Usage examples

Scenario: Tiles are stored in a storage (e.g. Cassandra), and the source's SQL was changed for two of layers.
The layermixer can be used to merge the existing storage source with the two updated layers to save it back to the store.

```
store:
  uri: cassandra://...

update:
  uri: bridge://
  xml:
    npm: ["osm-bright-source", "data.xml"]
  # Use kartotherian's ability to generate just the two changed layers
  xmlLayers: [road, road_label]

mixer:
  uri: layermixer://
  params:
    sources: [{ref: store}, {ref: update}]
    # Make sure to remove these layers if 2nd source does not generate them for the given tile
    removeInFirst: [road, road_label]
```

Now run the tilerator to copy the the mixer source into the store, possibly limiting it to only those that exist in store
```
http://localhost:6534/add?generatorId=mixer&storageId=store&zoom=8&parts=10&checkZoom=8
```

See https://github.com/kartotherian/kartotherian
