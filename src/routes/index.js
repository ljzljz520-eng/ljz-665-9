'use strict';

const express = require('express');
const router = express.Router();
const { equipmentAttachmentRouter, attachmentRouter } = require('./attachments');

router.use('/equipment', require('./equipment'));
router.use('/equipment', equipmentAttachmentRouter);
router.use('/attachments', attachmentRouter);

module.exports = router;
