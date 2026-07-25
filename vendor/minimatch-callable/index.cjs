"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const modern = require("minimatch-modern");

function minimatch(value, pattern, options) {
  return modern.minimatch(value, pattern, options);
}

Object.assign(minimatch, modern);
minimatch.minimatch = minimatch;

module.exports = minimatch;
