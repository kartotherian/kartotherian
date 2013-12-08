"use strict";

var url = require("url"),
    util = require("util");

var Bridge = require("tilelive-bridge");

var TMSource = function(uri, callback) {
  uri = url.parse(uri);

  uri.pathname += "/data.xml";

  // TODO if data.xml does not exist (but data.yml does), generate it before
  // pointing tilelive-bridge at it

  return Bridge.call(this, uri, callback);
};

util.inherits(TMSource, Bridge);

TMSource.registerProtocols = function(tilelive) {
  tilelive.protocols["tmsource:"] = this;
};

module.exports = function(tilelive, options) {
  TMSource.registerProtocols(tilelive);

  return TMSource;
};
