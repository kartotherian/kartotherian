# Map Tile Pre-Generation Service for [Kartotherian](https://github.com/kartotherian/kartotherian)

**Tilerator** (Russian: Тилератор, tee-LEH-ruh-tor)

This code is cross-hosted at [gerrit](https://git.wikimedia.org/summary/maps%2Ftilerator)

Generating tiles from the SQL queries sometimes requires a considerable time, often too long for the web request. Tilerator is a multi-processor, cluster-enabled tile generator, that allows both pre-generation and dirty tile re-generation.

Scheduled generation job waits in the queue ([kue](https://github.com/Automattic/kue)) until it is picked up by one of the workers. The worker will update job progress, as well as store intermediate data to allow restarts/crash recovery.

Tilerator is an unprotected Admin tool, and should NOT be exposed to the web. By default, tilerator only accepts connections from the localhost. It is recommended that it is left this way, and used via a port forwarding ssh tunnel with `ssh -L 6534:localhost:6534 my.maps.server`

## Configuration
Inside the `conf` key:
* `sources` - (required) Either a set of subkeys, a filename, or a list of file names.  See [core](https://github.com/kartotherian/kartotherian-core) on how to configure the sources.
* `variables` - (optional) specify a set of variables (string key-value pairs) to be used inside sources, or it could be a filename or a list of filenames/objects.
* `uiOnly`- (optional, boolean) runs tilerator in UI mode - does not generate tiles, but still allows access to the web-based queue management tools.
* `daemonOnly`- (optional, boolean) runs tilerator in daemon mode - generates tiles, but does not allows access to the web-based queue management tools.
For the rest of the configuration parameters, see [service runner](https://github.com/wikimedia/service-runner) config info.
* redis - (optional) configures redis server connection, e.g. redis://example.com:1234?redis_option=value&redis_option=value

## Single index concept
* Internally, all [X,Y] coordinates are converted to a single integer, with values 0..(4^zoom-1). This index is constructed
by taking bits of both X and Y coordinates one bit at a time, thus every odd bit of the index represents the X, and every even bit represents the Y coordinates.

This allows us to easily treat the whole tile space as one linear space, yet provides for a convenient way to calculate other zoom levels.
For example, by simply dividing the index by 4, we get the index of the tile that includes current tile with zoom-1.

## Monitoring Jobs
It is highly recomended, although not mandatory, to have an extra instance of the tilerator running with the uiOnly setting in the config.
This way if tilerator can be stopped and the pending jobs rearranged. Without the uiOnly instance, you will always be changing the queue
while jobs are running.  To configure the uiOnly instance, make a copy of the tilerator config, set uiOnly to true and change the port number.
To see the currently running jobs, navigate to `http://localhost:6534/` (nicer interface) or `http://localhost:6534/raw` (internal data).

## Adding jobs
Jobs can be scheduled via a POST request. The best way is to use /static/admin.html from the Kartotherian deployment,
and point it to Tilerator instance. Or you can make direct calls with [Chrome Postman extension](https://chrome.google.com/webstore/detail/postman/fhbjgbiflinjbdggehcddcbncdddomop?hl=en) or similar.

The most basic call to generate all tiles of zoom level 3, using `gen` source to produce tiles, and store them in the `store` source.  This job will be executed by one worker, without any multitasking.
```
http://localhost:6534/add?generatorId=gen&storageId=store&zoom=3
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

### Pyramid mode
Specifying `fromZoom` and `beforeZoom` enables pyramid mode. This mode tells Tilerator to generate more than
one zoom level with one request. Given a tip of the pyramid - a tile at a given zoom level `zoom`,
the pyramid will contain all the tiles under the given tile (higher zooms), and all the tiles that contain the given tile (lower zooms).
So a `zoom+1` will be the 4 tiles corresponding to the tip tile, and `zoom+2` will have the 16 tiles, etc.
For all zoom levels lower than `zoom`, Tilerator will add just one tile per `zoom` that contains the tip tile.
Tilerator will only generate the range of zooms requested, which does not have to contain the `zoom` (a cross-section of the piramid)
The base zoom may contain more than just one tile or even a whole zoom level. Use idxFrom & idxBefore to specify the tile range, or (x,y) for just one tile.

This feature could be useful for the tile invalidation. For example, a user edited a tile at Z=16, and the system automatically scheduled tile refresh at Z=10..17)

* `zoom` - the zoom level of the pyramid's tip
* `fromZoom` - zoom level at which to start generation (inclusive)
* `beforeZoom` - zoom level to end tile generation (exclusive)

### Parsing updates file
Specifying `filepath` parameter will load that file from the localhost and append its content to the queue. The file
 must already exist on the server. File must be in the format created by osm2pgsql, and all lines must be of the same
 zoom level:

```
zoom/x_coordinate/y_coordinate
```

Tilerator will convert this file into a list of indexes, sort/deduplicate them, and schedule all the needed jobs.
Use `fromZoom` and `beforeZoom` to invalidate more than just the zoom level given in the file. Note that if the zoom range is
given, only those zooms will be regenerated. So if the zoom level in the file is not in `fromZoom <= zoom < beforeZoom`,
that zoom level will not be regenerated.

 P.S. Please remember that Tilerator is an admin tool, and should not be accessible from the web

### Job Filters
Sometimes you may wish to generate only those tiles that satisfy a certain condition.

If any of these parameters are set, Tilerator will check if a specific tile exists before attempting to regenerate it.
* `sourceId` - which source to use for filtering. Will use `storageId` by default.
* `checkZoom` - only generate tiles if the corresponding tile exists at zoom level `checkZoom`.  By default, if any other filter values are set, it uses job's zoom level. If negative, means use job's zoom level minus the value.
* `dateBefore` - only generate tile if the tile in storage was generated before given date
* `dateFrom` - only generate tile if the tile in storage was generated after the given date
* `biggerThan` - only generate tile if the tile in storage is bigger than a given size (compressed)
* `smallerThan` - only generate tile if the tile in storage is smaller than a given size (compressed)
* `missing` - if this is set to true, and other filters are not set, gets all the missing tiles.
If other filters are set, generates the missing tiles plus the ones that match the filter.
For example, to regenerate missing and small tiles, set the `smallerThan` and `missing` parameters.

Currently `/add/` supports up to two filters. Specify the second filter by adding `2` at the end of each filter parameter.
If two filters are given, only tiles that satisfy both filters will be generated.

## Queue cleanup and rebalancing
At times, if a job crashes, or the Tilerator is killed by the admin, it will remain in the "active" queue without being worked on,
and its `updated` timestamp will stay the same.  These jobs have to be moved back to the `inactive` queue.
In the future it might be possible to fix this automaticaly, but for now, there is a "clean" POST request:
```
http://localhost:6534/cleanup
```
Which by default moves all jobs from `active` to `inactive` if they haven't been updated for the past 60 minutes.
Alternativelly, the originating queue and the number of minutes can be specified as the first two value after the cleanup.
This will move all jobs from the `failed` queue into `inactive` if they haven't been updated in the last 15 minutes:
```
http://localhost:6534/cleanup/failed/15
```
Sometimes the few jobs take too long to render, while other machines or CPU cores are not busy. Cleanup can break such jobs
into smaller chunks. To use it, it is best to have an extra instance of Tilerator running with the `uiOnly` config option.
Otherwise you may update an active job, without notifying the worker about it, thus causing it to continue processing.
To use the job rebalancing, stop all the non-uiOnly Tilerator instances, and run cleanup with some extra parameter:
```
http://localhost:6534/cleanup/active/0?breakIntoParts=5&breakIfLongerThan=0.5

```
This tells tilerator to move all jobs from active to inactive, even if they were just updated (you did stop the workers, right?),
and also to break up all jobs into 5 parts if the job's estimated completion time is more than 30 minutes (1/2 of an hour).
The original job will be shortened to the 10% of whatever was left to do.

cleanup accept these parameters:
* breakIntoParts: - number of parts to break the job into. Must be at least 2 if set. Only affect jobs that match breakIfLongerThan
* breakIfLongerThan - if breakIntoParts is set, and if the job is estimated to run longer than this value, it will be broken into parts. Default is 0.16 hours (10 minutes)
* updateSources - if true, will update the sources of all the matching jobs



## Copying source info
This command performs copying of the source `info` object from source to destination (immediate, not queued)
```
http://localhost:6534/setinfo/source/destination
```

Optionally you can specify the `?tiles=` parameter to update it:
```
http://localhost:6534/setinfo/gen/c?tiles=http://.../osm/{z}/{x}/{y}.pbf
```

## Viewing and dynamically changes sources
You may view currently configured sources by browsing to the `/sources` URL (GET)
```
http://localhost:6534/sources
```

Sometimes a temporary source is needed for the generation. Tilerator allows dynamic non-permanent sources to be added
via the `/sources` command as well, by POSTing the new YAML configuration to the same URL, in the same format as in the sources file.
Note that the operation will add sources to the existing ones, overriding the ones with the same name. Variables cannot be changed.

## Viewing defined variables
```
http://localhost:6534/variables
```
This URL will show the list of defined variables
