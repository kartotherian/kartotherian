'use strict';


// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */


var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');


describe('wiki site info', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    // common URI prefix for v1
    var uri = server.config.uri + 'en.wikipedia.org/v1/siteinfo/';

    it('should get all general enwiki site info', function() {
        return preq.get({
            uri: uri
        }).then(function(res) {
            // check the status
            assert.status(res, 200);
            // check the returned Content-Type header
            assert.contentType(res, 'application/json');
            // inspect the body
            assert.notDeepEqual(res.body, undefined, 'No body returned!');
            assert.notDeepEqual(res.body.server, undefined, 'No server field returned!');
        });
    });

    it('should get the mainpage setting of enwiki', function() {
        return preq.get({
            uri: uri + 'mainpage'
        }).then(function(res) {
            // check the status
            assert.status(res, 200);
            // check the returned Content-Type header
            assert.contentType(res, 'application/json');
            // inspect the body
            assert.notDeepEqual(res.body, undefined, 'No body returned!');
            assert.deepEqual(res.body.mainpage, 'Main Page', 'enwiki mainpage mismatch!');
        });
    });

    it('should fail to get a non-existent setting of enwiki', function() {
        return preq.get({
            uri: uri + 'dummy_wiki_setting'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 404);
        });
    });

    it('should fail to get info from a non-existent wiki', function() {
        return preq.get({
            uri: server.config.uri + 'non.existent.wiki/v1/siteinfo/'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ' + res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 500);
        });
    });

});

