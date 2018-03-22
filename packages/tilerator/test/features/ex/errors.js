/* global describe it before */

// eslint-disable-next-line strict,lines-around-directive
'use strict';

const preq = require('preq');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');


describe('errors', function errors() {
  this.timeout(20000);

  before(() => server.start());

  // common URI prefix for the errors
  const uri = `${server.config.uri}ex/err/`;

  it('array creation error', () => preq.get({
    uri: `${uri}array`,
  }).then((res) => {
    // if we are here, no error was thrown, not good
    throw new Error(`Expected an error to be thrown, got status: ${res.status}`);
  }, (err) => {
    // inspect the status
    assert.deepEqual(err.status, 500);
    // check the error title
    assert.deepEqual(err.body.title, 'RangeError');
  }));

  it('file read error', () => preq.get({
    uri: `${uri}file`,
  }).then((res) => {
    // if we are here, no error was thrown, not good
    throw new Error(`Expected an error to be thrown, got status: ${res.status}`);
  }, (err) => {
    // inspect the status
    assert.deepEqual(err.status, 500);
    // check the error title
    assert.deepEqual(err.body.title, 'Error');
  }));

  it('constraint check error', () => preq.get({
    uri: `${uri}manual/error`,
  }).then((res) => {
    // if we are here, no error was thrown, not good
    throw new Error(`Expected an error to be thrown, got status: ${res.status}`);
  }, (err) => {
    // inspect the status
    assert.deepEqual(err.status, 500);
    // check the error title
    assert.deepEqual(err.body.title, 'Error');
  }));

  it('access denied error', () => preq.get({
    uri: `${uri}manual/deny`,
  }).then((res) => {
    // if we are here, no error was thrown, not good
    throw new Error(`Expected an error to be thrown, got status: ${res.status}`);
  }, (err) => {
    // inspect the status
    assert.deepEqual(err.status, 403);
    // check the error title
    assert.deepEqual(err.body.type, 'access_denied');
  }));

  it('authorisation error', () => preq.get({
    uri: `${uri}manual/auth`,
  }).then((res) => {
    // if we are here, no error was thrown, not good
    throw new Error(`Expected an error to be thrown, got status: ${res.status}`);
  }, (err) => {
    // inspect the status
    assert.deepEqual(err.status, 401);
    // check the error title
    assert.deepEqual(err.body.type, 'unauthorized');
  }));
});
