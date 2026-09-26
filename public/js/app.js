'use strict';

(function () {
  // ---------------- 全局状态 ----------------
  const state = {
    keyword: '',
    stationName: '',
    status: '',
    page: 1,
    pageSize: 10,
    total: 0,
    list: [],
    currentDetailId: null,
    confirmHandler: null
  };

  const STATUS_CLASS = {
    运行: 'badge-run',
    备用: 'badge-standby',
    检修: 'badge-repair',
    停用: 'badge-stopped'
  };

  const FILE_ICONS = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    ppt: '📙', pptx: '📙', jpg: '🖼️', jpeg: '🖼️', png: '🖼️',
    gif: '🖼️', zip: '🗜️', rar: '🗜️', '7z': '🗜️', txt: '📄',
    csv: '📊', dwg: '📐'
  };

  // ---------------- 工具 ----------------
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function escapeHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(v) { return escapeHtml(v); }

  function formatTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function formatSize(bytes) {
    const b = Number(bytes);
    if (!Number.isFinite(b)) return '-';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function fileIcon(name) {
    const ext = String(name).split('.').pop().toLowerCase();
    return FILE_ICONS[ext] || '📎';
  }

  function toast(message, type) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    $('#toastContainer').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  async function api(method, url, body) {
    const opts = {
      method,
      headers: { 'Accept': 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || (json && json.code && json.code !== 0)) {
      const msg = (json && json.message) || `请求失败（${res.status}）`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json ? json.data : null;
  }

  function statusBadge(status) {
    const cls = STATUS_CLASS[status] || 'badge-stopped';
    return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
  }

  // ---------------- 弹窗 ----------------
  function openModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) { $('#' + id).hidden = true; }

  function confirmDialog(title, message, onOk) {
    $('#confirmTitle').textContent = title || '确认操作';
    $('#confirmMessage').textContent = message;
    state.confirmHandler = onOk;
    openModal('confirmModal');
  }

  $all('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
  });
  // 点击遮罩关闭
  $all('.modal-mask').forEach((mask) => {
    mask.addEventListener('click', (e) => {
      if (e.target === mask) mask.hidden = true;
    });
  });
  $('#btnConfirmOk').addEventListener('click', async () => {
    const handler = state.confirmHandler;
    state.confirmHandler = null;
    closeModal('confirmModal');
    if (handler) {
      try { await handler(); } catch (e) { toast(e.message, 'error'); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $all('.modal-mask').forEach((m) => { m.hidden = true; });
    }
  });

  // ---------------- 统计 ----------------
  async function loadSummary() {
    try {
      const data = await api('GET', '/api/equipment/summary');
      $('#statTotal').textContent = data.total;
      const map = {};
      data.byStatus.forEach((s) => { map[s.status] = s.count; });
      $('#statRun').textContent = map['运行'] || 0;
      $('#statStandby').textContent = map['备用'] || 0;
      $('#statRepair').textContent = map['检修'] || 0;
      $('#statStopped').textContent = map['停用'] || 0;
      $('#statPower').textContent = Number(data.totalPower).toLocaleString();
    } catch (e) {
      toast('统计加载失败：' + e.message, 'error');
    }
  }

  // ---------------- 泵站联想 ----------------
  async function loadStations() {
    try {
      const names = await api('GET', '/api/equipment/stations');
      $('#stationList').innerHTML = names
        .map((n) => `<option value="${escapeAttr(n)}"></option>`)
        .join('');
    } catch (e) { /* 非关键 */ }
  }

  // ---------------- 列表 ----------------
  function buildQuery() {
    const params = new URLSearchParams();
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.stationName) params.set('stationName', state.stationName);
    if (state.status) params.set('status', state.status);
    return params.toString();
  }

  async function loadList() {
    const tbody = $('#equipmentTbody');
    tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">加载中...</td></tr>';
    try {
      const data = await api('GET', '/api/equipment?' + buildQuery());
      state.list = data.list;
      state.total = data.total;
      renderTable();
      renderPagination();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">加载失败：${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function renderTable() {
    const tbody = $('#equipmentTbody');
    if (!state.list.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">暂无符合条件的设备档案</td></tr>';
      return;
    }
    const start = (state.page - 1) * state.pageSize;
    tbody.innerHTML = state.list.map((r, i) => `
      <tr>
        <td>${start + i + 1}</td>
        <td>${escapeHtml(r.stationName)}</td>
        <td class="cell-code">${escapeHtml(r.deviceCode)}</td>
        <td class="cell-name">${escapeHtml(r.deviceName)}</td>
        <td class="num">${Number(r.powerKw).toLocaleString()}</td>
        <td>${escapeHtml(r.installLocation)}</td>
        <td>${escapeHtml(r.responsibleTeam)}</td>
        <td>${escapeHtml(r.commissionDate || '-')}</td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <div class="col-actions">
            <button class="btn-link" data-action="view" data-id="${r.id}">详情</button>
            <button class="btn-link" data-action="edit" data-id="${r.id}">编辑</button>
            <button class="btn-link danger" data-action="delete" data-id="${r.id}">删除</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        const action = btn.getAttribute('data-action');
        if (action === 'view') openDetail(id);
        if (action === 'edit') openForm(id);
        if (action === 'delete') onDelete(id);
      });
    });
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.total, state.page * state.pageSize);

    let pages = [];
    const add = (p) => pages.push(p);
    const cur = state.page;
    add(1);
    if (cur - 2 > 2) add('...');
    for (let p = Math.max(2, cur - 1); p <= Math.min(totalPages - 1, cur + 1); p++) add(p);
    if (cur + 2 < totalPages - 1) add('...');
    if (totalPages > 1) add(totalPages);

    const html = `
      <div class="page-info">共 ${state.total} 条，显示 ${start}-${end} 条</div>
      <div class="page-controls">
        <select class="page-size-sel" id="pageSizeSel">
          <option value="10" ${state.pageSize === 10 ? 'selected' : ''}>10 条/页</option>
          <option value="20" ${state.pageSize === 20 ? 'selected' : ''}>20 条/页</option>
          <option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50 条/页</option>
        </select>
        <button class="page-btn" id="pageFirst" ${cur === 1 ? 'disabled' : ''}>首页</button>
        <button class="page-btn" id="pagePrev" ${cur === 1 ? 'disabled' : ''}>上一页</button>
        ${pages.map((p) => p === '...'
          ? '<span class="page-ellipsis">…</span>'
          : `<button class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p}</button>`
        ).join('')}
        <button class="page-btn" id="pageNext" ${cur === totalPages ? 'disabled' : ''}>下一页</button>
        <button class="page-btn" id="pageLast" ${cur === totalPages ? 'disabled' : ''}>末页</button>
      </div>
    `;
    $('#pagination').innerHTML = html;

    $('#pageSizeSel').addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value);
      state.page = 1;
      loadList();
    });
    $('#pageFirst').addEventListener('click', () => gotoPage(1));
    $('#pagePrev').addEventListener('click', () => gotoPage(state.page - 1));
    $('#pageNext').addEventListener('click', () => gotoPage(state.page + 1));
    $('#pageLast').addEventListener('click', () => gotoPage(totalPages));
    $all('#pagination [data-page]').forEach((b) => {
      b.addEventListener('click', () => gotoPage(Number(b.getAttribute('data-page'))));
    });
  }

  function gotoPage(p) {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    state.page = Math.min(Math.max(1, p), totalPages);
    loadList();
  }

  // ---------------- 搜索 ----------------
  function applySearch(resetPage) {
    state.keyword = $('#kwInput').value.trim();
    state.stationName = $('#stationInput').value.trim();
    state.status = $('#statusSelect').value;
    if (resetPage !== false) state.page = 1;
    loadList();
  }

  $('#btnSearch').addEventListener('click', () => applySearch());
  $('#btnReset').addEventListener('click', () => {
    $('#kwInput').value = '';
    $('#stationInput').value = '';
    $('#statusSelect').value = '';
    state.keyword = '';
    state.stationName = '';
    state.status = '';
    state.page = 1;
    loadList();
  });
  $('#kwInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applySearch();
  });
  $('#stationInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applySearch();
  });
  $('#statusSelect').addEventListener('change', () => applySearch());

  // ---------------- 新建 / 编辑表单 ----------------
  const FORM_FIELDS = [
    'fStationName', 'fDeviceCode', 'fDeviceName', 'fPumpModel', 'fPowerKw',
    'fVoltage', 'fFlowM3h', 'fHeadM', 'fSpeedRpm', 'fCurrentA',
    'fManufacturer', 'fCommissionDate', 'fInstallLocation',
    'fResponsibleTeam', 'fStatus', 'fRemark'
  ];

  function clearFormErrors() {
    $all('#equipmentForm .form-error').forEach((e) => e.remove());
    $all('#equipmentForm input, #equipmentForm select, #equipmentForm textarea')
      .forEach((el) => el.classList.remove('invalid'));
  }

  function setFieldError(id, msg) {
    const el = $('#' + id);
    el.classList.add('invalid');
    const err = document.createElement('div');
    err.className = 'form-error';
    err.textContent = msg;
    el.parentNode.appendChild(err);
  }

  function openCreate() {
    clearFormErrors();
    $('#formTitle').textContent = '新建设备档案';
    $('#fId').value = '';
    FORM_FIELDS.forEach((id) => {
      const el = $('#' + id);
      if (el.tagName === 'SELECT') el.value = '运行';
      else el.value = '';
    });
    openModal('formModal');
    setTimeout(() => $('#fStationName').focus(), 50);
  }

  async function openForm(id) {
    clearFormErrors();
    let row;
    try {
      row = await api('GET', `/api/equipment/${id}`);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    $('#formTitle').textContent = '编辑设备档案';
    $('#fId').value = row.id;
    $('#fStationName').value = row.stationName || '';
    $('#fDeviceCode').value = row.deviceCode || '';
    $('#fDeviceName').value = row.deviceName || '';
    $('#fPumpModel').value = row.pumpModel || '';
    $('#fPowerKw').value = row.powerKw ?? '';
    $('#fVoltage').value = row.voltage || '';
    $('#fFlowM3h').value = row.flowM3h ?? '';
    $('#fHeadM').value = row.headM ?? '';
    $('#fSpeedRpm').value = row.speedRpm ?? '';
    $('#fCurrentA').value = row.currentA ?? '';
    $('#fManufacturer').value = row.manufacturer || '';
    $('#fCommissionDate').value = row.commissionDate || '';
    $('#fInstallLocation').value = row.installLocation || '';
    $('#fResponsibleTeam').value = row.responsibleTeam || '';
    $('#fStatus').value = row.status || '运行';
    $('#fRemark').value = row.remark || '';
    openModal('formModal');
  }

  function collectForm() {
    return {
      stationName: $('#fStationName').value.trim(),
      deviceCode: $('#fDeviceCode').value.trim(),
      deviceName: $('#fDeviceName').value.trim(),
      pumpModel: $('#fPumpModel').value.trim(),
      powerKw: $('#fPowerKw').value,
      voltage: $('#fVoltage').value.trim(),
      flowM3h: $('#fFlowM3h').value,
      headM: $('#fHeadM').value,
      speedRpm: $('#fSpeedRpm').value,
      currentA: $('#fCurrentA').value,
      manufacturer: $('#fManufacturer').value.trim(),
      commissionDate: $('#fCommissionDate').value,
      installLocation: $('#fInstallLocation').value.trim(),
      responsibleTeam: $('#fResponsibleTeam').value.trim(),
      status: $('#fStatus').value,
      remark: $('#fRemark').value.trim()
    };
  }

  function validateForm(data) {
    clearFormErrors();
    let ok = true;
    const require = (id, val, label) => {
      if (!val) { setFieldError(id, `请填写${label}`); ok = false; }
    };
    require('fStationName', data.stationName, '泵站名称');
    require('fDeviceCode', data.deviceCode, '设备编号');
    require('fDeviceName', data.deviceName, '设备名称');
    require('fPowerKw', data.powerKw, '功率');
    require('fInstallLocation', data.installLocation, '安装位置');
    require('fResponsibleTeam', data.responsibleTeam, '责任班组');

    if (data.powerKw && (Number(data.powerKw) <= 0 || !Number.isFinite(Number(data.powerKw)))) {
      setFieldError('fPowerKw', '功率必须为大于 0 的数值');
      ok = false;
    }
    ['fFlowM3h', 'fHeadM', 'fSpeedRpm', 'fCurrentA'].forEach((id) => {
      const v = $('#' + id).value;
      if (v && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        setFieldError(id, '必须为非负数值');
        ok = false;
      }
    });
    if (data.commissionDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.commissionDate)) {
      setFieldError('fCommissionDate', '日期格式应为 YYYY-MM-DD');
      ok = false;
    }
    return ok;
  }

  $('#btnSave').addEventListener('click', async () => {
    const data = collectForm();
    if (!validateForm(data)) {
      toast('请检查表单中标红的字段', 'error');
      return;
    }
    const id = $('#fId').value;
    const btn = $('#btnSave');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      if (id) {
        await api('PUT', `/api/equipment/${id}`, data);
        toast('设备档案已更新', 'success');
      } else {
        await api('POST', '/api/equipment', data);
        toast('设备档案已创建', 'success');
      }
      closeModal('formModal');
      await Promise.all([loadList(), loadSummary(), loadStations()]);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });

  // ---------------- 删除 ----------------
  async function onDelete(id) {
    const row = state.list.find((r) => r.id === id);
    const label = row ? `${row.stationName} / ${row.deviceCode}` : `#${id}`;
    confirmDialog(
      '删除设备档案',
      `确定删除「${label}」吗？该设备的附件与操作日志将一并级联删除，此操作不可恢复。`,
      async () => {
        await api('DELETE', `/api/equipment/${id}`);
        toast('设备档案已删除', 'success');
        const totalPages = Math.max(1, Math.ceil((state.total - 1) / state.pageSize));
        if (state.page > totalPages) state.page = totalPages;
        await Promise.all([loadList(), loadSummary(), loadStations()]);
      }
    );
  }

  // ---------------- 详情 ----------------
  async function openDetail(id) {
    state.currentDetailId = id;
    $('#detailBody').innerHTML = '<div class="loading-cell">加载中...</div>';
    openModal('detailModal');
    try {
      const row = await api('GET', `/api/equipment/${id}`);
      renderDetail(row);
    } catch (e) {
      $('#detailBody').innerHTML = `<div class="empty-cell">加载失败：${escapeHtml(e.message)}</div>`;
    }
  }

  function detailItem(label, value, full) {
    return `<div class="detail-item ${full ? 'full' : ''}">
      <span class="k">${escapeHtml(label)}</span>
      <span class="v">${value === null || value === '' ? '-' : value}</span>
    </div>`;
  }

  function renderDetail(row) {
    const attHtml = row.attachments.length
      ? `<ul class="att-list">${row.attachments.map((a) => `
          <li class="att-item">
            <span class="att-icon">${fileIcon(a.originalName)}</span>
            <div class="att-meta">
              <div class="att-name" title="${escapeAttr(a.originalName)}">${escapeHtml(a.originalName)}</div>
              <div class="att-sub">${formatSize(a.fileSize)} · ${escapeHtml(a.uploadedBy)} · ${formatTime(a.createdAt)}</div>
            </div>
            <div class="att-actions">
              <button class="btn-link" data-att="download" data-id="${a.id}">下载</button>
              <button class="btn-link danger" data-att="delete" data-id="${a.id}">删除</button>
            </div>
          </li>`).join('')}
        </ul>`
      : '<div class="att-empty">暂无附件</div>';

    const logHtml = row.logs.length
      ? `<ul class="log-list">${row.logs.map((l) => `
          <li class="log-item log-${escapeAttr(l.action)}">
            <span class="log-action">${escapeHtml(l.action)}</span>
            <span class="log-operator">${escapeHtml(l.operator)}</span>
            <span class="log-time">${formatTime(l.createdAt)}</span>
            <div class="log-detail">${escapeHtml(l.detail)}</div>
          </li>`).join('')}
        </ul>`
      : '<div class="att-empty">暂无操作日志</div>';

    $('#detailBody').innerHTML = `
      <div class="detail-head">
        <h4>${escapeHtml(row.deviceName)}</h4>
        <span class="cell-code">${escapeHtml(row.deviceCode)}</span>
        ${statusBadge(row.status)}
      </div>

      <div class="detail-section-title">基础信息</div>
      <div class="detail-grid">
        ${detailItem('泵站名称', escapeHtml(row.stationName))}
        ${detailItem('设备编号', escapeHtml(row.deviceCode))}
        ${detailItem('设备名称', escapeHtml(row.deviceName))}
        ${detailItem('水泵型号', escapeHtml(row.pumpModel))}
        ${detailItem('功率(kW)', escapeHtml(row.powerKw))}
        ${detailItem('额定电压', escapeHtml(row.voltage))}
      </div>

      <div class="detail-section-title">技术参数</div>
      <div class="detail-grid">
        ${detailItem('流量(m³/h)', row.flowM3h != null ? escapeHtml(row.flowM3h) : '')}
        ${detailItem('扬程(m)', row.headM != null ? escapeHtml(row.headM) : '')}
        ${detailItem('转速(r/min)', row.speedRpm != null ? escapeHtml(row.speedRpm) : '')}
        ${detailItem('额定电流(A)', row.currentA != null ? escapeHtml(row.currentA) : '')}
        ${detailItem('生产厂家', escapeHtml(row.manufacturer))}
        ${detailItem('投运日期', escapeHtml(row.commissionDate))}
      </div>

      <div class="detail-section-title">管理信息</div>
      <div class="detail-grid">
        ${detailItem('安装位置', escapeHtml(row.installLocation))}
        ${detailItem('责任班组', escapeHtml(row.responsibleTeam))}
        ${detailItem('运行状态', statusBadge(row.status))}
        ${detailItem('档案创建时间', formatTime(row.createdAt))}
        ${detailItem('最后更新时间', formatTime(row.updatedAt))}
        ${detailItem('备注', escapeHtml(row.remark), true)}
      </div>

      <div class="detail-section-title">附件（${row.attachments.length}）</div>
      <div class="upload-row">
        <input type="file" id="attFile" />
        <button class="btn btn-primary btn-sm" id="btnUpload" style="height:32px">上传附件</button>
      </div>
      ${attHtml}

      <div class="detail-section-title">操作日志（${row.logs.length}）</div>
      ${logHtml}
    `;

    // 编辑按钮
    $('#btnDetailEdit').onclick = () => {
      closeModal('detailModal');
      openForm(row.id);
    };

    // 附件操作
    $all('#detailBody [data-att]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const attId = Number(btn.getAttribute('data-id'));
        const action = btn.getAttribute('data-att');
        if (action === 'download') downloadAttachment(attId);
        if (action === 'delete') deleteAttachment(attId);
      });
    });

    $('#btnUpload').addEventListener('click', uploadAttachment);
  }

  async function uploadAttachment() {
    const fileInput = $('#attFile');
    if (!fileInput.files || !fileInput.files[0]) {
      toast('请先选择要上传的文件', 'error');
      return;
    }
    const file = fileInput.files[0];
    const fd = new FormData();
    fd.append('file', file);
    const btn = $('#btnUpload');
    btn.disabled = true;
    btn.textContent = '上传中...';
    try {
      await fetch(`/api/equipment/${state.currentDetailId}/attachments`, {
        method: 'POST',
        body: fd
      }).then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || (json && json.code && json.code !== 0)) {
          throw new Error((json && json.message) || `上传失败（${res.status}）`);
        }
      });
      toast('附件上传成功', 'success');
      await openDetail(state.currentDetailId);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '上传附件';
    }
  }

  function downloadAttachment(id) {
    window.open(`/api/attachments/${id}/download`, '_blank');
  }

  function deleteAttachment(id) {
    confirmDialog('删除附件', '确定删除该附件吗？服务器上的物理文件也会被删除。', async () => {
      await api('DELETE', `/api/attachments/${id}`);
      toast('附件已删除', 'success');
      await openDetail(state.currentDetailId);
    });
  }

  // ---------------- 初始化 ----------------
  $('#btnCreate').addEventListener('click', openCreate);

  async function init() {
    try {
      const health = await api('GET', '/health');
      $('#driverBadge').textContent = '数据驱动：' + (health.driver === 'mssql' ? 'SQL Server' : '内存（演示）');
    } catch (e) { /* ignore */ }
    await Promise.all([loadSummary(), loadStations(), loadList()]);
  }

  init();
})();
