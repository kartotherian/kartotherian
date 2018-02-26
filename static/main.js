(function (location) { // eslint-disable-line func-names
  // Allow user to change style via the ?s=xxx URL parameter
  // Uses "osm-intl" as the default style
  const matchStyle = location.search.match(/s=([^&/]*)/),
    matchScale = location.search.match(/scale=([.0-9]*)/),
    matchLang = location.search.match(/lang=([-_a-zA-Z]+)/),
    bracketDevicePixelRatio = function bracketDevicePixelRatio() {
      let i,
        scale;
      const brackets = [1, 1.3, 1.5, 2, 2.6, 3],
        baseRatio = window.devicePixelRatio || 1;

      for (i = 0; i < brackets.length; i++) {
        scale = brackets[i];

        if (scale >= baseRatio || (baseRatio - scale) < 0.1) {
          return scale;
        }
      }
      return brackets[brackets.length - 1];
    },
    style = (matchStyle && matchStyle[1]) || 'osm-intl',
    scale = (matchScale && parseFloat(matchScale[1])) || bracketDevicePixelRatio(),
    scalex = (scale === 1) ? '' : (`@${scale}x`),
    map = L.map('map').setView([40.75, -73.96], 4);
  let query = '';

  // Create a map
  map.attributionControl.setPrefix('');

  if (matchLang) {
    query = `?lang=${matchLang[1]}`;
  }

  // Add a map layer
  L.tileLayer(`${style}/{z}/{x}/{y}${scalex}.png${query}`, {
    maxZoom: 20,
    attribution: 'Map data &copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    id: 'map-01'
  }).addTo(map);

  // Add a km/miles scale
  L.control.scale().addTo(map);

  // Update the zoom level label
  map.on('zoomend', () => {
    document.getElementById('zoom-level').innerHTML = `Zoom Level: ${map.getZoom()}`;
  });

  // Add current location to URL hash
  const hash = new L.Hash(map); // eslint-disable-line one-var,no-unused-vars
}(window.location));
