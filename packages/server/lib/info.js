const infoHeaders = {};
const util = require('util');
const Promise = require('bluebird');

let core;

/**
 * Web server (express) route handler to get requested tile or info
 * @param req request object
 * @param res response object
 * @param next will be called if request is not handled
 */
function requestHandler(req, res, next) {
  const start = Date.now();
  let source;

  return Promise.try(() => {
    source = core.getPublicSource(req.params.src);
    return source.getHandler().getInfoAsync().then(info => [info, infoHeaders]);
  }).spread((data, dataHeaders) => {
    core.setResponseHeaders(res, source, dataHeaders);

    if (req.query && req.query.format) {
      const escapedText = JSON.stringify(data, null, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      res.send(`<pre>${escapedText}</pre>`);
    } else {
      res.json(data);
    }

    const mx = util.format('req.%s.info', req.params.src);
    core.metrics.endTiming(mx, start);
  }).catch(err => core.reportRequestError(err, res)).catch(next);
}

module.exports = function info(cor, router) {
  core = cor;

  // get source info (json)
  router.get(`/:src(${core.Sources.sourceIdReStr})/info.json`, requestHandler);
};
