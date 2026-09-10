/* ========== 水厂泵站设备档案 前端逻辑 ========== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  archive: { list: [], total: 0, page: 1, pageSize: 10, keyword: '', status: '' },
  logs: { list: [], total: 0, page: 1, pageSize: 10, equipmentId: '' },
  statuses: [],
  detailId: null
};

/* ---------- 工具 ---------- */
function toast(msg, type = 'ok', ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

function operatorHeader() {
  return { 'X-Operator': $('#operator').value.trim() || 'admin' };
}

async function api(url, options = {}) {
  const opts = Object.assign({ headers: {} }, options);
  Object.assign(opts.headers, operatorHeader(), options.headers || {});
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { /* 非JSON */ }
  if (!res.ok || !body || body.code !== 0) {
    const msg = (body && body.message) || `请求失败（${res.status}）`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

function escapeHtml(s) {
  if (s === null || s === undefined || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function fmtDate(s) {
  if (!s) return '—';
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusClass(status) {
  return ({
    '运行中': 'run', '停机': 'stop', '检修中': 'repair', '故障': 'fault'
  })[status] || 'stop';
}

function actionClass(action) {
  return ({ '新建': 'act-create', '编辑': 'act-update', '删除': 'act-delete', '附件': 'act-attach' })[action] || 'act-update';
}

/* ---------- 视图切换 ---------- */
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    const view = btn.dataset.view;
    $('#view-archive').hidden = view !== 'archive';
    $('#view-logs').hidden = view !== 'logs';
    if (view === 'logs') loadLogs();
  });
});

/* ---------- 状态枚举 ---------- */
async function loadStatuses() {
  try {
    const body = await api('/api/equipment/meta/statuses');
    state.statuses = body.data || [];
  } catch (e) {
    state.statuses = ['运行中', '停机', '检修中', '故障'];
  }
  const opts = state.statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  $('#statusFilter').insertAdjacentHTML('beforeend', opts);
  $('#fStatus').innerHTML = opts;
}

/* ---------- 档案列表 ---------- */
async function loadArchive() {
  const s = state.archive;
  const qs = new URLSearchParams({
    page: s.page, pageSize: s.pageSize, keyword: s.keyword, status: s.status
  });
  try {
    const body = await api(`/api/equipment?${qs.toString()}`);
    s.list = body.data;
    s.total = body.total;
    renderGrid();
    renderPager();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderGrid() {
  const s = state.archive;
  const body = $('#gridBody');
  $('#gridEmpty').hidden = s.list.length !== 0;
  body.innerHTML = s.list.map((e) => `
    <tr>
      <td class="code-cell">${escapeHtml(e.equipmentCode)}</td>
      <td>${escapeHtml(e.stationName)}</td>
      <td>${escapeHtml(e.equipmentName || '—')}</td>
      <td class="num">${e.powerKw === null ? '—' : Number(e.powerKw).toLocaleString()}</td>
      <td>${escapeHtml(e.installLocation || '—')}</td>
      <td>${escapeHtml(e.teamName || '—')}</td>
      <td>${fmtDate(e.commissionDate)}</td>
      <td><span class="badge ${statusClass(e.status)}">${escapeHtml(e.status)}</span></td>
      <td class="ops">
        <button class="btn link" data-act="view" data-id="${e.id}">详情</button>
        <button class="btn link" data-act="edit" data-id="${e.id}">编辑</button>
        <button class="btn link danger" data-act="del" data-id="${e.id}">删除</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      if (btn.dataset.act === 'view') openDetail(id);
      if (btn.dataset.act === 'edit') openForm(id);
      if (btn.dataset.act === 'del') doDelete(id);
    });
  });
}

function pageNumbers(total, page, max = 7) {
  const pages = Math.max(1, Math.ceil(total / state.archive.pageSize));
  let start = Math.max(1, page - 3);
  let end = Math.min(pages, start + max - 1);
  start = Math.max(1, end - max + 1);
  const arr = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return { arr, pages };
}

function renderPager() {
  const s = state.archive;
  const pages = Math.max(1, Math.ceil(s.total / s.pageSize));
  const start = s.total === 0 ? 0 : (s.page - 1) * s.pageSize + 1;
  const end = Math.min(s.total, s.page * s.pageSize);
  $('#pagerInfo').textContent = `共 ${s.total} 条，显示第 ${start}-${end} 条 / 共 ${pages} 页`;

  $('#btnFirst').disabled = s.page <= 1;
  $('#btnPrev').disabled = s.page <= 1;
  $('#btnNext').disabled = s.page >= pages;
  $('#btnLast').disabled = s.page >= pages;

  const { arr } = pageNumbers(s.total, s.page);
  $('#pageNumbers').innerHTML = arr.map((p) =>
    `<button class="btn small ${p === s.page ? 'cur' : ''}" data-page="${p}">${p}</button>`
  ).join('');
  $('#pageNumbers').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { s.page = Number(b.dataset.page); loadArchive(); });
  });
  $('#jumpPage').value = '';
}

/* 搜索/分页事件 */
$('#btnSearch').addEventListener('click', () => {
  state.archive.keyword = $('#kw').value.trim();
  state.archive.status = $('#statusFilter').value;
  state.archive.page = 1;
  loadArchive();
});
$('#kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnSearch').click(); });
$('#btnReset').addEventListener('click', () => {
  $('#kw').value = '';
  $('#statusFilter').value = '';
  state.archive.keyword = '';
  state.archive.status = '';
  state.archive.page = 1;
  loadArchive();
});
$('#statusFilter').addEventListener('change', () => $('#btnSearch').click());
$('#pageSize').addEventListener('change', (e) => {
  state.archive.pageSize = Number(e.target.value);
  state.archive.page = 1;
  loadArchive();
});
$('#btnFirst').addEventListener('click', () => { state.archive.page = 1; loadArchive(); });
$('#btnPrev').addEventListener('click', () => { state.archive.page--; loadArchive(); });
$('#btnNext').addEventListener('click', () => { state.archive.page++; loadArchive(); });
$('#btnLast').addEventListener('click', () => {
  state.archive.page = Math.ceil(state.archive.total / state.archive.pageSize);
  loadArchive();
});
$('#btnJump').addEventListener('click', () => {
  const v = parseInt($('#jumpPage').value, 10);
  const pages = Math.max(1, Math.ceil(state.archive.total / state.archive.pageSize));
  if (!Number.isFinite(v) || v < 1 || v > pages) return toast('页码无效', 'err');
  state.archive.page = v;
  loadArchive();
});

/* ---------- 新建/编辑表单 ---------- */
function resetForm() {
  $('#equipForm').reset();
  $('#fId').value = '';
  $('#fStatus').value = '运行中';
  $('#formError').hidden = true;
  $('#formError').textContent = '';
}

$('#btnCreate').addEventListener('click', () => openForm(null));

async function openForm(id) {
  resetForm();
  if (id) {
    try {
      const body = await api(`/api/equipment/${id}`);
      const e = body.data.equipment;
      $('#formTitle').textContent = '编辑设备档案';
      $('#fId').value = e.id;
      $('#fStationName').value = e.stationName || '';
      $('#fEquipmentCode').value = e.equipmentCode || '';
      $('#fEquipmentName').value = e.equipmentName || '';
      $('#fPowerKw').value = e.powerKw === null ? '' : e.powerKw;
      $('#fInstallLocation').value = e.installLocation || '';
      $('#fTeamName').value = e.teamName || '';
      $('#fCommissionDate').value = e.commissionDate || '';
      $('#fStatus').value = e.status || '运行中';
      $('#fRemark').value = e.remark || '';
    } catch (e) {
      return toast(e.message, 'err');
    }
  } else {
    $('#formTitle').textContent = '新建设备档案';
    $('#fStatus').value = '运行中';
  }
  $('#formMask').hidden = false;
}

function collectForm() {
  return {
    stationName: $('#fStationName').value.trim(),
    equipmentCode: $('#fEquipmentCode').value.trim(),
    equipmentName: $('#fEquipmentName').value.trim(),
    powerKw: $('#fPowerKw').value.trim(),
    installLocation: $('#fInstallLocation').value.trim(),
    teamName: $('#fTeamName').value.trim(),
    commissionDate: $('#fCommissionDate').value,
    status: $('#fStatus').value,
    remark: $('#fRemark').value.trim()
  };
}

$('#btnSave').addEventListener('click', async () => {
  const id = $('#fId').value;
  const payload = collectForm();
  $('#formError').hidden = true;

  const btn = $('#btnSave');
  btn.disabled = true;
  try {
    if (id) {
      await api(`/api/equipment/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast('档案已更新');
    } else {
      await api('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast('档案已创建');
    }
    $('#formMask').hidden = true;
    loadArchive();
  } catch (e) {
    $('#formError').textContent = e.message;
    $('#formError').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 删除 ---------- */
async function doDelete(id) {
  const row = state.archive.list.find((x) => x.id === id);
  const label = row ? `${row.stationName} / ${row.equipmentCode}` : `#${id}`;
  if (!confirm(`确认删除设备档案「${label}」？\n删除后附件一并清除，操作不可恢复。`)) return;
  try {
    await api(`/api/equipment/${id}`, { method: 'DELETE' });
    toast('已删除');
    const pages = Math.max(1, Math.ceil((state.archive.total - 1) / state.archive.pageSize));
    if (state.archive.page > pages) state.archive.page = pages;
    loadArchive();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------- 详情 ---------- */
async function openDetail(id) {
  state.detailId = id;
  try {
    const body = await api(`/api/equipment/${id}`);
    renderDetail(body.data);
    $('#detailMask').hidden = false;
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderDetail({ equipment: e, attachments, logs }) {
  $('#detailBody').innerHTML = `
    <div class="detail-section">
      <h4>基本信息</h4>
      <div class="detail-grid">
        <div class="detail-item"><div class="k">设备编号</div><div class="v code-cell">${escapeHtml(e.equipmentCode)}</div></div>
        <div class="detail-item"><div class="k">运行状态</div><div class="v"><span class="badge ${statusClass(e.status)}">${escapeHtml(e.status)}</span></div></div>
        <div class="detail-item"><div class="k">投运日期</div><div class="v">${fmtDate(e.commissionDate)}</div></div>
        <div class="detail-item span2"><div class="k">泵站名称</div><div class="v">${escapeHtml(e.stationName)}</div></div>
        <div class="detail-item"><div class="k">功率(kW)</div><div class="v">${e.powerKw === null ? '—' : Number(e.powerKw).toLocaleString()}</div></div>
        <div class="detail-item"><div class="k">设备名称/型号</div><div class="v">${escapeHtml(e.equipmentName || '—')}</div></div>
        <div class="detail-item"><div class="k">责任班组</div><div class="v">${escapeHtml(e.teamName || '—')}</div></div>
        <div class="detail-item span3"><div class="k">安装位置</div><div class="v">${escapeHtml(e.installLocation || '—')}</div></div>
        <div class="detail-item span3"><div class="k">备注</div><div class="v">${escapeHtml(e.remark || '—')}</div></div>
        <div class="detail-item"><div class="k">建档时间</div><div class="v">${fmtDateTime(e.createdAt)}</div></div>
        <div class="detail-item"><div class="k">最后更新</div><div class="v">${fmtDateTime(e.updatedAt) || '—'}</div></div>
      </div>
    </div>

    <div class="detail-section">
      <h4>附件资料（${attachments.length}）</h4>
      <div class="upload-box">
        <div>上传设备照片、铭牌、说明书、检修单等附件（单个最大 50MB）</div>
        <input type="file" id="attachFile">
        <button class="btn primary small" id="btnUpload" style="margin-left:8px">上传</button>
      </div>
      <div id="attachList">
        ${attachments.length ? attachments.map((a) => `
          <div class="attach-row">
            <div>
              <div>📎 ${escapeHtml(a.originalName)}</div>
              <div class="meta">${fmtSize(a.size)} · ${escapeHtml(a.uploadedBy || '—')} · ${fmtDateTime(a.createdAt)}</div>
            </div>
            <div>
              <a class="btn small" href="/api/equipment/${e.id}/attachments/${a.id}/download?operator=${encodeURIComponent($('#operator').value.trim() || 'admin')}">下载</a>
              <button class="btn small danger" data-del-att="${a.id}">删除</button>
            </div>
          </div>`).join('') : '<div class="empty" style="padding:18px">暂无附件</div>'}
      </div>
    </div>

    <div class="detail-section">
      <h4>最近操作日志</h4>
      <div class="log-mini">
        ${logs.length ? logs.slice(0, 10).map((l) => `
          <div class="log-line">
            <span class="log-time">${fmtDateTime(l.createdAt)}</span>
            <span class="tag-action ${actionClass(l.action)}">${escapeHtml(l.action)}</span>
            <b>${escapeHtml(l.operator || '—')}</b> ${escapeHtml(l.detail || '')}
          </div>`).join('') : '<div class="empty" style="padding:18px">暂无操作日志</div>'}
      </div>
    </div>`;

  $('#btnDetailEdit').onclick = () => {
    $('#detailMask').hidden = true;
    openForm(e.id);
  };

  const fileInput = $('#attachFile');
  $('#btnUpload').addEventListener('click', async () => {
    const f = fileInput.files[0];
    if (!f) return toast('请先选择文件', 'err');
    const fd = new FormData();
    fd.append('file', f);
    const btn = $('#btnUpload');
    btn.disabled = true;
    btn.textContent = '上传中…';
    try {
      await api(`/api/equipment/${e.id}/attachments`, { method: 'POST', body: fd });
      toast('附件上传成功');
      openDetail(e.id);
    } catch (ex) {
      toast(ex.message, 'err');
      btn.disabled = false;
      btn.textContent = '上传';
    }
  });

  $$('#attachList [data-del-att]').forEach((b) => {
    b.addEventListener('click', async () => {
      const aid = Number(b.dataset.delAtt);
      if (!confirm('确认删除该附件？磁盘文件将一并删除。')) return;
      try {
        await api(`/api/equipment/${e.id}/attachments/${aid}`, { method: 'DELETE' });
        toast('附件已删除');
        openDetail(e.id);
      } catch (ex) {
        toast(ex.message, 'err');
      }
    });
  });
}

/* ---------- 全局操作日志 ---------- */
async function loadLogs() {
  const s = state.logs;
  s.equipmentId = ''; // 全局日志页按关键字过滤后由后端不支持关键字，这里前端筛选用 id 直查
  const keyword = $('#logKeyword').value.trim();
  let url = `/api/logs?page=${s.page}&pageSize=${s.pageSize}`;
  if (keyword) {
    // 按设备编号找到设备，再查该设备日志
    try {
      const q = new URLSearchParams({ keyword, page: 1, pageSize: 10 });
      const found = await api(`/api/equipment?${q}`);
      if (found.data.length === 0) {
        s.list = []; s.total = 0;
        renderLogs();
        return;
      }
      url = `/api/logs?equipmentId=${found.data[0].id}&page=${s.page}&pageSize=${s.pageSize}`;
    } catch (e) { toast(e.message, 'err'); return; }
  }
  try {
    const body = await api(url);
    s.list = body.data;
    s.total = body.total;
    renderLogs();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderLogs() {
  const s = state.logs;
  $('#logEmpty').hidden = s.list.length !== 0;
  $('#logBody').innerHTML = s.list.map((l) => `
    <tr>
      <td>${fmtDateTime(l.createdAt)}</td>
      <td><span class="tag-action ${actionClass(l.action)}">${escapeHtml(l.action)}</span></td>
      <td>${escapeHtml(l.detail || '')}</td>
      <td>${escapeHtml(l.operator || '—')}</td>
      <td>${l.equipmentId
        ? `<button class="btn link" data-goto="${l.equipmentId}">#${l.equipmentId}</button>`
        : '<span style="color:#8a9bb0">已删除</span>'}</td>
    </tr>`).join('');

  $$('#logBody [data-goto]').forEach((b) => {
    b.addEventListener('click', () => openDetail(Number(b.dataset.goto)));
  });

  const pages = Math.max(1, Math.ceil(s.total / s.pageSize));
  $('#logPagerInfo').textContent = `共 ${s.total} 条日志`;
  $('#logPageInfo').textContent = `第 ${s.page} / ${pages} 页`;
  $('#btnLogPrev').disabled = s.page <= 1;
  $('#btnLogNext').disabled = s.page >= pages;
}

$('#btnLogSearch').addEventListener('click', () => { state.logs.page = 1; loadLogs(); });
$('#logKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnLogSearch').click(); });
$('#btnLogReset').addEventListener('click', () => {
  $('#logKeyword').value = '';
  state.logs.page = 1;
  loadLogs();
});
$('#btnLogPrev').addEventListener('click', () => { state.logs.page--; loadLogs(); });
$('#btnLogNext').addEventListener('click', () => { state.logs.page++; loadLogs(); });

/* ---------- 弹窗关闭 ---------- */
$$('[data-close]').forEach((b) => {
  b.addEventListener('click', () => { $('#' + b.dataset.close).hidden = true; });
});
$$('.modal-mask').forEach((mask) => {
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.hidden = true; });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-mask').forEach((m) => { m.hidden = true; });
});

/* ---------- 启动 ---------- */
(async function init() {
  const savedOp = localStorage.getItem('operator');
  if (savedOp) $('#operator').value = savedOp;
  $('#operator').addEventListener('change', () => localStorage.setItem('operator', $('#operator').value.trim()));
  await loadStatuses();
  await loadArchive();
})();
