/* global describe it before */

// eslint-disable-next-line strict,lines-around-directive
'use strict';

const preq = require('preq');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');


describe('express app', function expressApp() {
  this.timeout(20000);

  before(() => server.start());

  it('should get robots.txt', () => preq.get({
    uri: `${server.config.uri}robots.txt`,
  }).then((res) => {
    assert.deepEqual(res.status, 200);
    assert.deepEqual(res.headers.disallow, '/');
  }));

  it('should set CORS headers', () => {
    if (server.config.service.conf.cors === false) {
      return true;
    }
    return preq.get({
      uri: `${server.config.uri}robots.txt`,
    }).then((res) => {
      assert.deepEqual(res.status, 200);
      assert.deepEqual(res.headers['access-control-allow-origin'], '*');
      assert.deepEqual(!!res.headers['access-control-allow-headers'], true);
      assert.deepEqual(!!res.headers['access-control-expose-headers'], true);
    });
  });

  it('should set CSP headers', () => {
    if (server.config.service.conf.csp === false) {
      return true;
    }
    return preq.get({
      uri: `${server.config.uri}robots.txt`,
    }).then((res) => {
      assert.deepEqual(res.status, 200);
      assert.deepEqual(res.headers['x-xss-protection'], '1; mode=block');
      assert.deepEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
      assert.deepEqual(res.headers['content-security-policy'], 'default-src');
      assert.deepEqual(res.headers['x-content-security-policy'], 'default-src');
      assert.deepEqual(res.headers['x-webkit-csp'], 'default-src');
    });
  });

  it.skip('should get static content gzipped', () => preq.get({
    uri: `${server.config.uri}static/index.html`,
    headers: {
      'accept-encoding': 'gzip, deflate',
    },
  }).then((res) => {
    // check that the response is gzip-ed
    assert.deepEqual(res.headers['content-encoding'], 'gzip', 'Expected gzipped contents!');
  }));

  it('should get static content uncompressed', () => preq.get({
    uri: `${server.config.uri}static/index.html`,
    headers: {
      'accept-encoding': '',
    },
  }).then((res) => {
    // check that the response is gzip-ed
    assert.deepEqual(res.headers['content-encoding'], undefined, 'Did not expect gzipped contents!');
  }));
});
