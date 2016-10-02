'use strict';

var _ = require('underscore');
var MWApi = require('mwapi');

/**
 * Download map data from MW api
 * @param {string} protocol - "http" or "https"
 * @param {string} domain - "en.wikipedia.org"
 * @param {string} title - title of the page - ok to be unsanitized
 * @param {string|string[]} groups
 * @returns {Promise}
 */
module.exports = function downloadMapdata(protocol, domain, title, groups) {
    var mwapi = new MWApi('kartotherian (yurik @ wikimedia)', protocol + '://' + domain + '/w/api.php');
    var mapdata = [];
    var request = {
        action: 'query',
        prop: 'mapdata',
        mpdlimit: 'max',
        titles: title
    };
    if (groups) {
        request.mpdgroups = groups;
    }

    return mwapi.iterate(request, undefined, result => {
        var md = JSON.parse(result.query.pages[0].mapdata);
        mapdata = mapdata.concat.apply(mapdata, _.values(md));
        return true;
    }).then(
        () => expandExternalData(mapdata)
    ).then((mapdata) => {
        if (mapdata.length === 1) return mapdata[0];
        return {"type": "FeatureCollection", "features": mapdata};
    });
};

function expandExternalData(mapdata) {

// mapdata = [
//     // {"type": "Feature","properties": {},"geometry": {"type": "LineString","coordinates": [[-122.4755859375,37.80924146650164],[-122.45498657226561,37.80490143094975],[-122.44125366210936,37.80761398306056],[-122.4358034133911,37.8075970299193],[-122.42449522018431,37.810546817921605],[-122.41943120956421,37.811428340891176],[-122.41044044494629,37.81136053180563],[-122.40005493164062,37.80490143094975],[-122.39593505859376,37.79947602782782],[-122.39181518554686,37.79350762410675],[-122.38632202148438,37.78645343442073]]}}
//     {"type": "Feature","properties": {},"geometry": {"type": "Polygon","coordinates": [[[-180,-90],[-180,90],[180,90],[180,-90],[-180,-90]]]}},
//     {"type": "Feature","properties": {"stroke": "#ff0000","stroke-width": 10,"stroke-opacity": 1},"geometry": {"type": "LineString","coordinates": [[-180,90],[180,-90]]}},
//     {"type": "Feature","properties": {"stroke": "#0000ff","stroke-width": 10,"stroke-opacity": 1},"geometry": {"type": "LineString","coordinates": [[-180,-90],[180,90]]}}
// ];

    // for now, simply remove the ExternalData from the geojson
    if (Array.isArray(mapdata)) {
        var newMapdata = [];
        for (let v of mapdata) {
            if (Array.isArray(v)) throw new Error('Bad geojson - array with arrays');
            if (!_.isObject(v)) throw new Error('Bad geojson - array must contain objects');
            if (!v.type) throw new Error('Bad geojson - object has no type');
            switch (v.type) {
                case 'ExternalData':
                    continue;
                case 'FeatureCollection':
                    for (let f of expandExternalData(v.features)) {
                        newMapdata.push(f);
                    }
                    break;
                case 'Feature':
                    newMapdata.push(v);
                    break;
                default:
                    throw new Error('Bad geojson - unknown type ' + v.type);
            }
        }
        return newMapdata;
    } else if (_.isObject(mapdata)) {
        if (!mapdata.type) throw new Error('Bad geojson - object has no type');
        switch (mapdata.type) {
            case 'ExternalData':
                return {};

            case 'FeatureCollection':
                // TODO: We should remove all FeatureCollections from geojson, so that the top level array
                // would become the only FeatureCollection in the whole GeoJSON
                mapdata.features = expandExternalData(mapdata.features);
                break;
        }
    }

    return mapdata;
}
