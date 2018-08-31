/* global describe it before */

// eslint-disable-next-line strict,lines-around-directive
'use strict';

const fs = require('fs');
const preq = require('preq');
const nock = require('nock');
const wait = require('wait-as-promised');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');

function deleteIfExist(path) {
  try {
    fs.unlinkSync(path);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

function fileExists(file) {
  try {
    const stats = fs.statSync(file);
    return stats.isFile();
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  return false;
}

describe('express app', function expressApp() {
  this.timeout(20000);

  before(() => server.start());

  it('should get robots.txt', () => preq.get({
    uri: `${server.config.uri}robots.txt`,
  }).then((res) => {
    assert.deepEqual(res.status, 200);
    assert.deepEqual(res.headers.disallow, '/');
  }));

  it('moves a tile from source to destination', () => {
    // ensure file doesn't exist yet
    deleteIfExist('test/filestore/6/33/22.png');

    // Mock the eventlogging server to receive resource change events from jobprocessor
    // (will log error output to the console if no request is received)
    nock('http://localhost:8085')
      .post('/v1/events')
      .reply(200);

    return preq.post({
      uri: `${server.config.uri}add?generatorId=gen&storageId=file&zoom=6&x=33&y=22`,
    }).then((res) => {
      assert.deepEqual(res.status, 200);
      assert.deepEqual(res.body[0], 'Z=6; 1 tile at [33,22] (idx=1577); gen→file');

      return wait(() => fileExists('test/filestore/6/33/22.png'), { timeout: 15000 });
    });
  });
});
