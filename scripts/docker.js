#!/usr/bin/env node


'use strict';

var fs = require('fs');
var spawn = require('child_process').spawn;
var P = require('bluebird');


// load info from the package definition
var pkg = require('../package.json');
// load info from the service-runner config file
var config = require('js-yaml').safeLoad(fs.readFileSync(__dirname + '/../config.yaml'));

// use the package's name as the image name
var img_name = pkg.name;
// the container's name
var name = pkg.name + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

// holds the curently running process
var child;


/**
 * Wraps a child process spawn in a promise which resolves
 * when the child process exists.
 *
 * @param {Array} args the command and its arguments to run (uses /usr/bin/env)
 * @return {Promise} the promise which is fulfilled once the child exists
 */
function promised_spawn(args) {

    return new P(function(resolve, reject) {
        child = spawn('/usr/bin/env', args, {stdio: 'inherit'});
        child.on('exit', resolve);
    });

}


/**
 * Spawns a docker process which (re)builds the image
 *
 * @return {Promise} the promise starting the build
 */
function build_img() {

    return promised_spawn(['docker', 'build', '-t', img_name, '.']);

}


/**
 * Starts the container either using the default script
 * (npm start) or the test script (npm test) if do_tests is set
 *
 * @param {Boolean} do_tests whether to start the tests or the service normally
 * @return {Promise} the promise starting the container
 */
function start_container(do_tests) {

    var cmd = ['docker', 'run', '--name', name];

    // list all of the ports defined in the config file
    config.services.forEach(function(srv) {
        srv.conf = srv.conf || {};
        srv.conf.port = srv.conf.port || 8888;
        cmd.push('-p', srv.conf.port + ':' + srv.conf.port);
    });

    // append the image name to create a container from
    cmd.push(img_name);

    // use a different command to run inside if
    // we have to run the tests
    if(do_tests) {
        cmd.push('/usr/bin/npm', 'test');
    }

    // ok, start the container
    return promised_spawn(cmd);

}


/**
 * Deletes the container
 *
 * @return {Promise} the promise removing the container
 */
function remove_container() {

    return promised_spawn(['docker', 'rm', name]);

}


/**
 * Main process signal handler
 */
function sig_handle() {
    if(child) {
        child.kill('SIGINT');
    }
}


function main(opts) {

    // trap exit signals
    process.on('SIGINT', sig_handle);
    process.on('SIGTERM', sig_handle);

    // change the dir
    process.chdir(__dirname + '/..');

    // start the process
    return build_img()
    .then(function() {
        return start_container(opts.do_tests);
    })
    .then(remove_container);

}


if(module.parent === null) {

    var opts = {do_tests: false};

    // check for command-line args
    var args = process.argv.slice(2);
    var arg;
    while((arg = args.shift()) !== undefined) {
        switch(arg) {
            case '-t':
            case '--test':
                opts.do_tests = true;
                break;
            default:
                console.log('ARG: ' + arg);
                console.log('This is a utility script for starting service containers using docker.');
                console.log('Usage: ' + process.argv.slice(0, 2).join(' ') + ' [-t|--test]');
                console.log('  -t, --test   instead of starting the service, run the tests');
                process.exit(/^-(h|-help)/.test(arg) ? 0 : 1);
        }
    }

    // start the process
    main(opts);

} else {

    module.exports = main;

}

