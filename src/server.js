'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const config = require('./config');
const { getPool } = require('./db/mssql-pool');

async function main() {
  // 确保上传目录存在
  fs.mkdirSync(config.uploadDir, { recursive: true });

  // SQL Server 模式下启动即建池并重试连接；内存模式直接就绪
  if (config.driver === 'mssql') {
    await getPool();
  } else {
    console.log('[db] 使用内存驱动（DB_DRIVER=memory），重启数据将重置；生产请设置 DB_DRIVER=mssql');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 注入操作人（后续可接入登录/鉴权，从 header/token 中解析）
  app.use((req, res, next) => {
    req.operator = (req.get('x-operator-name') || 'admin').slice(0, 100);
    next();
  });

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({
      code: 0,
      data: {
        status: 'ok',
        driver: config.driver,
        time: new Date().toISOString()
      }
    });
  });

  // REST API
  app.use('/api', require('./routes'));

  // 静态前端
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // 非 API 路径回退到 SPA
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
    next();
  });

  // API 404
  app.use('/api', (req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在' });
  });

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      console.error('[error]', err);
    }
    res.status(status).json({
      code: status,
      message: err.message || '服务器内部错误'
    });
  });

  app.listen(config.port, () => {
    console.log(`水厂泵站设备档案系统已启动: http://localhost:${config.port}`);
    console.log(`当前数据驱动: ${config.driver}`);
  });
}

main().catch((err) => {
  console.error('服务启动失败:', err);
  process.exit(1);
});
