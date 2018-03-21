'use strict';

const pathLib = require('path');
const Promise = require('bluebird');
const core = require('@kartotherian/core');
const npmi = Promise.promisify(require('npmi'));
const info = require('../package.json');

module.exports = startup;

function startup(app) {

    return startup.bootstrap(app).then(() => {
        let sources = new core.Sources();
        return sources.init(app.conf);
    }).then(sources => {
        core.setSources(sources);
        return require('@kartotherian/server').init({
            core: core,
            app: app,
            // requestHandlers: core.loadNpmModules('requestHandlers')
        });
    }).return(); // avoid app.js's default route initialization
}

startup.bootstrap = function bootstrap(app) {
    return Promise.try(
      () => core.init(app, pathLib.resolve(__dirname, '..'), loadModule, module => require.resolve(module))
    );
};

function loadModule(module) {
  return Promise.try(
    () => require(module)
  ).catch(err => {
    console.error(`Unable to load module "${module}", attempting to install from NPM`);
    console.error(err);
    return installNpmModule(module).then(() => require(module));
  });
}

function installNpmModule(module) {

  const options = {
    name: module,
    // npmLoad: {
    //   // as defined in https://docs.npmjs.com/misc/config
    //   loglevel: 'silent'
    // }
  };

  return npmi(options).then(result => {
    console.error(options.name + '@' + options.version + ' installed successfully in ' + path.resolve(options.path));
    console.error(`** NOTE: For production, it is recommended to pre-install required external NPM packages`);
    return result;
  }, err => {
    if (err.code === npmi.LOAD_ERR)
      console.error(`npm load error`);
    else if (err.code === npmi.INSTALL_ERR)
      console.error(`npm install error`);
    console.error(err.message);
  });
}
