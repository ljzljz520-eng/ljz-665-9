'use strict';

require('dotenv').config();

const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,

  // DRIVER=memory 使用内置内存库（免数据库，便于演示/联调）；
  // DRIVER=mssql 使用 SQL Server（生产环境）。
  driver: (process.env.DB_DRIVER || 'memory').toLowerCase(),

  mssql: {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_DATABASE || 'PumpStationDB',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    // SQL Server 自签证书环境建议置 false；生产环境建议配置受信证书后置 true
    trustServerCertificate:
      (process.env.DB_TRUST_SERVER_CERT || 'true').toLowerCase() !== 'false',
    encrypt: (process.env.DB_ENCRYPT || 'true').toLowerCase() === 'true',
    connectionTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 15000,
    requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT, 10) || 30000,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
      min: parseInt(process.env.DB_POOL_MIN, 10) || 0,
      idleTimeoutMillis:
        parseInt(process.env.DB_POOL_IDLE_MS, 10) || 30000
    }
  },

  // 启动时连接数据库的重试次数（每次间隔 2s）
  dbConnectRetries: parseInt(process.env.DB_CONNECT_RETRIES, 10) || 10,

  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '..', 'uploads'),

  maxUploadMB: parseInt(process.env.MAX_UPLOAD_MB, 10) || 50
};

module.exports = config;
