'use strict';

const express = require('express');
const router = express.Router();
const repo = require('../repositories');
const { RUN_STATUSES } = require('../repositories/constants');
const asyncHandler = require('../utils/async-handler');

const REQUIRED = ['stationName', 'deviceCode', 'deviceName', 'powerKw', 'installLocation', 'responsibleTeam', 'status'];
const STRING_FIELDS = ['stationName', 'deviceCode', 'deviceName', 'pumpModel', 'voltage', 'manufacturer', 'installLocation', 'responsibleTeam', 'status', 'remark'];
const NUMERIC_FIELDS = ['powerKw', 'flowM3h', 'headM', 'speedRpm', 'currentA'];
const MAX_LEN = {
  stationName: 100, deviceCode: 50, deviceName: 100, pumpModel: 80,
  voltage: 20, manufacturer: 100, installLocation: 200,
  responsibleTeam: 50, status: 10, remark: 1000
};

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

function toStr(v) {
  return typeof v === 'string' ? v.trim() : v;
}

/**
 * 校验并归一化设备数据。
 * @param {object} body 原始请求体
 * @param {boolean} partial 为 true 时仅校验出现的字段（编辑场景）
 */
function validate(body, partial) {
  const out = {};

  for (const field of STRING_FIELDS) {
    if (!(field in body)) continue;
    let v = body[field];
    if (v === null || v === undefined) v = '';
    if (typeof v !== 'string') {
      throw badRequest(`字段 ${field} 必须为字符串`);
    }
    v = v.trim();
    if (MAX_LEN[field] && v.length > MAX_LEN[field]) {
      throw badRequest(`字段 ${field} 长度不能超过 ${MAX_LEN[field]}`);
    }
    out[field] = v;
  }

  for (const field of NUMERIC_FIELDS) {
    if (!(field in body)) continue;
    let v = body[field];
    if (v === '' || v === null || v === undefined) {
      out[field] = null;
      continue;
    }
    v = Number(v);
    if (!Number.isFinite(v) || v < 0) {
      throw badRequest(`字段 ${field} 必须为非负数值`);
    }
    out[field] = Math.round(v * 100) / 100;
  }

  if ('commissionDate' in body) {
    const v = toStr(body.commissionDate);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw badRequest('投运日期格式应为 YYYY-MM-DD');
    }
    if (v && Number.isNaN(new Date(v + 'T00:00:00').getTime())) {
      throw badRequest('投运日期不是有效日期');
    }
    out.commissionDate = v || null;
  }

  if ('status' in out && !RUN_STATUSES.includes(out.status)) {
    throw badRequest(`运行状态必须为：${RUN_STATUSES.join('、')}`);
  }

  if (!partial) {
    for (const field of REQUIRED) {
      const v = out[field];
      if (v === undefined || v === null || v === '') {
        throw badRequest(`缺少必填字段：${field}`);
      }
    }
    if (!Number.isFinite(out.powerKw) || out.powerKw <= 0) {
      throw badRequest('功率(kW)必须为大于 0 的数值');
    }
  }

  return out;
}

// GET /api/equipment?keyword=&stationName=&status=&page=1&pageSize=10
router.get(
  '/',
  asyncHandler(async (req, res) => {
    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 10;
    pageSize = Math.min(pageSize, 100);

    const result = await repo.listEquipment({
      keyword: toStr(req.query.keyword) || '',
      stationName: toStr(req.query.stationName) || '',
      status: toStr(req.query.status) || '',
      page,
      pageSize
    });
    res.json({ code: 0, data: result });
  })
);

// GET /api/equipment/stations （泵站名称联想）
router.get(
  '/stations',
  asyncHandler(async (req, res) => {
    const names = await repo.listStationNames(toStr(req.query.keyword) || '');
    res.json({ code: 0, data: names });
  })
);

// GET /api/equipment/summary （状态统计）
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const data = await repo.statusSummary();
    res.json({ code: 0, data });
  })
);

// GET /api/equipment/statuses （运行状态枚举）
router.get('/statuses', (req, res) => {
  res.json({ code: 0, data: RUN_STATUSES });
});

// GET /api/equipment/:id （详情：含附件与操作日志）
router.get(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const equipment = await repo.getEquipmentById(id);
    if (!equipment) {
      throw Object.assign(new Error('设备档案不存在'), { status: 404 });
    }
    const [attachments, logs] = await Promise.all([
      repo.listAttachments(id),
      repo.listLogs(id, 200)
    ]);
    res.json({ code: 0, data: { ...equipment, attachments, logs } });
  })
);

// POST /api/equipment
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(req.body || {}, false);
    const existing = await repo.getEquipmentByCode(data.deviceCode);
    if (existing) {
      throw Object.assign(new Error('设备编号已存在'), { status: 409 });
    }
    const row = await repo.createEquipment(data, req.operator);
    res.status(201).json({ code: 0, data: row, message: '创建成功' });
  })
);

// PUT /api/equipment/:id
router.put(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const data = validate(req.body || {}, true);
    if (Object.keys(data).length === 0) {
      throw badRequest('没有可更新的字段');
    }
    if (data.deviceCode) {
      const dup = await repo.getEquipmentByCode(data.deviceCode);
      if (dup && dup.id !== id) {
        throw Object.assign(new Error('设备编号已存在'), { status: 409 });
      }
    }
    const row = await repo.updateEquipment(id, data, req.operator);
    if (!row) {
      throw Object.assign(new Error('设备档案不存在'), { status: 404 });
    }
    res.json({ code: 0, data: row, message: '更新成功' });
  })
);

// DELETE /api/equipment/:id
router.delete(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const ok = await repo.deleteEquipment(id, req.operator);
    if (!ok) {
      throw Object.assign(new Error('设备档案不存在'), { status: 404 });
    }
    res.json({ code: 0, message: '删除成功' });
  })
);

// GET /api/equipment/:id/logs
router.get(
  '/:id(\\d+)/logs',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const equipment = await repo.getEquipmentById(id);
    if (!equipment) {
      throw Object.assign(new Error('设备档案不存在'), { status: 404 });
    }
    const logs = await repo.listLogs(id, 500);
    res.json({ code: 0, data: logs });
  })
);

module.exports = router;
