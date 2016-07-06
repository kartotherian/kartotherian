'use strict';

var info = require('./package.json'),
    Promise = require('bluebird'),
    topojson = require('topojson'),
    postgres = require('pg-promise')({promiseLib: Promise}),
    preq = require('preq'),
    parseWikidataValue = require('wd-type-parser');

var core, client, Err, params, queries, sparqlHeaders;

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

        if (params.wikidataQueryService === undefined) {
            params.wikidataQueryService = 'https://query.wikidata.org/bigdata/namespace/wdq/sparql';
        }
        sparqlHeaders = {
            'User-Agent': info.name + '/' + info.version + ' (https://mediawiki.org/Maps)'
        };

        params.maxidcount = params.maxidcount !== undefined ? parseInt(params.maxidcount) : 500;
        if (params.maxidcount <= 0) {
            throw new Err('"geoshapes.maxidcount" must be a positive integer');
        }

        // ST_Collect and ST_Union seem to produce the same result, but since we do topojson locally, there is no point
        // to do the same optimization in both Postgress and Javascript, thus doing the simpler ST_Collect.
        // We should do a/b test later to see which is overall faster

        var subQuery = "(SELECT tags->'wikidata' as id, ST_Collect(way) as way FROM $1~ WHERE tags ? 'wikidata' and tags->'wikidata' IN ($2:csv) GROUP BY id) subq";

        let floatRe = /-?[0-9]+(\.[0-9]+)?/;
        queries = {
            direct: {
                sql: "SELECT id, ST_AsGeoJSON(ST_Transform(way, 4326)) as data FROM " + subQuery
            },
            simplify: {
                sql: "SELECT id, ST_AsGeoJSON(ST_Transform(ST_Simplify(way, $3), 4326)) as data FROM " + subQuery,
                params: [{
                    name: 'arg1',
                    default: 10000,
                    regex: floatRe
                }]
            },
            simplifyarea: {
                // Convert geometry (in mercator) to a bbox, calc area, sqrt of that
                // Proposed by @pnorman
                sql: "SELECT id, ST_AsGeoJSON(ST_Transform(ST_Simplify(way, $3*sqrt(ST_Area(ST_Envelope(way)))), 4326)) as data FROM " + subQuery,
                params: [{
                    name: 'arg1',
                    default: 0.01,
                    regex: floatRe
                }]
            },
            removerepeat: {
                sql: "SELECT id, ST_AsGeoJSON(ST_Transform(ST_RemoveRepeatedPoints(way, $3), 4326)) as data FROM " + subQuery,
                params: [{
                    name: 'arg1',
                    default: 10000,
                    regex: floatRe
                }]
            }
        };

        // Which query to use by default
        let defaultQ = queries.simplifyarea;

        if (params.allowUserQueries) {
            queries.default = defaultQ;
        } else {
            // Delete all queries except the default one, and remove parameter names to prevent user parameters
            queries = {default: defaultQ};
            if (defaultQ.params) {
                defaultQ.params.forEach(function (param) {
                    delete param.name;
                });
            }
        }

        client = postgres({
            host: params.host,
            database: params.database,
            user: params.user,
            password: params.password
        });

        // Check the valid structure of the table - use invalid id
        return getGeoData({ids: 'Q123456789'});

    }).then(function () {
        router.get('/shape', handler); // obsolete
        router.get('/geoshape', handler);
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

    return getGeoData(req.query).then(function (geodata) {
        core.setResponseHeaders(res);
        res.type('application/vnd.geo+json').json(geodata);
        core.metrics.endTiming(metric.join('.'), start);
    }).catch(function (err) {
        return core.reportRequestError(err, res);
    }).catch(next);
}

/**
 * @param {object} reqParams
 * @param {string=} reqParams.ids
 * @param {string=} reqParams.query
 * @param {string=} reqParams.idcolumn
 * @param {string=} reqParams.sql
 * @return {*}
 */
function getGeoData(reqParams) {
    var ids = [], wdResult, idCol;
    return Promise.try(function () {
        if (!reqParams.ids && !reqParams.query) throw new Err('"ids" or "query" parameter must be given');
        if (reqParams.query && !params.wikidataQueryService) throw new Err('"query" parameter is not enabled');

        if (reqParams.ids) {
            ids = reqParams.ids.split(',').filter(function (id) {
                return id !== '';
            });
            if (ids.length > params.maxidcount) throw new Err('No more than %d IDs is allowed', params.maxidcount);
            ids.forEach(function (val) {
                if (!/^Q[1-9][0-9]{0,15}$/.test(val)) throw new Err('Invalid Wikidata ID');
            });
        }
        if (!reqParams.query) {
            return;
        }

        return preq.get({
            uri: params.wikidataQueryService,
            query: {
                format: 'json',
                query: reqParams.query
            },
            headers: sparqlHeaders
        }).then(function (queryResult) {
            if (queryResult.headers['content-type'] !== 'application/sparql-results+json') {
                throw new Err('Unexpected content type %s', queryResult.headers['content-type']);
            }
            let data = JSON.parse(queryResult.body.toString());
            idCol = reqParams.idcolumn || 'id';
            if (!data.results || !Array.isArray(data.results.bindings)) {
                throw new Err('SPARQL query result does not have "results.bindings"');
            }
            wdResult = {};
            data.results.bindings.forEach(function (wd) {
                if (!(idCol in wd)) {
                    throw new Err('SPARQL query result does not contain %j column.' +
                        (reqParams.idcolumn ? '' :
                            ' Use idcolumn argument to specify column name, or change the query to return "id" column.'),
                        idCol);
                }
                let value = wd[idCol],
                    id = parseWikidataValue(value, true);
                if (!id || value.type !== 'uri') {
                    throw new Err('SPARQL query result id column %j is expected to be a valid Wikidata ID', idCol);
                }
                if (id in wdResult) {
                    throw new Err('SPARQL query result contains non-unique ID %j', id);
                }
                // further parsing will be done later, once we know the object actually exists in the OSM db
                wdResult[id] = wd;
                ids.push(id);
            });
        });
    }).then(function () {
        if (ids.length === 0) return;
        var args = [params.table, ids];
        let query = reqParams && queries.hasOwnProperty(reqParams.sql) ? queries[reqParams.sql] : queries.default;
        if (query.params) {
            query.params.forEach(function (param) {
                let paramName = param.name;
                if (!paramName || !reqParams.hasOwnProperty(paramName)) {
                    // If param name is NOT defined, we always use default, without allowing user to customize it
                    args.push(param.default);
                } else {
                    let value = reqParams[paramName];
                    if (!param.regex.test(value)) throw new Err('Invalid value for param %s', paramName);
                    args.push(value);
                }
            });
        }
        return client.query(query.sql, args);
    }).then(function (rows) {
        let features;
        if (rows) {
            features = rows.map(function (row) {
                let feature = JSON.parse('{"type":"Feature","id":"' + row.id + '","geometry":' + row.data + '}');
                if (wdResult) {
                    let wd = wdResult[row.id];
                    if (wd) {
                        for (let key in wd) {
                            if (key !== idCol && wd.hasOwnProperty(key)) {
                                if (feature.properties === undefined) feature.properties = {};
                                feature.properties[key] = parseWikidataValue(wd[key]);
                            }
                        }
                    }
                }
                return feature;
            });
        } else {
            // Return an empty resultset - which greatly simplifies processing
            features = [];
        }
        return topojson.topology({
            data: {type: "FeatureCollection", features: features}
        }, {
            "property-transform": function (feature) {
                // preserve all properties
                return feature.properties;
            }
        });
    });
}
