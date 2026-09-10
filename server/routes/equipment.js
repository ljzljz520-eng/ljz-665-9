const express = require('express');
const db = require('../db');
const { STATUS_LIST } = require('../constants');
const {
  getOperator, normalizeBody, validateEquipment, buildDiff
} = require('../util');

const router = express.Router();

// 状态枚举
router.get('/meta/statuses', (req, res) => {
  res.json({ code: 0, data: STATUS_LIST });
});

// 列表：搜索 + 分页
router.get('/', async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 10;
    pageSize = Math.min(pageSize, 100);

    const result = await db.listEquipment({
      keyword: req.query.keyword || '',
      status: req.query.status || '',
      page,
      pageSize
    });
    res.json({
      code: 0,
      data: result.list,
      total: result.total,
      page,
      pageSize
    });
  } catch (err) {
    next(err);
  }
});

// 详情（含附件、最近日志）
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ code: 1, message: '无效的设备ID' });

    const equipment = await db.getEquipment(id);
    if (!equipment) return res.status(404).json({ code: 1, message: '设备档案不存在' });

    const [attachments, logs] = await Promise.all([
      db.listAttachments(id),
      db.listLogs({ equipmentId: id, page: 1, pageSize: 20 })
    ]);
    res.json({
      code: 0,
      data: { equipment, attachments, logs: logs.list, logTotal: logs.total }
    });
  } catch (err) {
    next(err);
  }
});

// 新建
router.post('/', async (req, res, next) => {
  try {
    const operator = getOperator(req);
    const data = normalizeBody(req.body);
    const errors = validateEquipment(data);
    if (errors.length) return res.status(400).json({ code: 1, message: errors.join('；') });

    const dup = await db.getEquipmentByCode(data.equipmentCode);
    if (dup) return res.status(409).json({ code: 1, message: `设备编号已存在：${data.equipmentCode}` });

    const equipment = await db.createEquipment(data, operator);
    await db.addLog({
      equipmentId: equipment.id,
      action: '新建',
      detail: `建立设备档案（${equipment.stationName} / ${equipment.equipmentCode}）`,
      operator
    });
    res.status(201).json({ code: 0, data: equipment, message: '创建成功' });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ code: 1, message: '设备编号已存在' });
    }
    next(err);
  }
});

// 编辑
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ code: 1, message: '无效的设备ID' });

    const before = await db.getEquipment(id);
    if (!before) return res.status(404).json({ code: 1, message: '设备档案不存在' });

    const operator = getOperator(req);
    const data = normalizeBody(req.body);
    const errors = validateEquipment(data);
    if (errors.length) return res.status(400).json({ code: 1, message: errors.join('；') });

    const dup = await db.getEquipmentByCode(data.equipmentCode, id);
    if (dup) return res.status(409).json({ code: 1, message: `设备编号已存在：${data.equipmentCode}` });

    const after = await db.updateEquipment(id, data);
    const changes = buildDiff(before, after);
    const detail = changes.length
      ? `修改字段：${changes.join('；')}`
      : '保存档案（无字段变化）';
    await db.addLog({ equipmentId: id, action: '编辑', detail, operator });
    res.json({ code: 0, data: after, message: '更新成功' });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ code: 1, message: '设备编号已存在' });
    }
    next(err);
  }
});

// 删除
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ code: 1, message: '无效的设备ID' });

    const equipment = await db.getEquipment(id);
    if (!equipment) return res.status(404).json({ code: 1, message: '设备档案不存在' });

    const operator = getOperator(req);
    // 先写删除日志（外键删除后 EquipmentId 会被置空，详情写入文本中保留信息）
    await db.addLog({
      equipmentId: id,
      action: '删除',
      detail: `删除设备档案：${equipment.stationName} / ${equipment.equipmentCode}`,
      operator
    });
    const attachments = await db.listAttachments(id);
    await db.deleteEquipment(id);

    const fs = require('fs');
    const path = require('path');
    const config = require('../config');
    for (const a of attachments) {
      try {
        fs.unlinkSync(path.join(config.uploadDir, a.storedName));
      } catch (e) { /* 忽略磁盘残留 */ }
    }

    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
