const sUtil = require('../lib/util');

/**
 * The main router object
 */
const router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
let app;

/**
 * GET /robots.txt
 * Instructs robots no indexing should occur on this domain.
 */
router.get('/robots.txt', (req, res) => {
  res.set({
    'User-agent': '*',
    Disallow: '/',
  }).end();
});


/**
 * GET /
 * Main entry point. Currently it only responds if the spec query
 * parameter is given, otherwise lets the next middleware handle it
 */
router.get('/', (req, res, next) => {
  if (!Object.prototype.hasOwnProperty.call((req.query || {}), 'spec')) {
    next();
  } else {
    res.json(app.conf.spec);
  }
});


module.exports = function module(appObj) {
  app = appObj;

  return {
    path: '/',
    skip_domain: true,
    router,
  };
};
