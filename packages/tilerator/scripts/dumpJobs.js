#!/usr/bin/nodejs

/**
 * Dump the entire content of the job que into the standard output as TSV
 * Accepts two optional params: redis and redisPrefix  (same as in configuration)
 */

const Promise = require('bluebird');
const _ = require('underscore');
const kue = require('kue');

Promise.promisifyAll(kue.Job);
Promise.promisifyAll(kue.Job.prototype);

const argv = require('minimist')(process.argv.slice(2));

const opts = {};
if (argv.redisPrefix) opts.prefix = argv.redisPrefix;
if (argv.redis) opts.redis = argv.redis;
const queue = Promise.promisifyAll(kue.createQueue(opts));

const headers = {};

function setVal(res, key, val) {
  let str;
  if (typeof (val) === 'string') { str = val.replace('\\', '\\\\').replace('\n', '\\n').replace('\t', '\\t'); } else { str = JSON.stringify(val); }
  res[key] = str;
  headers[key] = undefined;
}


Promise.map(['inactive', 'active', 'failed', 'complete', 'delayed'], state => queue
  .stateAsync(state)
  .then(ids => Promise.map(ids, id => kue.Job
    .getAsync(id)
    .then((job) => {
      const res = {};
      (function crush(obj, prefix, firstCol) {
        _.each(obj, (val, key) => {
          if (key[0] === '_' || (prefix === '' && key === 'client')) return;
          const key2 = (prefix + key);
          if (typeof (val) !== 'object') {
            setVal(res, key2, val);
          } else if (Array.isArray(val)) {
            if (firstCol) {
              setVal(res, key2 + firstCol, val[0]);
              setVal(res, key2, val.slice(1));
            } else {
              setVal(res, key2, val);
            }
          } else {
            crush(val, `${key2}|`, key === 'progress_data' ? 'count' : '');
          }
        });
      }(job, ''));
      return res;
    })))).then(_.flatten).then((result) => {
  const hdrs = _.keys(headers).sort();
  // eslint-disable-next-line no-console
  console.log(hdrs.join('\t'));
  _.each(result, (row) => {
    // eslint-disable-next-line no-console
    console.log(_.map(hdrs, h => row[h] || '').join('\t'));
  });
});
