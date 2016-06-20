'use strict';

var util = require('util');
var Promise = require('bluebird');
var topojson = require('topojson');
var postgres = require('pg-promise')({promiseLib: Promise});

var core, client, Err, params, queries;

module.exports = function geoshapes(coreV, router) {
    return Promise.try(function () {
        core = coreV;
        Err = core.Err;
        params = core.getConfiguration().geoshapes;

        if (!params) {
            throw new Err('"geoshapes" parameter block is not set up in the config');
        }
        if (!params.database || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(params.database)) {
            throw new Err('"geoshapes" parameters must specify "database"');
        }
        client = postgres({
            host: params.host,
            database: params.database,
            user: params.user,
            password: params.password
        });

        params.maxidcount = params.maxidcount !== undefined ? parseInt(params.maxidcount) : 500;
        if (params.maxidcount <= 0) {
            throw new Err('"geoshapes.maxidcount" must be a positive integer');
        }

        // ST_Collect and ST_Union seem to produce the same result, but since we do topojson locally, there is no point
        // to do the same optimization in both Postgress and Javascript, thus doing the simpler ST_Collect.
        // We should do a/b test later to see which is overall faster
        var preffix = "SELECT tags->'wikidata' as id, ST_AsGeoJSON(ST_Transform(ST_Collect(",
            suffix = "), 4326)) as data FROM $1~ WHERE tags ? 'wikidata' and tags->'wikidata' IN ($2:csv) GROUP BY id";

        let floatRe = /-?[0-9]+(\.[0-9]+)?/;
        queries = {
            default: {
                sql: preffix + 'way' + suffix
            },
            simplify: {
                sql: preffix + 'ST_Simplify(way, $3)' + suffix,
                params: ['tolerance'],
                regex: [floatRe]
            },
            simplifysqrt: {
                sql: preffix + 'ST_Simplify(way, $3*sqrt(ST_Area(ST_envelope(way))))' + suffix,
                params: ['mult'],
                regex: [floatRe]
            },
            removerepeat: {
                sql: preffix + 'ST_RemoveRepeatedPoints(way, $3)' + suffix,
                params: ['tolerance'],
                regex: [floatRe]
            }
        };

        // Check the valid structure of the table - use invalid id
        return getGeoData({q: 'Q123456789'});

    }).then(function () {
        router.get('/shape', handler);
    }).catch(function (err) {
        core.log('warn', 'geoshapes support failed to load, skipping: ' + err);
        // still allow loading
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
        metric = ['geoshape'];

    return Promise.try(function () {
        return getGeoData(req.query)
    }).then(function (geodata) {
        core.setResponseHeaders(res);
        res.type('application/vnd.geo+json').json(geodata);
        core.metrics.endTiming(metric.join('.'), start);
    }).catch(function (err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}

function getGeoData(reqParams) {
    return Promise.try(function () {
        if (!reqParams.q) throw new Err('Missing q parameter');
        var wikidataIds = reqParams.q.split(',');
        if (wikidataIds.length > params.maxidcount) throw new Err('No more than %d IDs is allowed', params.maxidcount);
        wikidataIds.forEach(function (val) {
            if (!/^Q[1-9][0-9]{0,15}$/.test(val)) throw new Err('Invalid Wikidata ID');
        });
        var args = [params.table, wikidataIds];
        let query = reqParams && queries.hasOwnProperty(reqParams.sql) ? queries[reqParams.sql] : queries.default;
        if (query.params) {
            query.params.forEach(function (param, i) {
                if (!reqParams.hasOwnProperty(param)) throw new Err('Missing param %s', param);
                if (!query.regex[i].test(reqParams[param])) throw new Err('Invalid value for param %s', param);
                args.push(reqParams[param]);
            });
        }
        return client.query(query.sql, args);
    }).then(function (rows) {
        if (rows) {
            var features = rows.map(function (row) {
                return JSON.parse('{"type":"Feature","id":"' + row.id + '","geometry":' + row.data + '}');
            });
            var collection = {type: "FeatureCollection", features: features};
            return topojson.topology({collection: collection});
        } else {
            return false;
        }
    });
}
