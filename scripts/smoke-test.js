'use strict';

/**
 * 端到端冒烟测试：
 * 1. 在内存模式下启动应用（测试端口）
 * 2. 验证 搜索/分页/详情/新建/编辑/附件/日志/删除 全链路
 * 退出码：0 全部通过；1 存在失败
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const http = require('http');

const PORT = 39123;
const BASE = `http://127.0.0.1:${PORT}`;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-smoke-'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function request(method, urlPath, body, isFile) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { 'X-Operator-Name': 'tester' }
    };
    if (body && !isFile) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        if (raw.length) {
          try { json = JSON.parse(raw.toString('utf8')); } catch (e) { /* 文件下载非 JSON */ }
        }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200) return true;
    } catch (e) { /* 未启动 */ }
    await sleep(300);
  }
  return false;
}

async function main() {
  console.log('启动测试服务（内存模式，上传目录：' + uploadDir + '）...');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_DRIVER: 'memory',
      UPLOAD_DIR: uploadDir
    },
    stdio: 'ignore'
  });

  let exitCode = 0;
  try {
    const ok = await waitForServer();
    assert(ok, '服务启动并通过 /health 健康检查');
    if (!ok) throw new Error('服务未启动');

    console.log('\n[1] 分页与列表');
    let r = await request('GET', '/api/equipment?page=1&pageSize=5');
    assert(r.status === 200 && r.json.code === 0, '列表接口 200');
    assert(r.json.data.list.length === 5, 'pageSize=5 返回 5 条');
    assert(r.json.data.total >= 10, '种子数据总数 >= 10（实际 ' + r.json.data.total + '）');
    const page1Ids = r.json.data.list.map((x) => x.id);
    r = await request('GET', '/api/equipment?page=2&pageSize=5');
    const page2Ids = r.json.data.list.map((x) => x.id);
    assert(!page1Ids.some((id) => page2Ids.includes(id)), '第1页与第2页数据不重叠');
    assert(r.json.data.list.length === 5, '第2页返回 5 条');

    console.log('\n[2] 搜索');
    r = await request('GET', '/api/equipment?keyword=' + encodeURIComponent('取水泵'));
    assert(r.status === 200 && r.json.data.list.length >= 2, '关键字“取水泵”命中 >= 2 条');
    r = await request('GET', '/api/equipment?status=' + encodeURIComponent('检修'));
    assert(r.json.data.list.every((x) => x.status === '检修') && r.json.data.total >= 1,
      '按状态“检修”过滤正确');
    r = await request('GET', '/api/equipment?stationName=' + encodeURIComponent('南部'));
    assert(r.json.data.total >= 1 && r.json.data.list.every((x) => x.stationName.includes('南部')),
      '按泵站名称“南部”过滤正确');
    r = await request('GET', '/api/equipment?keyword=' + encodeURIComponent('PS1-QSB-001'));
    assert(r.json.data.total === 1 && r.json.data.list[0].deviceCode === 'PS1-QSB-001',
      '按设备编号精确搜索命中 1 条');
    r = await request('GET', '/api/equipment?keyword=' + encodeURIComponent('不存在的设备XYZ'));
    assert(r.json.data.total === 0 && r.json.data.list.length === 0, '无结果关键字返回空集');

    console.log('\n[3] 统计与枚举');
    r = await request('GET', '/api/equipment/summary');
    assert(r.status === 200 && r.json.data.byStatus.length === 4, '状态统计含 4 种状态');
    assert(r.json.data.byStatus.reduce((s, x) => s + x.count, 0) === r.json.data.total,
      '各状态数量之和等于总数');
    r = await request('GET', '/api/equipment/stations');
    assert(Array.isArray(r.json.data) && r.json.data.length >= 5, '泵站名称联想返回数组');

    console.log('\n[4] 详情');
    r = await request('GET', '/api/equipment/1');
    assert(r.status === 200, '详情接口 200');
    assert(Array.isArray(r.json.data.attachments) && Array.isArray(r.json.data.logs),
      '详情包含 attachments 和 logs 数组');
    assert(r.json.data.logs.length >= 1 && r.json.data.logs[0].action === '新建',
      '种子设备有“新建”操作日志');
    r = await request('GET', '/api/equipment/999999');
    assert(r.status === 404, '不存在的设备详情返回 404');

    console.log('\n[5] 新建 + 校验');
    const newDevice = {
      stationName: '测试泵站', deviceCode: 'TEST-NEW-001', deviceName: '冒烟测试泵',
      pumpModel: 'TEST-100', powerKw: 11.5, flowM3h: 100, headM: 30, speedRpm: 1450,
      voltage: '380V', currentA: 22.5, manufacturer: '测试厂家',
      installLocation: '测试泵房-9#机位', responsibleTeam: '测试班组',
      commissionDate: '2024-01-15', status: '备用', remark: '冒烟测试创建'
    };
    r = await request('POST', '/api/equipment', JSON.stringify(newDevice));
    assert(r.status === 201 && r.json.data.id, '新建设备成功 201，返回 id');
    const newId = r.json.data.id;
    assert(r.json.data.powerKw === 11.5, '功率数值正确');

    r = await request('POST', '/api/equipment', JSON.stringify(newDevice));
    assert(r.status === 409, '重复设备编号返回 409');

    r = await request('POST', '/api/equipment', JSON.stringify({ stationName: '缺字段' }));
    assert(r.status === 400, '缺少必填字段返回 400');

    r = await request('POST', '/api/equipment', JSON.stringify({
      ...newDevice, deviceCode: 'TEST-BAD-001', powerKw: -5
    }));
    assert(r.status === 400, '功率为负数返回 400');

    r = await request('POST', '/api/equipment', JSON.stringify({
      ...newDevice, deviceCode: 'TEST-BAD-002', status: '报废'
    }));
    assert(r.status === 400, '非法运行状态返回 400');

    console.log('\n[6] 编辑 + 变更日志');
    r = await request('PUT', `/api/equipment/${newId}`, JSON.stringify({
      status: '运行', remark: '已改为运行', powerKw: 15
    }));
    assert(r.status === 200 && r.json.data.status === '运行' && r.json.data.powerKw === 15,
      '编辑设备成功，字段已更新');
    r = await request('GET', `/api/equipment/${newId}`);
    const editLogs = r.json.data.logs.filter((l) => l.action === '编辑');
    assert(editLogs.length === 1 && editLogs[0].detail.includes('运行状态'),
      '编辑操作日志已记录且含变更明细');

    console.log('\n[7] 附件上传/下载/删除');
    const fileContent = Buffer.from('这是冒烟测试的附件内容\nPump station archive test file.\n', 'utf8');
    // multipart/form-data 需要自带 boundary 头，使用专用方法
    r = await fetchWithMultipart(`/api/equipment/${newId}/attachments`, '测试附件.txt', fileContent, 'text/plain');
    assert(r.status === 201 && r.json.data.fileSize === fileContent.length,
      '附件上传成功 201，文件大小一致');
    const attId = r.json.data.id;

    const dl = await request('GET', `/api/attachments/${attId}/download`);
    assert(dl.status === 200 && dl.raw.equals(fileContent), '附件下载内容与上传一致');
    assert((dl.headers['content-disposition'] || '').includes("filename*=UTF-8''"),
      '下载响应含 RFC5987 中文文件名头');

    r = await request('GET', `/api/equipment/${newId}`);
    const attLogs = r.json.data.logs.filter((l) => l.action === '上传附件');
    assert(attLogs.length === 1, '上传附件操作日志已记录');

    r = await request('DELETE', `/api/attachments/${attId}`);
    assert(r.status === 200, '附件删除成功');
    r = await request('GET', `/api/attachments/${attId}/download`);
    assert(r.status === 404, '删除后下载返回 404');

    console.log('\n[8] 删除设备（级联）');
    r = await request('DELETE', `/api/equipment/${newId}`);
    assert(r.status === 200, '删除设备成功');
    r = await request('GET', `/api/equipment/${newId}`);
    assert(r.status === 404, '删除后详情返回 404');
    r = await request('DELETE', `/api/equipment/${newId}`);
    assert(r.status === 404, '重复删除返回 404');

    console.log('\n[9] 分页越界参数容错');
    r = await request('GET', '/api/equipment?page=-3&pageSize=abc');
    assert(r.status === 200 && r.json.data.page >= 1, '非法分页参数被归一化');
    r = await request('GET', '/api/equipment?pageSize=1000');
    assert(r.json.data.pageSize <= 100, 'pageSize 上限 100');

    console.log(`\n========================================`);
    console.log(`结果：通过 ${passed} 项，失败 ${failed} 项`);
    if (failed > 0) exitCode = 1;
  } catch (e) {
    console.error('测试执行异常:', e);
    exitCode = 1;
  } finally {
    child.kill();
    await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    process.exit(exitCode);
  }
}

function fetchWithMultipart(urlPath, filename, content, mime) {
  return new Promise((resolve, reject) => {
    const boundary = '----smoketest' + Date.now() + Math.random();
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([pre, content, post]);

    const u = new URL(BASE + urlPath);
    const req = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'X-Operator-Name': 'tester'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch (e) {}
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

main();
