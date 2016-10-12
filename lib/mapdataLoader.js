'use strict';

var _ = require('underscore'),
    MWApi = require('mwapi'),
    DataManager = require('wikimedia-mapdata'),
    preq = require('preq'),
    Promise = require('bluebird');

/**
 * Download map data from MW api
 * @param {string} protocol - "http" or "https"
 * @param {string} domain - "en.wikipedia.org"
 * @param {string} title - title of the page - ok to be unsanitized
 * @param {string|string[]} groupIds
 * @returns {Promise}
 */
module.exports = function downloadMapdata(protocol, domain, title, groupIds) {
    let dm = new DataManager({
        createPromise: createPromise,
        whenAllPromises: Promise.all,
        isEmptyObject: _.isEmpty,
        isPlainObject: _.isObject,
        isArray: _.isArray,
        extend: _.extend,
        getJSON: (request) => {
            return preq(request).then(response => {
                // Workaround until https://github.com/wikimedia/preq/pull/19 is merged
                if (Buffer.isBuffer(response.body)) {
                    response.body = JSON.parse(response.body.toString());
                }
                return response.body;
            });
        },
        mwApi: (request) => {
            var mwapi = new MWApi('kartotherian (yurik @ wikimedia)', protocol + '://' + domain + '/w/api.php');
            return mwapi.execute(request);
        },
        title: title,
    });

    return dm.loadGroups( groupIds ).then( dataGroups => {
        var mapdata = [];

        for (var i = 0; i < dataGroups.length; i++ ) {
            expandArraysAndCollections(mapdata, dataGroups[ i ].getGeoJSON());
        }

        if (mapdata.length === 1) return mapdata[0];
        return {"type": "FeatureCollection", "features": mapdata};
    } );
};

function expandArraysAndCollections(mapdata, geojson) {
    if (Array.isArray(geojson)) {
        for (let v of geojson) {
            expandArraysAndCollections(mapdata, v);
        }
    } else if (_.isObject(geojson)) {
        if (!geojson.type) throw new Error('Bad geojson - object has no type');
        switch (geojson.type) {
            case 'FeatureCollection':
                expandArraysAndCollections(mapdata, geojson.features);
                break;
            case 'Feature':
                mapdata.push(geojson);
                break;
            default:
                throw new Error('Bad geojson - unknown type ' + geojson.type);
        }
    } else {
        throw new Error('Bad geojson - unknown type ' + typeof(geojson));
    }
}

function createPromise(callback) {
    return new Promise(callback);
}
