'use strict';

/**
 * 内存仓储：接口与 mssql-repo 完全一致。
 * 无需数据库即可运行，用于演示、前端联调与冒烟测试。重启后数据重置。
 */

const { RUN_STATUSES } = require('./constants');

const equipment = new Map();
const attachments = new Map();
const logs = new Map();

let eqSeq = 1;
let attSeq = 1;
let logSeq = 1;

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

// ---------------- 初始化演示数据 ----------------
function seed() {
  const samples = [
    { stationName: '一厂取水泵站', deviceCode: 'PS1-QSB-001', deviceName: '1#取水泵', pumpModel: 'KQSN300-N9', powerKw: 220.0, flowM3h: 1200, headM: 45, speedRpm: 1480, voltage: '10kV', currentA: 16.2, manufacturer: '上海凯泉泵业', installLocation: '一厂取水泵房-1#机位', responsibleTeam: '取水班组', commissionDate: '2018-06-18', status: '运行', remark: '主用泵，每月巡检一次' },
    { stationName: '一厂取水泵站', deviceCode: 'PS1-QSB-002', deviceName: '2#取水泵', pumpModel: 'KQSN300-N9', powerKw: 220.0, flowM3h: 1200, headM: 45, speedRpm: 1480, voltage: '10kV', currentA: 16.5, manufacturer: '上海凯泉泵业', installLocation: '一厂取水泵房-2#机位', responsibleTeam: '取水班组', commissionDate: '2018-06-18', status: '备用', remark: '备用轮换泵' },
    { stationName: '一厂送水泵站', deviceCode: 'PS1-SSB-101', deviceName: '1#送水泵', pumpModel: 'KQSN500-N18', powerKw: 560.0, flowM3h: 3200, headM: 68, speedRpm: 990, voltage: '10kV', currentA: 39.8, manufacturer: '上海凯泉泵业', installLocation: '一厂送水泵房-1#机位', responsibleTeam: '送水班组', commissionDate: '2019-03-25', status: '运行', remark: '变频控制' },
    { stationName: '一厂送水泵站', deviceCode: 'PS1-SSB-102', deviceName: '2#送水泵', pumpModel: 'KQSN500-N18', powerKw: 560.0, flowM3h: 3200, headM: 68, speedRpm: 990, voltage: '10kV', currentA: null, manufacturer: '上海凯泉泵业', installLocation: '一厂送水泵房-2#机位', responsibleTeam: '送水班组', commissionDate: '2019-03-25', status: '检修', remark: '轴承更换中，预计3天' },
    { stationName: '二厂取水泵站', deviceCode: 'PS2-QSB-001', deviceName: '1#源水泵', pumpModel: 'SA250-13', powerKw: 160.0, flowM3h: 900, headM: 38, speedRpm: 1480, voltage: '380V', currentA: 285, manufacturer: '长沙水泵厂', installLocation: '二厂取水泵房-1#机位', responsibleTeam: '取水班组', commissionDate: '2021-09-10', status: '运行', remark: '' },
    { stationName: '二厂送水泵站', deviceCode: 'PS2-SSB-001', deviceName: '1#出厂泵', pumpModel: 'SAP200-52', powerKw: 315.0, flowM3h: 1800, headM: 55, speedRpm: 1480, voltage: '10kV', currentA: 22.6, manufacturer: '大连深蓝泵业', installLocation: '二厂送水泵房-1#机位', responsibleTeam: '送水班组', commissionDate: '2021-11-02', status: '运行', remark: '' },
    { stationName: '南部分压泵站', deviceCode: 'PSN-BY-003', deviceName: '3#增压泵', pumpModel: 'ISG150-315', powerKw: 75.0, flowM3h: 320, headM: 72, speedRpm: 2900, voltage: '380V', currentA: 138, manufacturer: '连成泵业', installLocation: '南部泵站机房-3#机位', responsibleTeam: '管网班组', commissionDate: '2022-05-20', status: '运行', remark: '夜间低谷停机' },
    { stationName: '南部分压泵站', deviceCode: 'PSN-BY-004', deviceName: '4#增压泵', pumpModel: 'ISG150-315', powerKw: 75.0, flowM3h: 320, headM: 72, speedRpm: 2900, voltage: '380V', currentA: null, manufacturer: '连成泵业', installLocation: '南部泵站机房-4#机位', responsibleTeam: '管网班组', commissionDate: '2022-05-20', status: '停用', remark: '待报废评估，长期停用' },
    { stationName: '中水回用泵站', deviceCode: 'PSZ-HY-001', deviceName: '1#回用水泵', pumpModel: 'WQ200-20', powerKw: 45.0, flowM3h: 260, headM: 22, speedRpm: 980, voltage: '380V', currentA: 86, manufacturer: '南方泵业', installLocation: '中水泵房-1#机位', responsibleTeam: '中水班组', commissionDate: '2023-08-15', status: '运行', remark: '潜污泵，带耦合装置' },
    { stationName: '一厂排泥泵站', deviceCode: 'PS1-PN-002', deviceName: '2#排泥泵', pumpModel: 'WQ100-15', powerKw: 18.5, flowM3h: 110, headM: 15, speedRpm: 1450, voltage: '380V', currentA: 36, manufacturer: '南方泵业', installLocation: '沉淀池排泥泵房-2#机位', responsibleTeam: '净水班组', commissionDate: '2020-12-08', status: '备用', remark: '' }
  ];

  samples.forEach((s) => {
    const id = eqSeq++;
    equipment.set(id, {
      id,
      ...s,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    addLogSync(id, '新建', '系统初始化演示数据', 'seed-script');
  });
}

function addLogSync(equipmentId, action, detail, operator) {
  const log = {
    id: logSeq++,
    equipmentId: equipmentId || null,
    action,
    detail: detail || '',
    operator: operator || 'system',
    createdAt: nowIso()
  };
  logs.set(log.id, log);
  return log;
}

// 简易中文/拼音无关的包含匹配（输入小写后比较）
function contains(haystack, needle) {
  if (haystack == null) return false;
  return String(haystack).toLowerCase().includes(needle);
}

// ---------------- 设备档案 ----------------
async function listEquipment({ keyword, stationName, status, page, pageSize }) {
  let rows = Array.from(equipment.values());

  if (keyword) {
    const kw = keyword.toLowerCase();
    rows = rows.filter(
      (r) =>
        contains(r.deviceCode, kw) ||
        contains(r.deviceName, kw) ||
        contains(r.stationName, kw) ||
        contains(r.installLocation, kw) ||
        contains(r.responsibleTeam, kw) ||
        contains(r.manufacturer, kw) ||
        contains(r.pumpModel, kw) ||
        contains(r.remark, kw)
    );
  }
  if (stationName) {
    const q = stationName.toLowerCase();
    rows = rows.filter((r) => contains(r.stationName, q));
  }
  if (status) {
    rows = rows.filter((r) => r.status === status);
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const list = rows
    .sort((a, b) => b.id - a.id)
    .slice(start, start + pageSize)
    .map((r) => ({ ...r }));

  return { list, total, page, pageSize };
}

async function getEquipmentById(id) {
  const row = equipment.get(id);
  return row ? clone(row) : null;
}

async function getEquipmentByCode(deviceCode) {
  const code = String(deviceCode).toLowerCase();
  for (const row of equipment.values()) {
    if (row.deviceCode.toLowerCase() === code) return clone(row);
  }
  return null;
}

async function createEquipment(data, operator) {
  const id = eqSeq++;
  const ts = nowIso();
  const row = {
    id,
    stationName: data.stationName,
    deviceCode: data.deviceCode,
    deviceName: data.deviceName,
    pumpModel: data.pumpModel || null,
    powerKw: data.powerKw,
    flowM3h: data.flowM3h ?? null,
    headM: data.headM ?? null,
    speedRpm: data.speedRpm ?? null,
    voltage: data.voltage || null,
    currentA: data.currentA ?? null,
    manufacturer: data.manufacturer || null,
    installLocation: data.installLocation,
    responsibleTeam: data.responsibleTeam,
    commissionDate: data.commissionDate || null,
    status: data.status,
    remark: data.remark || null,
    createdAt: ts,
    updatedAt: ts
  };
  equipment.set(id, row);
  addLogSync(id, '新建', `创建设备档案：${row.stationName} / ${row.deviceCode}`, operator);
  return clone(row);
}

async function updateEquipment(id, data, operator) {
  const existing = equipment.get(id);
  if (!existing) return null;

  const changes = [];
  const fieldLabels = {
    stationName: '泵站名称', deviceCode: '设备编号', deviceName: '设备名称',
    pumpModel: '水泵型号', powerKw: '功率(kW)', flowM3h: '流量(m³/h)',
    headM: '扬程(m)', speedRpm: '转速(r/min)', voltage: '额定电压',
    currentA: '额定电流(A)', manufacturer: '生产厂家', installLocation: '安装位置',
    responsibleTeam: '责任班组', commissionDate: '投运日期', status: '运行状态', remark: '备注'
  };

  for (const key of Object.keys(fieldLabels)) {
    if (!(key in data)) continue;
    const oldVal = existing[key];
    const newVal = data[key] === undefined ? null : data[key];
    const a = oldVal == null ? '' : String(oldVal);
    const b = newVal == null ? '' : String(newVal);
    if (a !== b) {
      changes.push(`${fieldLabels[key]}: "${a || '空'}" -> "${b || '空'}"`);
      existing[key] = newVal;
    }
  }

  existing.updatedAt = nowIso();

  if (changes.length > 0) {
    addLogSync(id, '编辑', changes.join('；'), operator);
  }
  return clone(existing);
}

async function deleteEquipment(id, operator) {
  const existing = equipment.get(id);
  if (!existing) return false;
  equipment.delete(id);
  for (const [aid, att] of attachments) {
    if (att.equipmentId === id) attachments.delete(aid);
  }
  addLogSync(
    null,
    '删除',
    `删除设备档案：${existing.stationName} / ${existing.deviceCode}（含附件与日志级联清理）`,
    operator
  );
  return true;
}

async function listStationNames(keyword) {
  const set = new Set();
  for (const row of equipment.values()) set.add(row.stationName);
  let names = Array.from(set).sort();
  if (keyword) {
    const q = keyword.toLowerCase();
    names = names.filter((n) => contains(n, q));
  }
  return names;
}

async function statusSummary() {
  const summary = RUN_STATUSES.map((status) => ({ status, count: 0 }));
  let totalPower = 0;
  let total = 0;
  for (const row of equipment.values()) {
    total += 1;
    totalPower += Number(row.powerKw) || 0;
    const item = summary.find((s) => s.status === row.status);
    if (item) item.count += 1;
  }
  return { total, totalPower: Math.round(totalPower * 100) / 100, byStatus: summary };
}

// ---------------- 附件 ----------------
async function listAttachments(equipmentId) {
  return Array.from(attachments.values())
    .filter((a) => a.equipmentId === equipmentId)
    .sort((a, b) => b.id - a.id)
    .map(clone);
}

async function getAttachmentById(id) {
  const row = attachments.get(id);
  return row ? clone(row) : null;
}

async function createAttachment(att, operator) {
  const row = { id: attSeq++, createdAt: nowIso(), ...att };
  attachments.set(row.id, row);
  addLogSync(
    row.equipmentId,
    '上传附件',
    `上传附件：${row.originalName}（${row.fileSize} 字节）`,
    operator
  );
  return clone(row);
}

async function deleteAttachment(id, operator) {
  const existing = attachments.get(id);
  if (!existing) return null;
  attachments.delete(id);
  addLogSync(
    existing.equipmentId,
    '删除附件',
    `删除附件：${existing.originalName}`,
    operator
  );
  return clone(existing);
}

// ---------------- 操作日志 ----------------
async function listLogs(equipmentId, limit = 100) {
  return Array.from(logs.values())
    .filter((l) => (equipmentId ? l.equipmentId === equipmentId : true))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .map(clone);
}

seed();

module.exports = {
  listEquipment,
  getEquipmentById,
  getEquipmentByCode,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  listStationNames,
  statusSummary,
  listAttachments,
  getAttachmentById,
  createAttachment,
  deleteAttachment,
  listLogs
};
