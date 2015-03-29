'use strict';


// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */


var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');


describe('errors', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    // common URI prefix for the errors
    var uri = server.config.uri + 'ex/err/';

    it('array creation error', function() {
        return preq.get({
            uri: uri + 'array'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 500);
            // check the error title
            assert.deepEqual(err.body.title, 'RangeError');
        });
    });

    it('file read error', function() {
        return preq.get({
            uri: uri + 'file'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 500);
            // check the error title
            assert.deepEqual(err.body.title, 'OperationalError');
        });
    });

    it('constraint check error', function() {
        return preq.get({
            uri: uri + 'manual/error'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 500);
            // check the error title
            assert.deepEqual(err.body.title, 'Error');
        });
    });

    it('access denied error', function() {
        return preq.get({
            uri: uri + 'manual/deny'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 403);
            // check the error title
            assert.deepEqual(err.body.type, 'access_denied');
        });
    });

    it('authorisation error', function() {
        return preq.get({
            uri: uri + 'manual/auth'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 401);
            // check the error title
            assert.deepEqual(err.body.type, 'unauthorized');
        });
    });

});

