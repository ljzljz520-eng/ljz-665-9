const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./db');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态前端
app.use(express.static(path.join(__dirname, '..', 'public')));

// API 路由
app.use('/api/equipment/:equipmentId/attachments', require('./routes/attachments'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/logs', require('./routes/logs'));

app.get('/api/health', (req, res) => {
  res.json({ code: 0, data: { status: 'ok', driver: config.dbDriver, time: new Date().toISOString() } });
});

// 兜底：非 /api 路径交给前端单页（避免直接使用正则路由）
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && req.path !== '/api') {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// 404（API）
app.use('/api', (req, res) => {
  res.status(404).json({ code: 1, message: '接口不存在' });
});

// 全局错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ code: 1, message: '请求体不是合法 JSON' });
  }
  res.status(500).json({
    code: 1,
    message: err.message || '服务器内部错误',
    ...(config.dbDriver !== 'mssql' ? {} : {})
  });
});

async function start() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  try {
    await db.init();
    console.log(`[db] 数据库初始化完成，驱动：${config.dbDriver}`);
  } catch (err) {
    console.error('[db] 数据库初始化失败：');
    console.error('  ', err.message);
    if (config.dbDriver === 'mssql') {
      console.error('   请检查 SQL Server 是否启动、账号密码及库名是否正确，参考 README.md 的部署说明。');
    }
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`\n水厂泵站设备档案管理系统已启动`);
    console.log(`  访问地址： http://localhost:${config.port}`);
    console.log(`  数据库驱动：${config.dbDriver}`);
  });
}

process.on('SIGINT', async () => {
  try { await db.close(); } catch (e) {}
  process.exit(0);
});

start();
