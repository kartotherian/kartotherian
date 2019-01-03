'use strict';

const L = require( 'leaflet-headless' );
const worldLatLng = new L.LatLngBounds( [ -90, -180 ], [ 90, 180 ] );

/* eslint-disable no-underscore-dangle */
/**
 * Validate that the bounds contain no outlier.
 *
 * An outlier is a layer whom bounds do not fit into the world,
 * i.e. `-180 <= longitude <= 180  &&  -90 <= latitude <= 90`
 *
 * There is a special case for **masks** (polygons that cover the entire
 * globe with a hole to highlight a specific area). In this case the
 * algorithm tries to validate the hole bounds.
 *
 * @param {L.Layer} layer Layer to get and validate the bounds.
 * @return {L.LatLng|boolean} Bounds if valid.
 * @private
 */
function validateBounds( layer ) {
    let bounds = ( typeof layer.getBounds === 'function' ) && layer.getBounds();

    bounds = bounds || ( typeof layer.getLatLng === 'function' ) && layer.getLatLng();

    if ( bounds && worldLatLng.contains( bounds ) ) {
        return bounds;
    } else if ( layer instanceof L.Polygon && layer._holes && layer._holes[ 0 ] ) {
        bounds = new L.LatLngBounds( layer._convertLatLngs( layer._holes[ 0 ] ) );
        if ( worldLatLng.contains( bounds ) ) {
            return bounds;
        }
    }
    return false;
}

/**
 * Gets the valid bounds of a map/layer.
 *
 * @param {L.Map|L.Layer} layer
 * @return {L.LatLngBounds} Extended bounds
 * @private
 */
function getValidBounds( layer ) {
    let layerBounds = new L.LatLngBounds();

    if ( typeof layer.eachLayer === 'function' ) {
        layer.eachLayer( function ( child ) {
            layerBounds.extend( getValidBounds( child ) );
        } );
    } else {
        layerBounds.extend( validateBounds( layer ) );
    }
    return layerBounds;
}

/**
 * Gets the most optimal center and zoom for the map so that all the features
 * are visible.
 *
 * @param {Object} params Parameters from `requestHandler`
 * @param {Object} data GeoJSON for the map
 * @return {Object}
 * @return {number[]} return.center Latitude and longitude.
 * @return {number} return.zoom Zoom
 */
module.exports = function autoPosition( params, data ) {

    let dataLayer = L.geoJSON( data ),
        center,
        zoom,
        maxBounds,
        map = L.map( document.createElement( 'div' ) );

    map.setView( [ 0, 0 ], 11 );
    map.setSize( params.w, params.h );

    maxBounds = getValidBounds( dataLayer );

    if ( maxBounds.isValid() ) {
        map.fitBounds( maxBounds );
    } else {
        map.fitWorld();
    }

    center = map.getCenter();

    return {
        latitude: params.lat === 'a' ? center.lat : params.lat,
        longitude: params.lon === 'a' ? center.lng : params.lon,
        zoom: params.zoom === 'a' ? map.getZoom() : params.zoom,
    };
};
