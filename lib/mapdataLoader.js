'use strict';

let _ = require('underscore'),
    urllib = require('url'),
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
        getJSON: url => {
            if (url[0] === '/' && url[1] === '/') {
                // Workaround: urllib does not support relative URLs
                url = protocol + ':' + url;
            }
            let urlParts = urllib.parse(url);
            if (!urlParts.protocol) urlParts.protocol = protocol;
            if (!urlParts.hostname) urlParts.hostname = domain;
            if (!urlParts.slashes) urlParts.slashes = true;

            let request = {
                uri: urllib.format(urlParts),
                headers: {'User-Agent': 'kartotherian-getJSON (yurik @ wikimedia)'}
            };
            return preq.get(request).then(response => response.body);
        },
        mwApi: request => {
            let mwapi = new MWApi('kartotherian (yurik @ wikimedia)', protocol + '://' + domain + '/w/api.php');
            return mwapi.execute(request);
        },
        title: title,
    });

    return dm.loadGroups( groupIds ).then( dataGroups => {
        let mapdata = [];

        if (!dataGroups.length) {
            throw new Error('GroupId not available');
        }

        for (let i = 0; i < dataGroups.length; i++ ) {
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
