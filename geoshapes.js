'use strict';

var util = require('util');
var BBPromise = require('bluebird');
var postgres = require('pg-promise')({promiseLib: BBPromise});

var core, client, Err, params, query;

module.exports = function geoshapes(coreV, router) {
    return BBPromise.try(function () {
        core = coreV;
        Err = core.Err;
        params = core.getConfiguration().geoshapes;

        if (!params) {
            throw new Err("'geoshapes' parameter block is not set up in the config");
        }
        if (!params.database || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.database)) {
            throw new Err("Uri must have a valid 'database' query parameter");
        }
        if (!params.table || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.table)) {
            throw new Err("Optional uri 'table' param must be a valid value");
        }
        var clientOpts = {
            host: params.host,
            database: params.database,
            user: params.username,
            password: params.password
        };

        client = postgres(clientOpts);

        query = "SELECT way as data FROM " + self.table +
            " WHERE tags ? 'wikidata' and tags->'wikidata' = $1";

        // Check the valid structure of the table
        return getGeoData(null);

    }).then(function () {
        router.get('/shape/:id(Q[\\d]+).geojson', handler);
    });

};

/**
 * Web server (express) route handler to get geoshapes
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function handler(req, res, next) {

    var start = Date.now(),
        params = req.params,
        metric = ['geoshape'];

    return Promise.try(function () {
        return getGeoData(params.id)
    }).then(function (data) {
        core.setResponseHeaders(res);
        res.type('application/vnd.geo+json').send(data);
        core.metrics.endTiming(metric.join('.'), start);
    }).catch(function(err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}

function getGeoData(wikidataId) {
    return BBPromise.try(function() {
        if (wikidataId !== null && !/^Q[1-9][0-9]{0,10}$/.test(wikidataId)) {
            throw new Err('Invalid Wikidata ID');
        }
        return client.oneOrNone(query, [wikidataId]);
    }).then(function(row) {
        if (row) {
            return row.data;
        } else {
            return false;
        }
    })
}
