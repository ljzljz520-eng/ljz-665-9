'use strict';

const sql = require('mssql');
const config = require('../config');

let poolPromise = null;

function buildConfig() {
  const c = config.mssql;
  return {
    server: c.server,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    connectionTimeout: c.connectionTimeout,
    requestTimeout: c.requestTimeout,
    pool: c.pool,
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      enableArithAbort: true,
      // 本地命名实例（如 .\\SQLEXPRESS）时可通过环境变量传实例名
      instanceName: process.env.DB_INSTANCE_NAME || undefined
    }
  };
}

/**
 * 获取（惰性创建并缓存的）SQL Server 连接池。
 * 首次连接按 DB_CONNECT_RETRIES 重试，便于等待数据库容器启动。
 */
function getPool() {
  if (!poolPromise) {
    poolPromise = connectWithRetry();
  }
  return poolPromise;
}

async function connectWithRetry(attempt = 1) {
  const max = config.dbConnectRetries;
  try {
    const pool = await sql.connect(buildConfig());
    console.log(
      `[mssql] 已连接到 SQL Server: ${config.mssql.server}:${config.mssql.port}/${config.mssql.database}`
    );
    return pool;
  } catch (err) {
    if (attempt >= max) {
      console.error(
        `[mssql] 连接失败（第 ${attempt}/${max} 次）: ${err.message}`
      );
      console.error('[mssql] 请检查：1) SQL Server 是否启动；2) 是否启用 TCP/IP 并允许远程连接；');
      console.error('        3) 账号密码是否正确；4) 防火墙是否放行 1433 端口。');
      poolPromise = null;
      throw err;
    }
    console.warn(
      `[mssql] 连接失败（第 ${attempt}/${max} 次），2s 后重试: ${err.message}`
    );
    await new Promise((r) => setTimeout(r, 2000));
    return connectWithRetry(attempt + 1);
  }
}

module.exports = { getPool, sql };
