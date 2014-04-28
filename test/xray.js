var tilelive = require('tilelive');
var assert = require('assert');
var Testsource = require('./testsource');
var xray = require('..').xray;

// Tilelive test source.
tilelive.protocols['test:'] = Testsource;

describe('xray', function() {
    it('invalid', function(done) {
        new xray({}, function(err) {
            assert.equal('Error: opts.uri or opts.source must be set', err.toString());
            done();
        });
    });
    it('invalid-novector', function(done) {
        new xray({uri:'test:///invalid-novector'}, function(err) {
            assert.equal('Error: source must contain a vector_layers property', err.toString());
            done();
        });
    });
    it('valid', function(done) {
        new xray({uri:'test:///a'}, function(err, source) {
            assert.ifError(err);
            assert.ok(!!source);
            done();
        });
    });
});
