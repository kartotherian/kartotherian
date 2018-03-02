(function (location) { // eslint-disable-line func-names
  // Allow user to change style via the ?s=xxx URL parameter
  // Uses "osm-intl" as the default style
  const matchStyle = location.search.match(/s=([^&/]*)/);
  const matchScale = location.search.match(/scale=([.0-9]*)/);
  const xhr = new XMLHttpRequest();

  const bracketDevicePixelRatio = function bracketDevicePixelRatio() {
    const brackets = [1, 1.3, 1.5, 2, 2.6, 3];
    const baseRatio = window.devicePixelRatio || 1;

    let i;
    let scale;

    for (i = 0; i < brackets.length; i += 1) {
      scale = brackets[i];

      if (scale >= baseRatio || (baseRatio - scale) < 0.1) {
        return scale;
      }
    }
    return brackets[brackets.length - 1];
  };

  const style = (matchStyle && matchStyle[1]) || 'osm-intl';
  const scale = (matchScale && parseFloat(matchScale[1])) || bracketDevicePixelRatio();
  const scalex = (scale === 1) ? '' : (`@${scale}x`);
  const map = L.map('map').setView([40.75, -73.96], 4);

  // Create a map
  map.attributionControl.setPrefix('');

  /**
   * Finishes setting up the map
   *
   * @param {Object|null} config Config object
   * @param string [config.attribution] Attribution text to show in footer; see below for default
   * @param number [config.maxzoom=18] Maximum zoom level
   */
  function setupMap(config = {}) {
    const matchLang = location.search.match(/lang=([-_a-zA-Z]+)/);
    const defaultSettings = {
      maxzoom: 18,
      // TODO: This is UI text, and needs to be translatable.
      attribution: 'Map data &copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    };
    const layerSettings = {
      maxZoom: config.maxzoom !== undefined ?
        config.maxzoom : defaultSettings.maxzoom,
      // TODO: This is UI text, and needs to be translatable.
      attribution: config.attribution !== undefined ?
        config.attribution : defaultSettings.attribution,
      id: 'map-01',
    };
    let query = '';

    if (matchLang) {
      query = `?lang=${matchLang[1]}`;
    }

    // Add a map layer
    L.tileLayer(`${style}/{z}/{x}/{y}${scalex}.png${query}`, layerSettings).addTo(map);

    // Add a km/miles scale
    L.control.scale().addTo(map);

    // Update the zoom level label
    map.on('zoomend', () => {
      document.getElementById('zoom-level').innerHTML = `Zoom Level: ${map.getZoom()}`;
    });

    // Add current location to URL hash
    const hash = new L.Hash(map); // eslint-disable-line one-var,no-unused-vars
  }

  xhr.addEventListener('load', () => {
    let config;

    try {
      config = JSON.parse(this.responseText);
    } catch (e) {
      config = null;
    }

    setupMap(config);
  });
  xhr.addEventListener('error', () => {
    setupMap(null);
  });

  xhr.open('GET', `/${style}/info.json`);
  xhr.send();
}(window.location));
