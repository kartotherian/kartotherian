// Allow user to change style via the ?s=xxx URL parameter
// Uses "osm-intl" as the default style
var matchStyle = location.search.match(/s=([^&\/]*)/);
var style = (matchStyle && matchStyle[1]) || 'osm-intl';

// Create a map
var map = L.map('map').setView([40.75, -73.96], 4);
map.attributionControl.setPrefix('');

function bracketDevicePixelRatio() {
    var brackets = [1, 1.3, 1.5, 2, 2.6, 3],
        baseRatio = window.devicePixelRatio || 1;
    for (var i = 0; i < brackets.length; i++) {
        var scale = brackets[i];
        if (scale >= baseRatio || (baseRatio - scale) < 0.1) {
            return scale;
        }
    }
    return brackets[brackets.length - 1];
}

var matchScale = location.search.match(/scale=([.0-9]*)/);
var scale = (matchScale && parseFloat(matchScale[1])) || bracketDevicePixelRatio();
var scalex = (scale === 1) ? '' : ('@' + scale + 'x');

// Add a map layer
L.tileLayer(style + '/{z}/{x}/{y}' + scalex + '.png', {
    maxZoom: 18,
    attribution: 'Map data &copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    id: 'map-01'
}).addTo(map);

// Add a km/miles scale
L.control.scale().addTo(map);

// Update the zoom level label
map.on('zoomend', function () {
    document.getElementById('zoom-level').innerHTML = 'Zoom Level: ' + map.getZoom();
});

// Add current location to URL hash
var hash = new L.Hash(map);
