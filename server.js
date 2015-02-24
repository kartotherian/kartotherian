#!/usr/bin/env node

'use strict';

// Service entry point. Try node server --help for commandline options.

// Start the service by running service-runner, which in turn loads the config
// (config.yaml by default, specify other path with -c). It requires the
// module(s) specified in the config 'services' section (app.js in this
// example).
var ServiceRunner = require('service-runner');
return new ServiceRunner().run();
