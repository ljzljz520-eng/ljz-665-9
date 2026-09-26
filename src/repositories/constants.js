'use strict';

// 运行状态（与数据库 CHECK 约束保持一致）
const RUN_STATUSES = ['运行', '备用', '检修', '停用'];

// 操作日志动作类型
const LOG_ACTIONS = ['新建', '编辑', '删除', '上传附件', '删除附件'];

module.exports = { RUN_STATUSES, LOG_ACTIONS };
