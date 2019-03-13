

const Promise = require('bluebird');
const makizushi = Promise.promisify(require('@mapbox/makizushi'));
const Err = require('@kartotherian/err');

let core;

/**
 * Web server (express) route handler to get a marker icon
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function markerHandler(req, res, next) {
  const start = Date.now();
  const { params } = req;

  return Promise.try(() => {
    if (params.color.length !== 3 && params.color.length !== 6) {
      throw new Err('Bad color').metrics('err.marker.color');
    }
    let isRetina;
    if (params.scale === undefined) {
      isRetina = false;
    } else if (params.scale === '2') {
      isRetina = true;
    } else {
      throw new Err('Only retina @2x scaling is allowed for marks').metrics('err.marker.scale');
    }

    return makizushi({
      base: params.base, // "pin"
      size: params.size, // s|m|l
      symbol: params.symbol, // undefined, digit, letter, or maki symol name - https://www.mapbox.com/maki/
      tint: params.color, // in hex - "abc" or "aabbcc"
      retina: isRetina, // true|false
    });
  }).then((data) => {
    core.setResponseHeaders(res);
    res.type('png').send(data);
    core.metrics.endTiming('marker', start);
  }).catch(err => core.reportRequestError(err, res)).catch(next);
}

module.exports = (cor, router) => {
  core = cor;

  // marker icon generator  (base, size, symbol, color, scale),
  // with the symbol being optional
  // /v4/marker/pin-m-cafe+7e7e7e@2x.png --
  // the format matches that of mapbox to simplify their library usage
  router.get('/v4/marker/:base([\\w]+)-:size([sml])\\+:color([a-f0-9]+).png', markerHandler);
  router.get('/v4/marker/:base([\\w]+)-:size([sml])\\+:color([a-f0-9]+)@:scale([\\.\\d]+)x.png', markerHandler);
  router.get('/v4/marker/:base([\\w]+)-:size([sml])-:symbol([-\\w]+)\\+:color([a-f0-9]+).png', markerHandler);
  router.get('/v4/marker/:base([\\w]+)-:size([sml])-:symbol([-\\w]+)\\+:color([a-f0-9]+)@:scale([\\.\\d]+)x.png', markerHandler);
};
