const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const { getOperator } = require('../util');

const router = express.Router({ mergeParams: true });

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^\w.\-]/g, '').slice(0, 20);
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `att_${req.equipmentId}_${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMB * 1024 * 1024 }
});

// 确保设备存在
router.use(async (req, res, next) => {
  const id = Number(req.params.equipmentId);
  if (!Number.isInteger(id)) return res.status(400).json({ code: 1, message: '无效的设备ID' });
  const equipment = await db.getEquipment(id);
  if (!equipment) return res.status(404).json({ code: 1, message: '设备档案不存在' });
  req.equipmentId = id;
  req.equipment = equipment;
  next();
});

// 附件列表（详情接口已含，这里单独提供）
router.get('/', async (req, res, next) => {
  try {
    const list = await db.listAttachments(req.equipmentId);
    res.json({ code: 0, data: list });
  } catch (err) {
    next(err);
  }
});

// 上传附件
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ code: 1, message: `文件超过 ${config.maxUploadMB}MB 限制` });
        }
        return res.status(400).json({ code: 1, message: err.message });
      }
      if (!req.file) return res.status(400).json({ code: 1, message: '未收到上传文件（字段名须为 file）' });

      const operator = getOperator(req);
      const f = req.file;
      const attachment = await db.createAttachment(req.equipmentId, {
        originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
        storedName: f.filename,
        size: f.size,
        mimeType: f.mimetype,
        uploadedBy: operator
      });
      await db.addLog({
        equipmentId: req.equipmentId,
        action: '附件',
        detail: `上传附件：${attachment.originalName}（${formatSize(attachment.size)}）`,
        operator
      });
      res.status(201).json({ code: 0, data: attachment, message: '上传成功' });
    } catch (e) {
      next(e);
    }
  });
});

function formatSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

// 下载
router.get('/:id/download', async (req, res, next) => {
  try {
    const a = await db.getAttachment(Number(req.params.id));
    if (!a || a.equipmentId !== req.equipmentId) {
      return res.status(404).json({ code: 1, message: '附件不存在' });
    }
    const filePath = path.join(config.uploadDir, a.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(410).json({ code: 1, message: '附件文件已从磁盘丢失' });
    }
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(a.originalName)}`);
    res.download(filePath, a.originalName);
  } catch (err) {
    next(err);
  }
});

// 删除附件
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const a = await db.getAttachment(id);
    if (!a || a.equipmentId !== req.equipmentId) {
      return res.status(404).json({ code: 1, message: '附件不存在' });
    }
    const storedName = await db.deleteAttachment(id);
    if (storedName) {
      try { fs.unlinkSync(path.join(config.uploadDir, storedName)); } catch (e) {}
    }
    const operator = getOperator(req);
    await db.addLog({
      equipmentId: req.equipmentId,
      action: '附件',
      detail: `删除附件：${a.originalName}`,
      operator
    });
    res.json({ code: 0, message: '附件已删除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
