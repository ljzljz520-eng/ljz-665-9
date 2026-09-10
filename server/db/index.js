const config = require('../config');

let driver;
if (config.dbDriver === 'mssql') {
  driver = require('./mssql');
} else if (config.dbDriver === 'json') {
  driver = require('./jsondb');
} else {
  throw new Error(`不支持的数据库驱动: ${config.dbDriver}（可选 mssql / json）`);
}

module.exports = driver;
