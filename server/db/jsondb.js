const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = config.dataFile;
let db = null;
let saveTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function dateStr(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    db = {
      seq: { equipment: 1, attachment: 1, log: 1 },
      equipment: [],
      attachments: [],
      logs: []
    };
  }
  db.seq = db.seq || { equipment: 1, attachment: 1, log: 1 };
  db.equipment = db.equipment || [];
  db.attachments = db.attachments || [];
  db.logs = db.logs || [];
  persist();
  return db;
}

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(), 100);
}

function normalizeEquipment(o) {
  return {
    id: o.id,
    stationName: o.stationName,
    equipmentCode: o.equipmentCode,
    equipmentName: o.equipmentName || null,
    powerKw: o.powerKw === null || o.powerKw === undefined || o.powerKw === '' ? null : Number(o.powerKw),
    installLocation: o.installLocation || null,
    teamName: o.teamName || null,
    commissionDate: dateStr(o.commissionDate),
    status: o.status,
    remark: o.remark || null,
    createdAt: o.createdAt || nowIso(),
    updatedAt: o.updatedAt || null
  };
}

async function init() {
  load();
  persist();
}

async function listEquipment({ keyword = '', status = '', page = 1, pageSize = 10 }) {
  const data = load();
  const kw = String(keyword).trim().toLowerCase();
  let rows = data.equipment.filter((e) => {
    if (status && e.status !== status) return false;
    if (kw) {
      const hay = [e.stationName, e.equipmentCode, e.equipmentName,
        e.installLocation, e.teamName].join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  rows.sort((a, b) => b.id - a.id);
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { total, list: rows.slice(start, start + pageSize).map(normalizeEquipment) };
}

async function getEquipment(id) {
  const data = load();
  const row = data.equipment.find((e) => e.id === Number(id));
  return row ? normalizeEquipment(row) : null;
}

async function getEquipmentByCode(code, excludeId = null) {
  const data = load();
  const row = data.equipment.find(
    (e) => e.equipmentCode === code && (!excludeId || e.id !== Number(excludeId))
  );
  return row ? normalizeEquipment(row) : null;
}

async function createEquipment(d) {
  const data = load();
  const id = data.seq.equipment++;
  const row = {
    id,
    stationName: d.stationName,
    equipmentCode: d.equipmentCode,
    equipmentName: d.equipmentName || null,
    powerKw: d.powerKw === '' || d.powerKw === null ? null : Number(d.powerKw),
    installLocation: d.installLocation || null,
    teamName: d.teamName || null,
    commissionDate: d.commissionDate || null,
    status: d.status,
    remark: d.remark || null,
    createdAt: nowIso(),
    updatedAt: null
  };
  data.equipment.push(row);
  persist();
  return normalizeEquipment(row);
}

async function updateEquipment(id, d) {
  const data = load();
  const row = data.equipment.find((e) => e.id === Number(id));
  if (!row) return null;
  Object.assign(row, {
    stationName: d.stationName,
    equipmentCode: d.equipmentCode,
    equipmentName: d.equipmentName || null,
    powerKw: d.powerKw === '' || d.powerKw === null ? null : Number(d.powerKw),
    installLocation: d.installLocation || null,
    teamName: d.teamName || null,
    commissionDate: d.commissionDate || null,
    status: d.status,
    remark: d.remark || null,
    updatedAt: nowIso()
  });
  persist();
  return normalizeEquipment(row);
}

async function deleteEquipment(id) {
  const data = load();
  data.equipment = data.equipment.filter((e) => e.id !== Number(id));
  data.attachments = data.attachments.filter((a) => a.equipmentId !== Number(id));
  data.logs.forEach((l) => { if (l.equipmentId === Number(id)) l.equipmentId = null; });
  persist();
}

async function listAttachments(equipmentId) {
  const data = load();
  return data.attachments
    .filter((a) => a.equipmentId === Number(equipmentId))
    .sort((a, b) => b.id - a.id);
}

async function createAttachment(equipmentId, a) {
  const data = load();
  const row = {
    id: data.seq.attachment++,
    equipmentId: Number(equipmentId),
    originalName: a.originalName,
    storedName: a.storedName,
    size: a.size,
    mimeType: a.mimeType || null,
    uploadedBy: a.uploadedBy || null,
    createdAt: nowIso()
  };
  data.attachments.push(row);
  persist();
  return row;
}

async function getAttachment(id) {
  const data = load();
  return data.attachments.find((a) => a.id === Number(id)) || null;
}

async function deleteAttachment(id) {
  const data = load();
  const row = data.attachments.find((a) => a.id === Number(id));
  if (!row) return null;
  data.attachments = data.attachments.filter((a) => a.id !== Number(id));
  persist();
  return row.storedName;
}

async function addLog(entry) {
  const data = load();
  data.logs.push({
    id: data.seq.log++,
    equipmentId: entry.equipmentId ? Number(entry.equipmentId) : null,
    action: entry.action,
    detail: entry.detail || null,
    operator: entry.operator || null,
    createdAt: nowIso()
  });
  persist();
}

async function listLogs({ equipmentId = null, page = 1, pageSize = 10 }) {
  const data = load();
  let rows = data.logs;
  if (equipmentId) rows = rows.filter((l) => l.equipmentId === Number(equipmentId));
  rows = rows.slice().sort((a, b) => b.id - a.id);
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { total, list: rows.slice(start, start + pageSize) };
}

async function count() {
  return load().equipment.length;
}

async function close() {
  if (db) persist();
}

module.exports = {
  init, listEquipment, getEquipment, getEquipmentByCode, createEquipment,
  updateEquipment, deleteEquipment, listAttachments, createAttachment,
  getAttachment, deleteAttachment, addLog, listLogs, count, close
};
