# Map Tile Pre-Generatior service for Wikipedia

Generating tiles from the SQL queries sometimes requires a considerable time, often too long for the web request.
Tilerator is a multi-processor, cluster-enabled tile generator, that allows both pre-generation and dirty tile re-generation.

Scheduled generation job waits in the queue ([kue](https://github.com/Automattic/kue)) until it is picked up by one
of the workers. The worker will update job progress, as well as store intermediate data to allow restarts/crash recovery.

Tilerator is an unprotected Admin tool, and should NOT be exposed to the web. By default, tilerator only accepts
connections from the localhost. It is recommended that it is left this way, and used via a port forwarding ssh tunnel with `ssh -L 4100:localhost:4100 my.maps.server`

## Configuration
Inside the `conf` key:
* `sources` - (required) Either a set of subkeys, a filename, or a list of file names.  See [core](https://github.com/kartotherian/kartotherian-core) on how to configure the sources.
* `variables` (optional) - specify a set of variables (string key-value pairs) to be used inside sources, or it could be a filename or a list of filenames/objects.
* `uiOnly` (optional, boolean) - runs tilerator in UI mode - does not generate tiles, but still allows access to the web-based queue management tools.
For the rest of the configuration parameters, see [service runner](https://github.com/wikimedia/service-runner) config info.

## Single index concept
* Internally, all [X,Y] coordinates are converted to a single integer, with values 0..(4^zoom-1). This index is constructed
by taking bits of both X and Y coordinates one bit at a time, thus every odd bit of the index represents the X, and every even bit represents the Y coordinates.

This allows us to easily treat the whole tile space as one linear space, yet provides for a convenient way to calculate other zoom levels.
For example, by simply dividing the index by 4, we get the index of the tile that includes current tile with zoom-1.

## Adding jobs
Jobs can be scheduled via a POST request. Usually I do it with [Chrome Postman extension](https://chrome.google.com/webstore/detail/postman/fhbjgbiflinjbdggehcddcbncdddomop?hl=en) or similar.

The most basic call to generate all tiles of zoom level 3, using `gen` source to produce tiles, and store them in the `store` source.  This job will be executed by one worker, without any multitasking.
```
http://localhost:4100/add?generatorId=gen&storageId=store&zoom=3
```
### Job Parameters
* `generatorId` - required source ID, as defined in the sources configuration. Tiles from this source will be read.
* `storageId` - required source ID, as defined in the sources configuration. Tiles will be written to this source.
* `zoom` - zoom level to process
* `parts` - break the job into NNN independent jobs, allowing it to run in multiple workers and/or machines
* `idxFrom` - the starting tile index (inclusive, 0 by default)
* `idxBefore`- generate tiles until this index (non-inclusive, 4^zoom by default)
* `x` and `y` - generate just one tile at these coordinates. Cannot be used with `idxFrom` or `idxBefore`
* `deleteEmpty` - if true, any non-generated tile (e.g. empty or solid) will be explicitly deleted from the storage (optional, false by default)
* `threads` - uses preemptive multitasking to process a job, effectivelly multithreading it, while still processing it as one job. This mode is experimental, and might not work in some cases with advanced filtering options.

### Pyramid mode
This mode tells Tilerator to generate more than one zoom level with one request. Given a tip of the pyramid - a tile at a given zoom level (baseZoom),
the pyramid will contain all the tiles under the given tile (higher zooms), and all the tiles that contain the given tile (lower zooms).
So a baseZoom+1 zoom will be the 4 tiles corresponding to the tip tile, and baseZoom+2 will have the 16 tiles, etc.
With all zooms lower than baseZoom, it will always be one tile per zoom that contains the tip.
Tilerator will only generate the range of zooms requested, which could be different from the baseZoom.
The base zoom may contain more than one tile or even a whole zoom level. Use idxFrom & idxBefore to specify the tile range, or (x,y) for just one tile.

This feature could be useful for the tile invalidation. For example, a user edited a tile at Z=16, and the system automatically scheduled tile refresh at Z=10..17)

* `baseZoom` - the zoom level of the pyramid's tip
* `zoomFrom` - zoom level at which to start generation (inclusive)
* `zoomBefore` - zoom level to end tile generation (exclusive)

### Job Filters
Sometimes you may wish to generate only those tiles that satisfy a certain condition.
Note: For now, only one set of conditions is available, even though internally chaining is also supported.

* `checkZoom` - only generate tiles if the tile at the corresponding tile exists at zoom level `checkZoom`
