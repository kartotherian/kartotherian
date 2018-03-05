( function ( location ) { // eslint-disable-line func-names
  // Allow user to change style via the ?s=xxx URL parameter
  // Uses "osm-intl" as the default style
  var xhr,
    matchStyle = location.search.match( /s=([^&/]*)/ ),
    matchScale = location.search.match( /scale=([.0-9]*)/ ),
    bracketDevicePixelRatio = function bracketDevicePixelRatio() {
      var i, scale,
        brackets = [ 1, 1.3, 1.5, 2, 2.6, 3 ],
        baseRatio = window.devicePixelRatio || 1;

      for ( i = 0; i < brackets.length; i++ ) {
        scale = brackets[ i ];

        if ( scale >= baseRatio || ( baseRatio - scale ) < 0.1 ) {
          return scale;
        }
      }
      return brackets[ brackets.length - 1 ];
    },
    style = ( matchStyle && matchStyle[ 1 ] ) || 'osm-intl',
    scale = ( matchScale && parseFloat( matchScale[ 1 ] ) ) || bracketDevicePixelRatio(),
    scalex = ( scale === 1 ) ? '' : ( scale + 'x' ),
    map = L.map( 'map' ).setView( [ 40.75, -73.96 ], 4 );

  // Create a map
  map.attributionControl.setPrefix( '' );

  /**
   * Finishes setting up the map
   *
   * @param {Object|null} config Config object
   * @param {string} [config.attribution] Attribution text to show in footer; see below for default
   * @param {number} [config.maxzoom=18] Maximum zoom level
   */
  function setupMap( config ) {
    var layerSettings, defaultSettings,
      query = '',
      matchLang = location.search.match( /lang=([-_a-zA-Z]+)/ );

    defaultSettings = {
      maxzoom: 18,

      // TODO: This is UI text, and needs to be translatable.
      attribution: 'Map data &copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    };

    if ( matchLang ) {
      query = '?lang=' + matchLang[ 1 ];
    }
    config = config || {};

    layerSettings = {
      maxZoom: config.maxzoom !== undefined ? config.maxzoom : defaultSettings.maxzoom,

      // TODO: This is UI text, and needs to be translatable.
      attribution: config.attribution !== undefined ? config.attribution : defaultSettings.attribution,

      id: 'map-01'
    };

    // Add a map layer
    L.tileLayer( style + '/{z}/{x}/{y}' + scalex + '.png' + query, layerSettings ).addTo( map );

    // Add a km/miles scale
    L.control.scale().addTo( map );

    // Update the zoom level label
    map.on( 'zoomend', function () {
      document.getElementById( 'zoom-level' ).innerHTML = 'Zoom Level: ' + map.getZoom();
    } );

    // Add current location to URL hash
    new L.Hash( map ); // eslint-disable-line no-new
  }

  matchScale = location.search.match( /scale=([.0-9]*)/ );
  scale = ( matchScale && parseFloat( matchScale[ 1 ] ) ) || bracketDevicePixelRatio();
  scalex = ( scale === 1 ) ? '' : ( '@' + scale + 'x' );

  xhr = new XMLHttpRequest();
  xhr.addEventListener( 'load', function () {
    var config;

    try {
      config = JSON.parse( this.responseText );
    } catch ( e ) {
      config = null;
    }

    setupMap( config );

  } );
  xhr.addEventListener( 'error', function () {
    setupMap( null );
  } );

  xhr.open( 'GET', '/' + style + '/info.json' );
  xhr.send();
}( window.location ) );
