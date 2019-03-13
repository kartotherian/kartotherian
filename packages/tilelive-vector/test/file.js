var test = require('tape');
var path = require('path');
var Vector = require('..');
var tilelive = require('@mapbox/tilelive');
var TileJSON = require('@mapbox/tilejson');

// Register vector:, tm2z:, tm2z+http: and mapbox: tilelive protocols
Vector.registerProtocols(tilelive);
tilelive.protocols['mapbox:'] = function Source(uri, callback) {
    var MapboxAccessToken = process.env.MapboxAccessToken;
    if (!MapboxAccessToken) return callback(new Error('env var MapboxAccessToken is required'));
    return new TileJSON('http://a.tiles.mapbox.com/v4' + uri.pathname + '.json?access_token=' + MapboxAccessToken, callback);
};

// Register font
Vector.mapnik.register_fonts(path.join(__dirname, 'fonts', 'source-sans-pro'));

test('file ENOENT', function(assert) {
    Vector('/does-not-exist', function(err, source) {
        assert.equal(err.code, 'ENOENT');
        assert.end();
    });
});

test('file xml', function(assert) {
    var filepath = path.join(path.dirname(require.resolve('@mapbox/mapbox-studio-default-style')),'project.xml');
    Vector(filepath, function(err, source) {
        assert.ifError(err);
        assert.equal(source instanceof Vector, true, 'returns source');
        assert.equal(source._base, path.dirname(require.resolve('@mapbox/mapbox-studio-default-style')), 'sets base');
        assert.equal(source._xml.indexOf('https://www.mapbox.com/map-feedback/') > 0, true, 'finds xml');
        assert.end();
    });
});

