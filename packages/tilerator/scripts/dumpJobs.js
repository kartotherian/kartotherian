#!/usr/bin/nodejs

/**
 * Dump the entire content of the job que into the standard output as TSV
 * Accepts two optional params: redis and redisPrefix  (same as in configuration)
 */

'use strict';

var BBPromise = require('bluebird');
var util = require('util');
var _ = require('underscore');

var kue = require('kue');
BBPromise.promisifyAll(kue.Job);
BBPromise.promisifyAll(kue.Job.prototype);

var argv = require('minimist')(process.argv.slice(2));

var opts = {};
if (argv.redisPrefix) opts.prefix = argv.redisPrefix;
if (argv.redis) opts.redis = argv.redis;
var queue = BBPromise.promisifyAll(kue.createQueue(opts));

var headers = {};

function setVal(res, key, val) {
    var str;
    if (typeof(val) === 'string')
        str = val.replace('\\', '\\\\').replace('\n', '\\n').replace('\t', '\\t');
    else
        str = JSON.stringify(val);
    res[key] = str;
    headers[key] = undefined;
}


BBPromise.map(['inactive', 'active', 'failed', 'complete', 'delayed'], function (state) {
    return queue
        .stateAsync(state)
        .then(function (ids) {
            return BBPromise.map(ids, function (id) {
                return kue.Job
                    .getAsync(id)
                    .then(function (job) {
                        var res = {};
                        (function crush(obj, prefix, firstCol) {
                            _.each(obj, function (val, key) {
                                if (key[0] === '_' || (prefix === '' && key === 'client')) return;
                                var key2 = (prefix + key);
                                if (typeof(val) !== 'object') {
                                    setVal(res, key2, val);
                                } else if (Array.isArray(val)) {
                                    if (firstCol) {
                                        setVal(res, key2 + firstCol, val[0]);
                                        setVal(res, key2, val.slice(1));
                                    } else {
                                        setVal(res, key2, val);
                                    }
                                } else {
                                    crush(val, key2 + '|', key === 'progress_data' ? 'count' : '');
                                }
                            });
                        })(job, '');
                        return res;
                    })
            })
        });
}).then(_.flatten).then(function (result) {
    var hdrs = _.keys(headers).sort();
    console.log(hdrs.join('\t'));
    _.each(result, function(row) {
        console.log(_.map(hdrs, function(h) {
            return row[h] || '';
        }).join('\t'));
    });
});
