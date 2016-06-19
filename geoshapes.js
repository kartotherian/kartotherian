'use strict';

var util = require('util');
var BBPromise = require('bluebird');
var postgres = require('pg-promise')({promiseLib: BBPromise});

var core, client, Err, params, queries;

module.exports = function geoshapes(coreV, router) {
    return BBPromise.try(function () {
        core = coreV;
        Err = core.Err;
        params = core.getConfiguration().geoshapes;

        if (!params) {
            throw new Err("'geoshapes' parameter block is not set up in the config");
        }
        if (!params.database || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.database)) {
            throw new Err("'geoshapes' parameters must specify 'database'");
        }
        if (!params.table || !/^[a-zA-Z][-a-zA-Z0-9]*$/.test(params.table)) {
            throw new Err("'geoshapes' parameters must specify 'table'");
        }
        client = postgres({
            host: params.host,
            database: params.database,
            user: params.user,
            password: params.password
        });

        var preffix = "SELECT ST_AsGeoJSON(ST_Transform(",
            suffix = ", 4326)) as data FROM " + params.table + " WHERE tags ? 'wikidata' and tags->'wikidata' = $1";


        let floatRe = /-?[0-9]+(\.[0-9]+)?/;
        queries = {
            default: {sql: preffix + 'way' + suffix},
            simplify: {
                sql: preffix + 'ST_Simplify(way, $2)' + suffix,
                params: ['tolerance'],
                regex: [floatRe]
            },
            simplifysqrt: {
                sql: preffix + 'ST_Simplify(way, $2*sqrt(ST_Area(ST_envelope(way))))' + suffix,
                params: ['mult'],
                regex: [floatRe]
            },
            removerepeat: {
                sql: preffix + 'ST_RemoveRepeatedPoints(way, $2)' + suffix,
                params: ['tolerance'],
                regex: [floatRe]
            }
        };

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
        qparams = req.query,
        metric = ['geoshape'];

    return Promise.try(function () {
        return getGeoData(params.id, qparams)
    }).then(function (geodata) {
        core.setResponseHeaders(res);
        res.type('application/vnd.geo+json').send('{"type":"Feature","geometry":' + geodata + '}');
        core.metrics.endTiming(metric.join('.'), start);
    }).catch(function(err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}

function getGeoData(wikidataId, qparams) {
    return BBPromise.try(function() {
        if (wikidataId !== null && !/^Q[1-9][0-9]{0,10}$/.test(wikidataId)) {
            throw new Err('Invalid Wikidata ID');
        }
        var args = [wikidataId];
        let query = qparams && queries.hasOwnProperty(qparams.sql) ? queries[qparams.sql] : queries.default;
        if (query.params) {
            query.params.forEach(function(param, i) {
                if (!qparams.hasOwnProperty(param)) throw new Err('Missing param %s', param);
                if (!query.regex[i].test(qparams[param])) throw new Err('Invalid value for param %s', param);
                args.push(qparams[param]);
            });
        }
        return client.oneOrNone(queries, args);
    }).then(function(row) {
        if (row) {
            return row.data;
        } else {
            return false;
        }
    })
}
