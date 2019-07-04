

const topojson = require('topojson');
const Err = require('@kartotherian/err');
const preq = require('preq');
const BBPromise = require('bluebird');
const parseWikidataValue = require('wd-type-parser');

const simpleStyleProperties = {
  fill_opacity: 'fill-opacity',
  marker_color: 'marker-color',
  marker_size: 'marker-size',
  marker_symbol: 'marker-symbol',
  stroke_opacity: 'stroke-opacity',
  stroke_width: 'stroke-width',
};

const floatRegex = /-?[0-9]+(\.[0-9]+)?/;

/**
 * @param {string} type
 * @param {object} reqParams
 * @param {string=} reqParams.ids
 * @param {string=} reqParams.query
 * @param {string=} reqParams.idcolumn
 * @param {string=} reqParams.sql
 */
class GeoShapes {
  constructor(type, reqParams, config) {
    this.config = config;

    if (!reqParams.ids && !reqParams.query) { throw new Err('"ids" or "query" parameter must be given'); }
    if (reqParams.query && !this.config.wikidataQueryService) { throw new Err('"query" parameter is not enabled'); }

    if (reqParams.ids) {
      this.ids = reqParams.ids.split(',').filter(id => id !== '');
      if (this.ids.length > this.config.maxidcount) { throw new Err('No more than %d IDs is allowed', this.config.maxidcount); }
      this.ids.forEach((val) => {
        if (!/^Q[1-9][0-9]{0,15}$/.test(val)) { throw new Err('Invalid Wikidata ID'); }
      });
    } else {
      this.ids = [];
    }
    this.type = type;
    this.metric = type + (reqParams.query ? '.wdqs' : '.ids');
    this.sparqlQuery = reqParams.query;
    this.isDefaultIdColumn = !reqParams.idcolumn;
    this.idColumn = reqParams.idcolumn || 'id';
    this.useGeoJson = !!reqParams.getgeojson;
    this.rawProperties = {};
    this.cleanProperties = {};
    this.reqParams = reqParams;
    this.db = config.db;
  }

  /**
     * Main execution method
     * @return {BBPromise}
     */
  execute(xClientIp) {
    return BBPromise.try(() => this._runWikidataQuery(xClientIp))
      .then(() => BBPromise.all([this._runSqlQuery(), this._expandProperties()]))
      .then(() => this._wrapResult());
  }

  /**
     *
     * @return {BBPromise|undefined}
     */
  _runWikidataQuery(xClientIp) {
    // If there is no query, we only use the ids given in the request
    if (!this.sparqlQuery) { return; }

    return preq.get({
      uri: this.config.wikidataQueryService,
      query: {
        format: 'json',
        query: this.sparqlQuery,
      },
      headers: Object.assign(this.config.sparqlHeaders, { 'X-Client-IP': xClientIp }),
    }).then((queryResult) => {
      if (!queryResult.headers['content-type'].startsWith('application/sparql-results+json')) {
        throw new Err('Unexpected content type %s', queryResult.headers['content-type']);
      }
      const data = queryResult.body;
      if (!data.results || !Array.isArray(data.results.bindings)) {
        throw new Err('SPARQL query result does not have "results.bindings"');
      }

      data.results.bindings.forEach((wd) => {
        if (!(this.idColumn in wd)) {
          let errMsg = 'SPARQL query result does not contain %j column.';
          if (this.isDefaultIdColumn) {
            errMsg += ' Use idcolumn argument to specify column name, or change the query to return "id" column.';
          }
          throw new Err(errMsg, this.idColumn);
        }
        const value = wd[this.idColumn];
        const id = parseWikidataValue(value, true);
        if (!id || value.type !== 'uri') {
          throw new Err('SPARQL query result id column %j is expected to be a valid Wikidata ID', this.idColumn);
        }
        if (id in this.rawProperties) {
          throw new Err('SPARQL query result contains non-unique ID %j', id);
        }
        // further parsing will be done later, once we know the object actually
        // exists in the OSM db
        delete wd[this.idColumn];
        this.rawProperties[id] = wd;
        this.ids.push(id);
      });
    });
  }

