'use strict';


var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');


describe('service information', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    // common URI prefix for info tests
    var infoUri = server.config.uri + '_info/';

    // common function used for generating requests
    // and checking their return values
    function checkRet(fieldName) {
        return preq.get({
            uri: infoUri + fieldName
        }).then(function(res) {
            // check the returned Content-Type header
            assert.contentType(res, 'application/json');
            // the status as well
            assert.status(res, 200);
            // finally, check the body has the specified field
            assert.notDeepEqual(res.body, undefined, 'No body returned!');
            assert.notDeepEqual(res.body[fieldName], undefined, 'No ' + fieldName + ' field returned!');
        });
    }

    it('should get the service name', function() {
        return checkRet('name');
    });

    it('should get the service version', function() {
        return checkRet('version');
    });

    it('should redirect to the service home page', function() {
        return preq.get({
            uri: infoUri + 'home',
            followRedirect: false
        }).then(function(res) {
            // check the status
            assert.status(res, 301);
        });
    });

    it('should get the service info', function() {
        return preq.get({
            uri: infoUri
        }).then(function(res) {
            // check the status
            assert.status(res, 200);
            // check the returned Content-Type header
            assert.contentType(res, 'application/json');
            // inspect the body
            assert.notDeepEqual(res.body, undefined, 'No body returned!');
            assert.notDeepEqual(res.body.name, undefined, 'No name field returned!');
            assert.notDeepEqual(res.body.version, undefined, 'No version field returned!');
            assert.notDeepEqual(res.body.description, undefined, 'No description field returned!');
            assert.notDeepEqual(res.body.home, undefined, 'No home field returned!');
        });
    });

});

