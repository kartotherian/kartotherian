# Configuration

The first thing you should configure is the service's general information (name,
description, etc.). Open up [`package.json`](../package.json) and change (at
least) the following fields:

- `name`
- `version`
- `description`
- `repository/url`
- `keywords`
- `author`
- `contributors`
- `licence`
- `bugs`
- `homepage`

Now change the service's name in [`config.dev.yaml`](../config.dev.yaml#L26) and
[`config.prod.yaml`](../config.prod.yaml#L26). While you are there, you might
want to look at and play with other configuration parameters, such as:

- `num_workers` - the number of workers to start; some special values are:
  - `0` will not do any forking, but run the service in the master process
  - `ncpu` will spawn as many worker processes as there are CPU cores on the
    host
- `worker_heap_limit_mb` - the maximum amount of memory (in MB) a worker's heap
  can have
- `logging` and `metrics` - the configuration for logging and metrics facilities
- `services` - the block instructing the master process which services to start;
  there can be more than one service, if, e.g., your service depends on another
  Node.js service being present; each service has further the following
  information:
  - `name` - the service's name
  - `module` - the module starting the service; if not given, the service's name
    is used instead
  - `conf` - the configuration object passed directly to the service; settings
    to consider (remember to update them in both
    [`config.dev.yaml`](../config.dev.yaml) as well as
    [`config.prod.yaml`](../config.prod.yaml)):
    - `port` - the port to start the service on (default: `8888`)
    - `interface` - where to bind the service's server (default: `0.0.0.0`)
    - you may add here any other configuration options needed by your service,
      as long as it is [valid YAML](http://www.yaml.org/spec/1.2/spec.html);
      these will be accessible via the `app.conf` object

For more information on configuration possibilities, take a look at the
[service-runner
documentation](https://github.com/wikimedia/service-runner#config-loading).

