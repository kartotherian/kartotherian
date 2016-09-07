'use strict';

var info = require('./package.json'),
    Promise = require('bluebird'),
    topojson = require('topojson'),
    postgres = require('pg-promise')({promiseLib: Promise}),
    preq = require('preq'),
    parseWikidataValue = require('wd-type-parser');

var core, client, Err, config;

module.exports = function geoshapes(coreV, router) {
    return Promise.try(function () {
        core = coreV;
        Err = core.Err;
        config = core.getConfiguration().geoshapes;

        let userAgent = info.name + '/' + info.version + ' (https://mediawiki.org/Maps)';

        if (!config) {
            throw new Err('"geoshapes" parameter block is not set up in the config');
        }
        if (!config.database || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(config.database)) {
            throw new Err('"geoshapes" parameters must specify "database"');
        }

        if (config.wikidataQueryService === undefined) {
            config.wikidataQueryService = 'https://query.wikidata.org/bigdata/namespace/wdq/sparql';
        }
        config.sparqlHeaders = {
            'User-Agent': userAgent,
            'Accept': 'application/sparql-results+json',
        };

        // TODO: we shouldn't use it directly,
        // but instead refactor out mwapi lib from node_service_template
        // and use the proper host
        let mwapi = core.getConfiguration().mwapi_req;
        config.mwapi = mwapi && mwapi.uri || 'https://en.wikipedia.org/w/api.php';
        config.mwapiHeaders = {
            'User-Agent': userAgent,
            'Host': 'en.wikipedia.org'
        };

        config.maxidcount = config.maxidcount !== undefined ? parseInt(config.maxidcount) : 500;
        if (config.maxidcount <= 0) {
            throw new Err('"geoshapes.maxidcount" must be a positive integer');
        }

        // ST_Collect and ST_Union seem to produce the same result, but since we do topojson locally, there is no point
        // to do the same optimization in both Postgress and Javascript, thus doing the simpler ST_Collect.
        // We should do a/b test later to see which is overall faster

        var subQuery = "(SELECT tags->'wikidata' as id, ST_Collect(way) as way FROM $1~ WHERE tags ? 'wikidata' and tags->'wikidata' IN ($2:csv) GROUP BY id) subq";

        let floatRe = /-?[0-9]+(\.[0-9]+)?/;
        config.queries = {
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
                    default: 0.001,
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
        let defaultQ = config.queries.simplifyarea;

        if (config.allowUserQueries) {
            config.queries.default = defaultQ;
        } else {
            // Delete all queries except the default one, and remove parameter names to prevent user parameters
            config.queries = {default: defaultQ};
            if (defaultQ.params) {
                defaultQ.params.forEach(function (param) {
                    delete param.name;
                });
            }
        }

        client = postgres({
            host: config.host,
            database: config.database,
            user: config.user,
            password: config.password
        });

        // Check the valid structure of the table - use invalid id
        return new GeoShapes({ids: 'Q123456789'}).execute();

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

    return Promise.try(function () {
        return new GeoShapes(req.query).execute();
    }).then(function (geodata) {
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
 */
function GeoShapes(reqParams) {
    if (!reqParams.ids && !reqParams.query) throw new Err('"ids" or "query" parameter must be given');
    if (reqParams.query && !config.wikidataQueryService) throw new Err('"query" parameter is not enabled');

    if (reqParams.ids) {
        this.ids = reqParams.ids.split(',').filter(function (id) {
            return id !== '';
        });
        if (this.ids.length > config.maxidcount) throw new Err('No more than %d IDs is allowed', config.maxidcount);
        this.ids.forEach(function (val) {
            if (!/^Q[1-9][0-9]{0,15}$/.test(val)) throw new Err('Invalid Wikidata ID');
        });
    } else {
        this.ids = [];
    }
    this.sparqlQuery = reqParams.query;
    this.isDefaultIdColumn = !reqParams.idcolumn;
    this.idColumn = reqParams.idcolumn || 'id';
    this.rawProperties = {};
    this.cleanProperties = {};
    this.reqParams = reqParams;
}


/**
 *
 * @return {Promise}
 */
GeoShapes.prototype.execute = function execute () {
    return Promise.bind(this).then(function () {
        return this.runWikidataQuery();
    }).then(function () {
        return Promise.all([
            this.runSqlQuery(),
            this.expandProperties()
        ]);
    }).then(function () {
        return this.wrapResult();
    });
};

/**
 *
 * @return {Promise|undefined}
 */
GeoShapes.prototype.runWikidataQuery = function runWikidataQuery () {
    let self = this;
    // If there is no query, we only use the ids given in the request
    if (!self.sparqlQuery) return;

    return preq.get({
        uri: config.wikidataQueryService,
        query: {
            format: 'json',
            query: self.sparqlQuery
        },
        headers: config.sparqlHeaders
    }).then(function (queryResult) {
        if (queryResult.headers['content-type'] !== 'application/sparql-results+json') {
            throw new Err('Unexpected content type %s', queryResult.headers['content-type']);
        }

        // Body arrives as a buffer, need to decode and parse
        let data = JSON.parse(queryResult.body.toString());
        if (!data.results || !Array.isArray(data.results.bindings)) {
            throw new Err('SPARQL query result does not have "results.bindings"');
        }

        data.results.bindings.forEach(function (wd) {
            if (!(self.idColumn in wd)) {
                let errMsg = 'SPARQL query result does not contain %j column.';
                if (self.isDefaultIdColumn) {
                    errMsg += ' Use idcolumn argument to specify column name, or change the query to return "id" column.';
                }
                throw new Err(errMsg, self.idColumn);
            }
            let value = wd[self.idColumn],
                id = parseWikidataValue(value, true);
            if (!id || value.type !== 'uri') {
                throw new Err('SPARQL query result id column %j is expected to be a valid Wikidata ID', self.idColumn);
            }
            if (id in self.rawProperties) {
                throw new Err('SPARQL query result contains non-unique ID %j', id);
            }
            // further parsing will be done later, once we know the object actually exists in the OSM db
            delete wd[self.idColumn];
            self.rawProperties[id] = wd;
            self.ids.push(id);
        });
    });
};

/**
 * Retrieve all geo shapes for the given list of IDs
 * @return {Promise|undefined}
 */
GeoShapes.prototype.runSqlQuery = function runSqlQuery () {
    let self = this;
    if (self.ids.length === 0) return;

    var args = [config.table, self.ids];
    let query = config.queries.hasOwnProperty(self.reqParams.sql)
        ? config.queries[self.reqParams.sql]
        : config.queries.default;

    if (query.params) {
        query.params.forEach(function (param) {
            let paramName = param.name;
            if (!paramName || !self.reqParams.hasOwnProperty(paramName)) {
                // If param name is NOT defined, we always use default, without allowing user to customize it
                args.push(param.default);
            } else {
                let value = self.reqParams[paramName];
                if (!param.regex.test(value)) throw new Err('Invalid value for param %s', paramName);
                args.push(value);
            }
        });
    }

    return client.query(query.sql, args).then(function (rows) {
        self.geoRows = rows;
        return self;
    });
};

/**
 * @return {Promise|undefined}
 */
GeoShapes.prototype.expandProperties = function expandProperties () {
    // Create fake geojson with the needed properties, and sanitize them via api
    // We construct valid GeoJSON with each property object in this form:
    // {
    //     "type": "Feature",
    //     "id": "...",
    //     "geometry": {"type": "Point", "coordinates": [0,0]},
    //     "properties": {...}
    // }
    let self = this,
        props = [];

    for (let id in self.rawProperties) {
        if (self.rawProperties.hasOwnProperty(id)) {
            let prop = self.rawProperties[id];
            for (let key in prop) {
                if (prop.hasOwnProperty(key)) {
                    prop[key] = parseWikidataValue(prop[key]);
                }
            }
            props.push({
                "type": "Feature",
                "id": id,
                "geometry": {"type": "Point", "coordinates": [0, 0]},
                "properties": prop
            });
        }
    }

    if (!props.length) return;

    return preq.post({
        uri: config.mwapi,
        formData: {
            format: 'json',
            formatversion: 2,
            action: 'sanitize-mapdata',
            text: JSON.stringify(props)
        },
        headers: config.mwapiHeaders
    }).then(function (apiResult) {
        if (apiResult.error) throw new Err(apiResult.error);
        if (!apiResult.body || !apiResult.body['sanitize-mapdata'] || !apiResult.body['sanitize-mapdata'].sanitized) {
            throw new Err('Unexpected api action=sanitize-mapdata results');
        }
        let sanitized = JSON.parse(apiResult.body['sanitize-mapdata'].sanitized);
        if (!sanitized || !Array.isArray(sanitized)) {
            throw new Err('Unexpected api action=sanitize-mapdata sanitized value results');
        }
        for (let s of sanitized) {
            self.cleanProperties[s.id] = s.properties;
        }
    });
};

/**
 * @return {Promise}
 */
GeoShapes.prototype.wrapResult = function wrapResult () {
    let self = this;

    // If no result, return an empty result set - which greatly simplifies processing
    let features = [];
    if (self.geoRows) {
        features = self.geoRows.map(function (row) {
            let feature = JSON.parse('{"type":"Feature","id":"' + row.id + '","geometry":' + row.data + '}');
            if (self.cleanProperties) {
                let wd = self.cleanProperties[row.id];
                if (wd) {
                    feature.properties = wd;
                }
            }
            return feature;
        });
    }

    return topojson.topology({
        data: {type: "FeatureCollection", features: features}
    }, {
        "property-transform": function (feature) {
            // preserve all properties
            return feature.properties;
        }
    });
};
