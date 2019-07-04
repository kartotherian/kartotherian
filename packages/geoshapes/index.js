'use strict';

const yaml = require('js-yaml');
const fs = require('fs');
const info = require('./package.json');
const BBPromise = require('bluebird');
const Err = require('@kartotherian/err');
const postgres = require('pg-promise')({ promiseLib: BBPromise });
const GeoShapes = require('./lib/geoshapes');

/**
 * Web server (express) route handler to get geoshapes
 * @param {string} type
 * @param {object} req request object
 * @param {object} req.query request object's query
 * @param {object} res response object
 * @param {Function} next will be called if request is not handled
 */
function handler(core, config, type, req, res, next) {

    let start = Date.now(),
        geoshape;

    return BBPromise.try(
        () => {
            geoshape = new GeoShapes(type, req.query, config);
            const lowerHeaders = Object.keys(req.headers).reduce((newHeaders, key) => {
                newHeaders[key.toLowerCase()] = req.headers[key];
                return newHeaders;
            }, {});
            return geoshape.execute(lowerHeaders['x-client-ip']);
        }
    ).then(geodata => {
        core.setResponseHeaders(res);
        res.type('application/vnd.geo+json').json(geodata);
        core.metrics.endTiming(geoshape.metric, start);
    }).catch(
        err => core.reportRequestError(err, res)
    ).catch(next);
}

function loadServiceConfig(core) {
    return BBPromise.try(() => {
        let config = core.getConfiguration().geoshapes;

        // TODO: we shouldn't use it directly,
        // but instead refactor out mwapi lib from node_service_template
        // and use the proper host
        let mwapi = core.getConfiguration().mwapi_req;
        config.mwapi = mwapi && mwapi.uri || 'https://en.wikipedia.org/w/api.php';

        // Load queries from yaml file
        config.queries = yaml.load(fs.readFileSync( __dirname + '/queries.yaml', 'utf8'));
        return config;
    });
}

function loadDBHandler(config) {
    return BBPromise.try(() => {

        if (!config.database || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(config.database)) {
            throw new Err('"geoshapes" parameters must specify "database"');
        }

        config.db = postgres({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password
        });

        return config;
    });
}

function checkValidStructure(config) {
    // Check the valid structure of the table - use invalid id
    return BBPromise.all([
        new GeoShapes('geoshape', { ids: 'Q123456789' }, config).execute(),
        new GeoShapes('geoline', { ids: 'Q123456789' }, config).execute()
    ]).then(() => {
        return config;
    });
}

function initService(config) {

    return BBPromise.try(() => {

        let userAgent = info.name + '/' + info.version + ' (https://mediawiki.org/Maps)';

        if (!config) {
            throw new Err('"geoshapes" parameter block is not set up in the config');
        }
        if (!config.wikidataQueryService) {
            throw new Err('"geoshapes" parameters must specify "wikidataQueryService"');
        }

        config.sparqlHeaders = {
            'User-Agent': userAgent,
            Accept: 'application/sparql-results+json',
        };

        config.mwapiHeaders = {
            'User-Agent': userAgent,
            Host: 'en.wikipedia.org'
        };

        config.maxidcount = config.maxidcount !== undefined ? parseInt(config.maxidcount) : 500;
        if (config.maxidcount <= 0) {
            throw new Err('"geoshapes.maxidcount" must be a positive integer');
        }

        // Which query to use by default
        let defaultQ = config.queries.simplifyarea;

        if (config.allowUserQueries) {
            config.queries.default = defaultQ;
        } else {
            // Delete all queries except the default one, and remove parameter
            // names to prevent user parameters
            config.queries = { default: defaultQ };
            if (defaultQ.params) {
                defaultQ.params.forEach(param => {
                    delete param.name;
                });
            }
        }

        return config;
    });
}

module.exports = (core, router) => {

    loadServiceConfig(core)
    .then(loadDBHandler)
    .then(initService)
    .then(checkValidStructure)
    .then(config => { // Load routes
        router.get('/shape', (req, res, next) => handler(core, config, 'geoshape', req, res, next)); // obsolete
        router.get('/geoshape', (req, res, next) => handler(core, config, 'geoshape', req, res, next));
        router.get('/geoline', (req, res, next) => handler(core, config, 'geoline', req, res, next));
    })
    .catch(err => {
        core.log('error', 'geoshapes support failed to load, skipping: ' + err + '\n' + err.stack);
        // still allow loading
    });
};
