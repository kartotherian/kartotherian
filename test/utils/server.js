'use strict';


// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */


var BBPromise = require('bluebird');
var ServiceRunner = require('service-runner');
var logStream = require('./logStream');
var fs = require('fs');
var assert = require('./assert');
var yaml = require('js-yaml');
var extend = require('extend');


// set up the configuration
var config = {
    conf: yaml.safeLoad(fs.readFileSync(__dirname + '/../../config.yaml'))
};
// build the API endpoint URI by supposing the actual service
// is the last one in the 'services' list in the config file
var myServiceIdx = config.conf.services.length - 1;
var myService = config.conf.services[myServiceIdx];
config.uri = 'http://localhost:' + myService.conf.port + '/';
// no forking, run just one process when testing
config.conf.num_workers = 0;
// have a separate, in-memory logger only
config.conf.logging = {
    name: 'test-log',
    level: 'trace',
    stream: logStream()
};
// make a deep copy of it for later reference
var origConfig = extend(true, {}, config);

var stop = function () {};
var options = null;
var runner = new ServiceRunner();


function start(_options) {

    _options = _options || {};

    if (!assert.isDeepEqual(options, _options)) {
        console.log('server options changed; restarting');
        stop();
        options = _options;
        // set up the config
        config = extend(true, {}, origConfig);
        extend(true, config.conf.services[myServiceIdx].conf, options);
        return runner.run(config.conf)
        .then(function(servers) {
            var server = servers[0];
            stop = function () {
                console.log('stopping test server');
                server.close();
                stop = function () {};
                };
            return true;
        });
    } else {
        return BBPromise.resolve();
    }

}

module.exports.config = config;
module.exports.start  = start;

