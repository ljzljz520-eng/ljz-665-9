const express = require('express');
const db = require('../db');

const router = express.Router();

// 全局操作日志（分页）；?equipmentId= 可按设备过滤
router.get('/', async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 10;
    pageSize = Math.min(pageSize, 100);

    const equipmentId = req.query.equipmentId ? Number(req.query.equipmentId) : null;
    const result = await db.listLogs({ equipmentId, page, pageSize });
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

module.exports = router;
