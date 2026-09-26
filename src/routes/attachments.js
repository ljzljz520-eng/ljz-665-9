'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');

const config = require('../config');
const repo = require('../repositories');
const asyncHandler = require('../utils/async-handler');

// 挂在 /api/equipment：设备维度的附件上传
const equipmentAttachmentRouter = express.Router();
// 挂在 /api/attachments：附件维度的下载/删除
const attachmentRouter = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.uploadDir, String(req.params.id));
    fsp
      .mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch(cb);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMB * 1024 * 1024 }
});

// POST /api/equipment/:id/attachments  (multipart/form-data, field: file)
equipmentAttachmentRouter.post(
  '/:id(\\d+)/attachments',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            Object.assign(
              new Error(`文件超过大小限制（${config.maxUploadMB}MB）`),
              { status: 413 }
            )
          );
        }
        return next(Object.assign(new Error('文件上传失败：' + err.message), { status: 400 }));
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const equipmentId = parseInt(req.params.id, 10);
    const equipment = await repo.getEquipmentById(equipmentId);
    if (!equipment) {
      // 设备不存在时清理已落盘的文件
      if (req.file) {
        await fsp.unlink(req.file.path).catch(() => {});
      }
      throw Object.assign(new Error('设备档案不存在'), { status: 404 });
    }
    if (!req.file) {
      throw Object.assign(new Error('未接收到上传文件（表单字段名需为 file）'), { status: 400 });
    }

    const relPath = path.join(String(equipmentId), req.file.filename);
    const att = await repo.createAttachment(
      {
        equipmentId,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        filePath: relPath,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedBy: req.operator
      },
      req.operator
    );
    res.status(201).json({ code: 0, data: att, message: '附件上传成功' });
  })
);

// GET /api/attachments/:id/download
attachmentRouter.get(
  '/:id(\\d+)/download',
  asyncHandler(async (req, res) => {
    const att = await repo.getAttachmentById(parseInt(req.params.id, 10));
    if (!att) {
      throw Object.assign(new Error('附件不存在'), { status: 404 });
    }
    const fullPath = path.join(config.uploadDir, att.filePath);
    if (!fs.existsSync(fullPath)) {
      throw Object.assign(new Error('附件文件在服务器上已丢失'), { status: 410 });
    }
    // RFC 5987 编码，兼容中文文件名
    const encoded = encodeURIComponent(att.originalName);
    res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encoded}`
    );
    res.setHeader('Content-Length', att.fileSize);
    fs.createReadStream(fullPath).pipe(res);
  })
);

// DELETE /api/attachments/:id
attachmentRouter.delete(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const att = await repo.deleteAttachment(parseInt(req.params.id, 10), req.operator);
    if (!att) {
      throw Object.assign(new Error('附件不存在'), { status: 404 });
    }
    // 数据库记录已删除，尽力删除物理文件
    const fullPath = path.join(config.uploadDir, att.filePath);
    await fsp.unlink(fullPath).catch((e) => {
      console.warn(`[attachment] 物理文件删除失败: ${fullPath} - ${e.message}`);
    });
    res.json({ code: 0, message: '附件已删除' });
  })
);

module.exports = { equipmentAttachmentRouter, attachmentRouter };
