'use strict';

/**
 * SQL Server 仓储：所有查询均使用参数化输入，杜绝 SQL 注入。
 * 表结构见 database/schema.sql。
 */

const { getPool, sql } = require('../db/mssql-pool');
const { RUN_STATUSES } = require('./constants');

const FIELD_MAP = {
  stationName: 'station_name',
  deviceCode: 'device_code',
  deviceName: 'device_name',
  pumpModel: 'pump_model',
  powerKw: 'power_kw',
  flowM3h: 'flow_m3h',
  headM: 'head_m',
  speedRpm: 'speed_rpm',
  voltage: 'voltage',
  currentA: 'current_a',
  manufacturer: 'manufacturer',
  installLocation: 'install_location',
  responsibleTeam: 'responsible_team',
  commissionDate: 'commission_date',
  status: 'status',
  remark: 'remark'
};

const FIELD_LABELS = {
  stationName: '泵站名称', deviceCode: '设备编号', deviceName: '设备名称',
  pumpModel: '水泵型号', powerKw: '功率(kW)', flowM3h: '流量(m³/h)',
  headM: '扬程(m)', speedRpm: '转速(r/min)', voltage: '额定电压',
  currentA: '额定电流(A)', manufacturer: '生产厂家', installLocation: '安装位置',
  responsibleTeam: '责任班组', commissionDate: '投运日期', status: '运行状态', remark: '备注'
};

function isUniqueViolation(err) {
  // 2627 = 唯一约束冲突, 2601 = 唯一索引重复键
  return err.number === 2627 || err.number === 2601;
}

function mapEquipmentRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    stationName: r.station_name,
    deviceCode: r.device_code,
    deviceName: r.device_name,
    pumpModel: r.pump_model,
    powerKw: Number(r.power_kw),
    flowM3h: r.flow_m3h != null ? Number(r.flow_m3h) : null,
    headM: r.head_m != null ? Number(r.head_m) : null,
    speedRpm: r.speed_rpm != null ? Number(r.speed_rpm) : null,
    voltage: r.voltage,
    currentA: r.current_a != null ? Number(r.current_a) : null,
    manufacturer: r.manufacturer,
    installLocation: r.install_location,
    responsibleTeam: r.responsible_team,
    commissionDate: r.commission_date
      ? new Date(r.commission_date).toISOString().slice(0, 10)
      : null,
    status: r.status,
    remark: r.remark,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString()
  };
}

function mapAttachmentRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    equipmentId: Number(r.equipment_id),
    originalName: r.original_name,
    storedName: r.stored_name,
    filePath: r.file_path,
    mimeType: r.mime_type,
    fileSize: Number(r.file_size),
    uploadedBy: r.uploaded_by,
    createdAt: new Date(r.created_at).toISOString()
  };
}

function mapLogRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    equipmentId: r.equipment_id != null ? Number(r.equipment_id) : null,
    action: r.action,
    detail: r.detail,
    operator: r.operator,
    createdAt: new Date(r.created_at).toISOString()
  };
}

// ---------------- 设备 ----------------
async function listEquipment({ keyword, stationName, status, page, pageSize }) {
  const pool = await getPool();

  const where = [];
  if (keyword) {
    where.push(`(
      device_code     LIKE @kw OR
      device_name     LIKE @kw OR
      station_name    LIKE @kw OR
      install_location LIKE @kw OR
      responsible_team LIKE @kw OR
      manufacturer    LIKE @kw OR
      pump_model      LIKE @kw OR
      remark          LIKE @kw
    )`);
  }
  if (stationName) where.push('station_name LIKE @station');
  if (status) where.push('status = @status');

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const listReq = pool.request();
  const countReq = pool.request();

  if (keyword) {
    const kw = `%${keyword}%`;
    listReq.input('kw', sql.NVarChar, kw);
    countReq.input('kw', sql.NVarChar, kw);
  }
  if (stationName) {
    const st = `%${stationName}%`;
    listReq.input('station', sql.NVarChar, st);
    countReq.input('station', sql.NVarChar, st);
  }
  if (status) {
    listReq.input('status', sql.NVarChar(10), status);
    countReq.input('status', sql.NVarChar(10), status);
  }
  listReq.input('offset', sql.Int, (page - 1) * pageSize);
  listReq.input('pageSize', sql.Int, pageSize);

  const listSql = `
    SELECT * FROM dbo.equipment
    ${whereSql}
    ORDER BY id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `;
  const countSql = `SELECT COUNT(*) AS cnt FROM dbo.equipment ${whereSql};`;

  const [listRes, countRes] = await Promise.all([
    listReq.query(listSql),
    countReq.query(countSql)
  ]);

  return {
    list: listRes.recordset.map(mapEquipmentRow),
    total: Number(countRes.recordset[0].cnt),
    page,
    pageSize
  };
}

