/* global describe it before */

// eslint-disable-next-line strict,lines-around-directive
'use strict';

const preq = require('preq');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');


describe('page gets', function pageGets() {
  this.timeout(20000);

  before(() => server.start());

  // common URI prefix for the page
  const uri = `${server.config.uri}en.wikipedia.org/v1/page/Mulholland%20Drive%20%28film%29/`;

  it('should get the whole page body', () => preq.get({
    uri,
  }).then((res) => {
    // check the status
    assert.status(res, 200);
    // check the returned Content-Type header
    assert.contentType(res, 'text/html');
    // inspect the body
    assert.notDeepEqual(res.body, undefined, 'No body returned!');
    // this should be the right page
    if (!/<\s*?h1.+Mulholland/.test(res.body)) {
      throw new Error('Not the title I was expecting!');
    }
  }));

  it('should get only the leading section', () => preq.get({
    uri: `${uri}lead`,
  }).then((res) => {
    // check the status
    assert.status(res, 200);
    // check the returned Content-Type header
    assert.contentType(res, 'text/html');
    // inspect the body
    assert.notDeepEqual(res.body, undefined, 'No body returned!');
    // this should be the right page
    if (!/Mulholland/.test(res.body)) {
      throw new Error('Not the page I was expecting!');
    }
    // .. and should start with <div id="lead_section">
    if (!/^<div id="lead_section">/.test(res.body)) {
      throw new Error('This is not a leading section!');
    }
  }));

  it('should throw a 404 for a non-existent page', () => preq.get({
    uri: `${server.config.uri}en.wikipedia.org/v1/page/Foobar_and_friends`,
  }).then((res) => {
    // if we are here, no error was thrown, not good
    throw new Error('Expected an error to be thrown, got status: ', res.status);
  }, (err) => {
    // inspect the status
    assert.deepEqual(err.status, 404);
  }));
});
