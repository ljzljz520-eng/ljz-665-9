'use strict';

const config = require('../config');

let repo;
if (config.driver === 'mssql') {
  repo = require('./mssql-repo');
} else {
  repo = require('./memory-repo');
}

module.exports = repo;