async function getEquipmentById(id) {
  const pool = await getPool();
  const res = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM dbo.equipment WHERE id = @id;');
  return mapEquipmentRow(res.recordset[0]);
}

async function getEquipmentByCode(deviceCode) {
  const pool = await getPool();
  const res = await pool
    .request()
    .input('code', sql.NVarChar(50), deviceCode)
    .query('SELECT * FROM dbo.equipment WHERE device_code = @code;');
  return mapEquipmentRow(res.recordset[0]);
}

const NUMERIC_FIELDS = new Set(['powerKw', 'flowM3h', 'headM', 'speedRpm', 'currentA']);
const DATE_FIELDS = new Set(['commissionDate']);

async function createEquipment(data, operator) {
  const pool = await getPool();
  const req = pool.request();

  const cols = [];
  Object.keys(FIELD_MAP).forEach((key, i) => {
    const param = `p${i}`;
    cols.push(`${FIELD_MAP[key]} = @${param}`);
    let val = data[key];
    if (val === undefined || val === '') val = null;
    if (NUMERIC_FIELDS.has(key) && val != null) val = Number(val);
    if (DATE_FIELDS.has(key) && val) {
      req.input(param, sql.Date, val);
    } else {
      req.input(param, sql.NVarChar(sql.MAX), val);
    }
  });

  try {
    const res = await req.query(`
      INSERT INTO dbo.equipment (${Object.values(FIELD_MAP).join(', ')})
      OUTPUT INSERTED.*
      VALUES (${Object.keys(FIELD_MAP)
        .map((_, i) => `@p${i}`)
        .join(', ')});
    `);
    const row = mapEquipmentRow(res.recordset[0]);
    await addLog(row.id, '新建', `创建设备档案：${row.stationName} / ${row.deviceCode}`, operator);
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const e = new Error('设备编号已存在');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

async function updateEquipment(id, data, operator) {
  const pool = await getPool();

  // 先读取旧值，用于生成变更明细
  const oldRow = await getEquipmentById(id);
  if (!oldRow) return null;

  const keys = Object.keys(FIELD_MAP).filter((k) => k in data);
  const req = pool.request().input('id', sql.Int, id);

  const setParts = [];
  keys.forEach((key, i) => {
    const param = `p${i}`;
    let val = data[key];
    if (val === undefined || val === '') val = null;
    if (NUMERIC_FIELDS.has(key) && val != null) val = Number(val);
    setParts.push(`${FIELD_MAP[key]} = @${param}`);
    if (DATE_FIELDS.has(key) && val) {
      req.input(param, sql.Date, val);
    } else {
      req.input(param, sql.NVarChar(sql.MAX), val);
    }
  });

  if (setParts.length === 0) return oldRow;
  setParts.push('updated_at = SYSUTCDATETIME()');

  try {
    const res = await req.query(`
      UPDATE dbo.equipment
      SET ${setParts.join(', ')}
      OUTPUT INSERTED.*
      WHERE id = @id;
    `);
    const row = mapEquipmentRow(res.recordset[0]);
    if (!row) return null;

    const changes = [];
    keys.forEach((key) => {
      const oldVal = oldRow[key];
      const newVal = row[key];
      const a = oldVal == null ? '' : String(oldVal);
      const b = newVal == null ? '' : String(newVal);
      if (a !== b) {
        changes.push(`${FIELD_LABELS[key]}: "${a || '空'}" -> "${b || '空'}"`);
      }
    });
    if (changes.length > 0) {
      await addLog(id, '编辑', changes.join('；'), operator);
    }
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const e = new Error('设备编号已存在');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

async function deleteEquipment(id, operator) {
  const pool = await getPool();
  const oldRow = await getEquipmentById(id);
  if (!oldRow) return false;

  const tx = pool.transaction();
  await tx.begin();
  try {
    // 附件/日志通过 ON DELETE CASCADE 级联删除；若使用手动建表未加外键，
    // 下面两条删除仍可保证一致性。
    await tx
      .request()
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.attachment WHERE equipment_id = @id;');
    await tx
      .request()
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.operation_log WHERE equipment_id = @id;');
    await tx
      .request()
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.equipment WHERE id = @id;');
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  await addLog(
    null,
    '删除',
    `删除设备档案：${oldRow.stationName} / ${oldRow.deviceCode}（含附件与日志级联清理）`,
    operator
  );
  return true;
}

async function listStationNames(keyword) {
  const pool = await getPool();
  const req = pool.request();
  let where = '';
  if (keyword) {
    where = 'WHERE station_name LIKE @kw';
    req.input('kw', sql.NVarChar, `%${keyword}%`);
  }
  const res = await req.query(
    `SELECT DISTINCT station_name FROM dbo.equipment ${where} ORDER BY station_name;`
  );
  return res.recordset.map((r) => r.station_name);
}

async function statusSummary() {
  const pool = await getPool();
  const res = await pool.request().query(`
    SELECT status, COUNT(*) AS cnt
    FROM dbo.equipment
    GROUP BY status;
  `);
  const totalRes = await pool.request().query(`
    SELECT COUNT(*) AS cnt, ISNULL(SUM(power_kw), 0) AS total_power
    FROM dbo.equipment;
  `);
  const counts = {};
  res.recordset.forEach((r) => {
    counts[r.status] = Number(r.cnt);
  });
  return {
    total: Number(totalRes.recordset[0].cnt),
    totalPower: Number(totalRes.recordset[0].total_power),
    byStatus: RUN_STATUSES.map((status) => ({
      status,
      count: counts[status] || 0
    }))
  };
}

// ---------------- 附件 ----------------
async function listAttachments(equipmentId) {
  const pool = await getPool();
  const res = await pool
    .request()
    .input('id', sql.Int, equipmentId)
    .query(
      'SELECT * FROM dbo.attachment WHERE equipment_id = @id ORDER BY id DESC;'
    );
  return res.recordset.map(mapAttachmentRow);
}

async function getAttachmentById(id) {
  const pool = await getPool();
  const res = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM dbo.attachment WHERE id = @id;');
  return mapAttachmentRow(res.recordset[0]);
}

async function createAttachment(att, operator) {
  const pool = await getPool();
  const res = await pool
    .request()
    .input('equipmentId', sql.Int, att.equipmentId)
    .input('originalName', sql.NVarChar(255), att.originalName)
    .input('storedName', sql.NVarChar(255), att.storedName)
    .input('filePath', sql.NVarChar(500), att.filePath)
    .input('mimeType', sql.NVarChar(100), att.mimeType || null)
    .input('fileSize', sql.BigInt, att.fileSize)
    .input('uploadedBy', sql.NVarChar(100), att.uploadedBy || operator || 'system')
    .query(`
      INSERT INTO dbo.attachment
        (equipment_id, original_name, stored_name, file_path, mime_type, file_size, uploaded_by)
      OUTPUT INSERTED.*
      VALUES
        (@equipmentId, @originalName, @storedName, @filePath, @mimeType, @fileSize, @uploadedBy);
    `);
  const row = mapAttachmentRow(res.recordset[0]);
  await addLog(row.equipmentId, '上传附件', `上传附件：${row.originalName}（${row.fileSize} 字节）`, operator);
  return row;
}

async function deleteAttachment(id, operator) {
  const existing = await getAttachmentById(id);
  if (!existing) return null;
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM dbo.attachment WHERE id = @id;');
  await addLog(existing.equipmentId, '删除附件', `删除附件：${existing.originalName}`, operator);
  return existing;
}

// ---------------- 操作日志 ----------------
async function addLog(equipmentId, action, detail, operator) {
  const pool = await getPool();
  await pool
    .request()
    .input('equipmentId', sql.Int, equipmentId == null ? null : equipmentId)
    .input('action', sql.NVarChar(20), action)
    .input('detail', sql.NVarChar(sql.MAX), detail || '')
    .input('operator', sql.NVarChar(100), operator || 'system')
    .query(`
      INSERT INTO dbo.operation_log (equipment_id, action, detail, operator)
      VALUES (@equipmentId, @action, @detail, @operator);
    `);
}

async function listLogs(equipmentId, limit = 100) {
  const pool = await getPool();
  const req = pool.request();
  let where = '';
  if (equipmentId) {
    where = 'WHERE equipment_id = @id';
    req.input('id', sql.Int, equipmentId);
  }
  req.input('limit', sql.Int, Math.min(Math.max(limit, 1), 500));
  const res = await req.query(
    `SELECT TOP (@limit) * FROM dbo.operation_log ${where} ORDER BY id DESC;`
  );
  return res.recordset.map(mapLogRow);
}

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
