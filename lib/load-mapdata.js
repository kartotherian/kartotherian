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

    return mwapi.iterate(request, undefined, function(result) {
        var md = JSON.parse(result.query.pages[0].mapdata);
        mapdata = mapdata.concat.apply(mapdata, _.values(md));
        return true;
    }).then(function() {
        return mapdata;
    });
};