  /**
     * Retrieve all geo shapes for the given list of IDs
     * @return {BBPromise|undefined}
     */
  _runSqlQuery() {
    if (this.ids.length === 0) { return; }
    const args = [this.type === 'geoshape' ? this.config.polygonTable : this.config.lineTable, this.ids];
    const query = this.config.queries[this.reqParams.sql] || this.config.queries.default;

    if (query.params) {
      query.params.forEach((param) => {
        const paramName = param.name;
        if (!paramName || !this.reqParams[paramName]) {
          // If param name is NOT defined, we always use default,
          // without allowing user to customize it
          args.push(param.default);
        } else {
          const value = this.reqParams[paramName];
          if (floatRegex.test(value)) { throw new Err('Invalid value for param %s', paramName); }
          args.push(value);
        }
      });
    }

    return this.db.query(query.sql, args).then((rows) => {
      this.geoRows = rows;
      return this;
    });
  }

  /**
     * @return {BBPromise|undefined}
     */
  _expandProperties() {
    // Create fake geojson with the needed properties, and sanitize them via api
    // We construct valid GeoJSON with each property object in this form:
    // {
    //     "type": "Feature",
    //     "id": "...",
    //     "properties": {...},
    //     "geometry": {"type": "Point", "coordinates": [0,0]}
    // }
    const props = [];

    for (const id in this.rawProperties) {
      if (this.rawProperties[id]) {
        const prop = this.rawProperties[id];
        for (const key in prop) {
          if (prop[key]) {
            // If this is a simplestyle property with a '_' in the name instead of '-',
            // convert it to the proper syntax.
            // SPARQL is unable to produce columns with a '-' in the name.
            const newKey = simpleStyleProperties[key];
            const value = parseWikidataValue(prop[key]);
            if (newKey) {
              prop[newKey] = value;
              delete prop[key];
            } else {
              prop[key] = value;
            }
          }
        }
        props.push({
          type: 'Feature',
          id,
          properties: prop,
          geometry: { type: 'Point', coordinates: [0, 0] },
        });
      }
    }

    if (!props.length) { return; }

    return preq.post({
      uri: this.config.mwapi,
      formData: {
        format: 'json',
        formatversion: 2,
        action: 'sanitize-mapdata',
        text: JSON.stringify(props),
      },
      headers: this.config.mwapiHeaders,
    }).then((apiResult) => {
      if (apiResult.body.error) { throw new Err(apiResult.body.error); }
      if (!apiResult.body['sanitize-mapdata']) {
        throw new Err('Unexpected api action=sanitize-mapdata results');
      }
      const body = apiResult.body['sanitize-mapdata'];
      if (body.error) { throw new Err(body.error); }
      if (!body.sanitized) {
        throw new Err('Unexpected api action=sanitize-mapdata results');
      }
      const sanitized = JSON.parse(body.sanitized);
      if (!sanitized || !Array.isArray(sanitized)) {
        throw new Err('Unexpected api action=sanitize-mapdata sanitized value results');
      }
      for (const s of sanitized) {
        this.cleanProperties[s.id] = s.properties;
      }
    });
  }

  /**
     * @return {Object}
     */
  _wrapResult() {
    // If no result, return an empty result set - which greatly simplifies processing
    let features = [];
    if (this.geoRows) {
      features = this.geoRows.map((row) => {
        const feature = JSON.parse(`{"type":"Feature","id":"${row.id}","properties":{},"geometry":${row.data}}`);
        if (this.cleanProperties) {
          const wd = this.cleanProperties[row.id];
          if (wd) {
            feature.properties = wd;
          }
        }
        return feature;
      });
    }

    // TODO: Would be good to somehow monitor the average/min/max number of features
    // core.metrics.count(geoshape.metric, features.length);

    const result = {
      type: 'FeatureCollection',
      features,
    };
    if (!this.useGeoJson) {
      return topojson.topology({ data: result }, {
        // preserve all properties
        'property-transform': feature => feature.properties,
      });
    }
    return result;
  }
}

module.exports = GeoShapes;
