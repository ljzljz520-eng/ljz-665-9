const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  // 数据库驱动：mssql = SQL Server；json = 本地文件（免数据库演示用）
  dbDriver: (process.env.DB_DRIVER || 'json').toLowerCase(),
  mssql: {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'PumpStationArchive',
    // 端口与命名实例二选一：配置了 DB_INSTANCE 时端口不生效
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : null,
    instanceName: process.env.DB_INSTANCE || '',
    // 本地 SQL Server 一般用 false；Azure SQL 必须 true
    encrypt: (process.env.DB_ENCRYPT || 'false') === 'true',
    trustServerCertificate: (process.env.DB_TRUST_SERVER_CERT || 'true') === 'true',
    connectionTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '15000', 10),
    requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT || '30000', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10)
  },
  dataFile: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  maxUploadMB: parseInt(process.env.MAX_UPLOAD_MB || '50', 10)
};

module.exports = config;
