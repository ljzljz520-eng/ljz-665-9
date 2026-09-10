const { STATUS_LIST, FIELD_LABELS } = require('./constants');

function getOperator(req) {
  return (req.get('X-Operator') || req.query.operator || 'admin')
    .toString().trim().slice(0, 50) || 'admin';
}

function normalizeBody(body) {
  const b = body || {};
  const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const dateVal = str(b.commissionDate);
  return {
    stationName: str(b.stationName),
    equipmentCode: str(b.equipmentCode),
    equipmentName: str(b.equipmentName),
    powerKw: str(b.powerKw),
    installLocation: str(b.installLocation),
    teamName: str(b.teamName),
    commissionDate: dateVal,
    status: str(b.status),
    remark: str(b.remark)
  };
}

function validateEquipment(d) {
  const errors = [];
  if (!d.stationName) errors.push('泵站名称不能为空');
  if (!d.equipmentCode) errors.push('设备编号不能为空');
  if (d.powerKw !== '') {
    if (!/^\d+(\.\d+)?$/.test(d.powerKw)) {
      errors.push('功率必须为非负数字');
    } else if (Number(d.powerKw) > 100000) {
      errors.push('功率数值过大');
    }
  }
  if (d.commissionDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.commissionDate)) {
    errors.push('投运日期格式应为 YYYY-MM-DD');
  }
  if (d.commissionDate && isNaN(new Date(d.commissionDate).getTime())) {
    errors.push('投运日期不是有效日期');
  }
  if (d.commissionDate && new Date(d.commissionDate + 'T23:59:59') > new Date()) {
    errors.push('投运日期不能晚于今天');
  }
  if (!STATUS_LIST.includes(d.status)) {
    errors.push(`运行状态必须是：${STATUS_LIST.join(' / ')}`);
  }
  return errors;
}

function displayValue(key, value) {
  if (value === null || value === undefined || value === '') return '（空）';
  return value;
}

// 对比更新前后字段，生成变更明细
function buildDiff(before, after) {
  const keys = Object.keys(FIELD_LABELS);
  const changes = [];
  for (const key of keys) {
    const oldV = before[key] === null || before[key] === undefined ? '' : String(before[key]);
    const newV = after[key] === null || after[key] === undefined ? '' : String(after[key]);
    if (oldV !== newV) {
      changes.push(`${FIELD_LABELS[key]}：${displayValue(key, oldV)} → ${displayValue(key, newV)}`);
    }
  }
  return changes;
}

module.exports = { getOperator, normalizeBody, validateEquipment, buildDiff };
