'use strict';

let assert = require('assert'),
  jsYaml = require('js-yaml'),
  YamlLoader = require('..').YamlLoader;

function test(opts, expected) {
  return () => {
    opts.uri = opts.uri || 'tmsource://';
    let loader = new YamlLoader(opts, (v, n) => v);
    let actual = loader.update(jsYaml.safeDump(opts.yaml));
    assert.strictEqual(actual, jsYaml.safeDump(expected));
  }
}

function yaml(opts) {
  opts = opts || {};
  opts.format = opts.format || 'tmsource';

  var docs = {
    'tmsource': {
      description: "sample tmsource yaml",
      Layer: [
        {
          id: 'landuse',
          Datasource: {
            dbname: 'gis',
            host: '',
            type: 'postgis'
          }
        },
        {
          id: 'other_layer',
          Datasource: {
            host: '',
            type: 'postgis'
          }
        }
      ]
    },
    'tmstyle': {
      description: "sample tmstyle yaml",
      layers: [
        'landuse',
        'other_layer'
      ]
    }
  };

  return docs[opts.format];
}

describe('yamlLoader', () => {

  it('unmodified', test({yaml: 'abc'}, 'abc'));

  it('yamlSetDataSource', test({
    yaml: yaml(),
    yamlSetDataSource: {
      'if': {
        dbname: 'gis',
        host: '',
        type: 'postgis'
      },
      'set': {
        host: 'localhost',
        user: 'username',
        password: 'password'
      }
    }
  }, {
    description: "sample tmsource yaml",
    Layer: [
      {
        id: 'landuse',
        Datasource: {
          dbname: 'gis',
          host: 'localhost',
          type: 'postgis',
          user: 'username',
          password: 'password'
        }
      },
      {
        id: 'other_layer',
        Datasource: {
          host: '',
          type: 'postgis'
        }
      }
    ]
  }));

  it('yamlSetParams', test({
    yaml: yaml(),
    yamlSetParams: {
      source: 'osm-pbf'
    }
  }, {
    description: "sample tmsource yaml",
    Layer: [
      {
        id: 'landuse',
        Datasource: {
          dbname: 'gis',
          host: '',
          type: 'postgis'
        }
      },
      {
        id: 'other_layer',
        Datasource: {
          host: '',
          type: 'postgis'
        }
      }
    ],
    source: 'osm-pbf'
  }));

  it('yamlLayers (tmsource)', test({
    yaml: yaml(),
    yamlLayers: ['other_layer']
  }, {
    description: "sample tmsource yaml",
    Layer: [
      {
        id: 'other_layer',
        Datasource: {
          host: '',
          type: 'postgis'
        }
      }
    ]
  }));

  it('yamlLayers (tmstyle)', test({
    uri: 'tmstyle://',
    yaml: yaml({format: 'tmstyle'}),
    yamlLayers: ['other_layer']
  }, {
    description: "sample tmstyle yaml",
    layers: ['other_layer']
  }));

  it('yamlExceptLayers (tmsource)', test({
    yaml: yaml(),
    yamlExceptLayers: ['other_layer']
  }, {
    description: "sample tmsource yaml",
    Layer: [
      {
        id: 'landuse',
        Datasource: {
          dbname: 'gis',
          host: '',
          type: 'postgis'
        }
      }
    ]
  }));

  it('yamlExceptLayers (tmstyle)', test({
    uri: 'tmstyle://',
    yaml: yaml({format: 'tmstyle'}),
    yamlExceptLayers: ['other_layer']
  }, {
    description: "sample tmstyle yaml",
    layers: ['landuse']
  }));
});
