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
 * GET /
 * Gets some basic info about this service
 */
router.get('/', (req, res) => {
  // simple sync return
  res.json({
    name: app.info.name,
    version: app.info.version,
    description: app.info.description,
    home: app.info.homepage,
  });
});

/**
 * GET /name
 * Gets the service's name as defined in package.json
 */
router.get('/name', (req, res) => {
  // simple return
  res.json({ name: app.info.name });
});


/**
 * GET /version
 * Gets the service's version as defined in package.json
 */
router.get('/version', (req, res) => {
  // simple return
  res.json({ version: app.info.version });
});


/**
 * ALL /home
 * Redirects to the service's home page if one is given,
 * returns a 404 otherwise
 */
router.all('/home', (req, res) => {
  const home = app.info.homepage;
  if (home && /^http/.test(home)) {
    // we have a home page URI defined, so send it
    res.redirect(301, home);
  } else {
    // no URI defined for the home page, error out
    res.status(404).end(`No home page URL defined for ${app.info.name}`);
  }
});


module.exports = function module(appObj) {
  app = appObj;

  return {
    path: '/_info',
    skip_domain: true,
    router,
  };
};
