
var style = getStyle();

var map = new mapboxgl.Map({
    container: 'map',
    zoom: 12.5,
    center: [38.888, -77.01866],
    style: '../mapbox-gl-styles/styles/' + style + '-v7.json',
    hash: true
});

map.addControl(new mapboxgl.Navigation());

function getStyle() {

    var styles =
    [
        "basic",
        "bright",
        "dark",
        "emerald",
        "light",
        "mapbox-streets",
        "outdoors",
        "pencil",
    ];

    var match = location.search.match(/s=([^&\/]*)/);
    var styleId = match && match[1];
    var style;

    if (styleId) {
        // major hack - how do i do str->int ?
        style = styles[styleId.charCodeAt(0)-'0'.charCodeAt(0)];
    } else {
        style = styles[1]; // bright by default
    }

    return style;
}
