const sql = require('mssql');
const config = require('../config');

let poolPromise = null;
let pool = null;

function buildConfig() {
  const c = config.mssql;
  const cfg = {
    user: c.user,
    password: c.password,
    server: c.server,
    database: c.database,
    connectionTimeout: c.connectionTimeout,
    requestTimeout: c.requestTimeout,
    pool: { max: c.poolMax, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      enableArithAbort: true
    }
  };
  // 命名实例与端口互斥：配置实例名时走 SQL Browser 解析，不再指定端口
  if (c.instanceName) {
    cfg.options.instanceName = c.instanceName;
  } else if (c.port) {
    cfg.port = c.port;
  }
  return cfg;
}

async function getPool() {
  if (pool && pool.connected) return pool;
  if (!poolPromise) {
    pool = new sql.ConnectionPool(buildConfig());
    pool.on('error', (err) => {
      console.error('[mssql] 连接池错误:', err.message);
    });
    poolPromise = pool.connect();
  }
  try {
    await poolPromise;
    return pool;
  } catch (err) {
    poolPromise = null;
    pool = null;
    throw err;
  }
}

async function query(fn) {
  const p = await getPool();
  const req = p.request();
  return fn(req, sql);
}

// 数据库初始化（建表/补列），幂等
async function init() {
  await query(async (r, T) => {
    await r.query(`
      IF OBJECT_ID('dbo.Equipment', 'U') IS NULL
      CREATE TABLE dbo.Equipment (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Equipment PRIMARY KEY,
        StationName NVARCHAR(100) NOT NULL,
        EquipmentCode NVARCHAR(50) NOT NULL CONSTRAINT UQ_Equipment_Code UNIQUE,
        EquipmentName NVARCHAR(100) NULL,
        PowerKw DECIMAL(12,2) NULL,
        InstallLocation NVARCHAR(200) NULL,
        TeamName NVARCHAR(50) NULL,
        CommissionDate DATE NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Equipment_Status DEFAULT N'运行中',
        Remark NVARCHAR(1000) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Equipment_Created DEFAULT SYSDATETIME(),
        UpdatedAt DATETIME2 NULL
      );
    `);
    await r.query(`
      IF OBJECT_ID('dbo.Attachment', 'U') IS NULL
      CREATE TABLE dbo.Attachment (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Attachment PRIMARY KEY,
        EquipmentId INT NOT NULL
          CONSTRAINT FK_Attachment_Equipment FOREIGN KEY REFERENCES dbo.Equipment(Id) ON DELETE CASCADE,
        OriginalName NVARCHAR(255) NOT NULL,
        StoredName NVARCHAR(255) NOT NULL,
        Size BIGINT NOT NULL,
        MimeType NVARCHAR(200) NULL,
        UploadedBy NVARCHAR(50) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Attachment_Created DEFAULT SYSDATETIME()
      );
    `);
    await r.query(`
      IF OBJECT_ID('dbo.OperationLog', 'U') IS NULL
      CREATE TABLE dbo.OperationLog (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OperationLog PRIMARY KEY,
        EquipmentId INT NULL,
        Action NVARCHAR(20) NOT NULL,
        Detail NVARCHAR(MAX) NULL,
        Operator NVARCHAR(50) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Log_Created DEFAULT SYSDATETIME()
      );
    `);
    await r.query(`
      IF COL_LENGTH('dbo.OperationLog','EquipmentId') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Log_Equipment'
      )
      ALTER TABLE dbo.OperationLog
        ADD CONSTRAINT FK_Log_Equipment FOREIGN KEY (EquipmentId)
        REFERENCES dbo.Equipment(Id) ON DELETE SET NULL;
    `);
    await r.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Attachment_Equipment')
      CREATE INDEX IX_Attachment_Equipment ON dbo.Attachment(EquipmentId);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Log_Equipment')
      CREATE INDEX IX_Log_Equipment ON dbo.OperationLog(EquipmentId);
    `);
  });
}

function dateStr(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapEquipment(row) {
  if (!row) return null;
  return {
    id: row.Id,
    stationName: row.StationName,
    equipmentCode: row.EquipmentCode,
    equipmentName: row.EquipmentName,
    powerKw: row.PowerKw === null || row.PowerKw === undefined ? null : Number(row.PowerKw),
    installLocation: row.InstallLocation,
    teamName: row.TeamName,
    commissionDate: dateStr(row.CommissionDate),
    status: row.Status,
    remark: row.Remark,
    createdAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : null,
    updatedAt: row.UpdatedAt ? new Date(row.UpdatedAt).toISOString() : null
  };
}

function mapAttachment(row) {
  return {
    id: row.Id,
    equipmentId: row.EquipmentId,
    originalName: row.OriginalName,
    storedName: row.StoredName,
    size: Number(row.Size),
    mimeType: row.MimeType,
    uploadedBy: row.UploadedBy,
    createdAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : null
  };
}

function mapLog(row) {
  return {
    id: row.Id,
    equipmentId: row.EquipmentId,
    action: row.Action,
    detail: row.Detail,
    operator: row.Operator,
    createdAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : null
  };
}

async function listEquipment({ keyword = '', status = '', page = 1, pageSize = 10 }) {
  const conds = [];
  if (keyword) {
    conds.push(`(StationName LIKE @kw OR EquipmentCode LIKE @kw OR EquipmentName LIKE @kw
                OR InstallLocation LIKE @kw OR TeamName LIKE @kw)`);
  }
  if (status) conds.push(`Status = @status`);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return query(async (r) => {
    if (keyword) r.input('kw', sql.NVarChar, `%${keyword}%`);
    if (status) r.input('status', sql.NVarChar, status);
    const countRes = await r.query(`SELECT COUNT(*) AS Cnt FROM dbo.Equipment ${where}`);
    const total = countRes.recordset[0].Cnt;

    const offset = (page - 1) * pageSize;
    r.input('offset', sql.Int, offset);
    r.input('take', sql.Int, pageSize);
    const listRes = await r.query(`
      SELECT * FROM dbo.Equipment ${where}
      ORDER BY Id DESC
      OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY;
    `);
    return { total, list: listRes.recordset.map(mapEquipment) };
  });
}

async function getEquipment(id) {
  return query(async (r) => {
    r.input('id', sql.Int, id);
    const res = await r.query('SELECT TOP 1 * FROM dbo.Equipment WHERE Id = @id');
    return mapEquipment(res.recordset[0]);
  });
}

async function getEquipmentByCode(code, excludeId = null) {
  return query(async (r) => {
    r.input('code', sql.NVarChar, code);
    let sqlText = 'SELECT TOP 1 * FROM dbo.Equipment WHERE EquipmentCode = @code';
    if (excludeId) {
      r.input('excludeId', sql.Int, excludeId);
      sqlText += ' AND Id <> @excludeId';
    }
    const res = await r.query(sqlText);
    return mapEquipment(res.recordset[0]);
  });
}

async function createEquipment(d, operator) {
  return query(async (r) => {
    r.input('stationName', sql.NVarChar, d.stationName)
      .input('equipmentCode', sql.NVarChar, d.equipmentCode)
      .input('equipmentName', sql.NVarChar, d.equipmentName || null)
      .input('powerKw', sql.Decimal(12, 2), d.powerKw === null || d.powerKw === '' ? null : Number(d.powerKw))
      .input('installLocation', sql.NVarChar, d.installLocation || null)
      .input('teamName', sql.NVarChar, d.teamName || null)
      .input('commissionDate', sql.Date, d.commissionDate || null)
      .input('status', sql.NVarChar, d.status)
      .input('remark', sql.NVarChar, d.remark || null);
    const res = await r.query(`
      INSERT INTO dbo.Equipment
        (StationName, EquipmentCode, EquipmentName, PowerKw, InstallLocation,
         TeamName, CommissionDate, Status, Remark)
      VALUES
        (@stationName, @equipmentCode, @equipmentName, @powerKw, @installLocation,
         @teamName, @commissionDate, @status, @remark);
      SELECT SCOPE_IDENTITY() AS Id;
    `);
    return getEquipment(res.recordset[0].Id);
  });
}

async function updateEquipment(id, d) {
  return query(async (r) => {
    r.input('id', sql.Int, id)
      .input('stationName', sql.NVarChar, d.stationName)
      .input('equipmentCode', sql.NVarChar, d.equipmentCode)
      .input('equipmentName', sql.NVarChar, d.equipmentName || null)
      .input('powerKw', sql.Decimal(12, 2), d.powerKw === null || d.powerKw === '' ? null : Number(d.powerKw))
      .input('installLocation', sql.NVarChar, d.installLocation || null)
      .input('teamName', sql.NVarChar, d.teamName || null)
      .input('commissionDate', sql.Date, d.commissionDate || null)
      .input('status', sql.NVarChar, d.status)
      .input('remark', sql.NVarChar, d.remark || null);
    await r.query(`
      UPDATE dbo.Equipment SET
        StationName = @stationName,
        EquipmentCode = @equipmentCode,
        EquipmentName = @equipmentName,
        PowerKw = @powerKw,
        InstallLocation = @installLocation,
        TeamName = @teamName,
        CommissionDate = @commissionDate,
        Status = @status,
        Remark = @remark,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id;
    `);
    return getEquipment(id);
  });
}

async function deleteEquipment(id) {
  return query(async (r) => {
    r.input('id', sql.Int, id);
    // 附件随外键级联删除；日志置空 EquipmentId 后补充删除标记
    await r.query(`
      UPDATE dbo.OperationLog SET EquipmentId = NULL WHERE EquipmentId = @id;
      DELETE FROM dbo.Equipment WHERE Id = @id;
    `);
  });
}

async function listAttachments(equipmentId) {
  return query(async (r) => {
    r.input('id', sql.Int, equipmentId);
    const res = await r.query(
      'SELECT * FROM dbo.Attachment WHERE EquipmentId = @id ORDER BY Id DESC'
    );
    return res.recordset.map(mapAttachment);
  });
}

async function createAttachment(equipmentId, a) {
  return query(async (r) => {
    r.input('equipmentId', sql.Int, equipmentId)
      .input('originalName', sql.NVarChar, a.originalName)
      .input('storedName', sql.NVarChar, a.storedName)
      .input('size', sql.BigInt, a.size)
      .input('mimeType', sql.NVarChar, a.mimeType || null)
      .input('uploadedBy', sql.NVarChar, a.uploadedBy || null);
    const res = await r.query(`
      INSERT INTO dbo.Attachment
        (EquipmentId, OriginalName, StoredName, Size, MimeType, UploadedBy)
      VALUES (@equipmentId, @originalName, @storedName, @size, @mimeType, @uploadedBy);
      SELECT SCOPE_IDENTITY() AS Id;
    `);
    const id = res.recordset[0].Id;
    r.input('aid', sql.Int, id);
    const got = await r.query('SELECT TOP 1 * FROM dbo.Attachment WHERE Id = @aid');
    return mapAttachment(got.recordset[0]);
  });
}

async function getAttachment(id) {
  return query(async (r) => {
    r.input('id', sql.Int, id);
    const res = await r.query('SELECT TOP 1 * FROM dbo.Attachment WHERE Id = @id');
    return mapAttachment(res.recordset[0]);
  });
}

async function deleteAttachment(id) {
  return query(async (r) => {
    r.input('id', sql.Int, id);
    const res = await r.query(
      'DELETE FROM dbo.Attachment OUTPUT DELETED.StoredName WHERE Id = @id'
    );
    return res.recordset[0] ? res.recordset[0].StoredName : null;
  });
}

async function addLog(entry) {
  return query(async (r) => {
    r.input('equipmentId', sql.Int, entry.equipmentId || null)
      .input('action', sql.NVarChar, entry.action)
      .input('detail', sql.NVarChar(sql.MAX), entry.detail || null)
      .input('operator', sql.NVarChar, entry.operator || null);
    await r.query(`
      INSERT INTO dbo.OperationLog (EquipmentId, Action, Detail, Operator)
      VALUES (@equipmentId, @action, @detail, @operator);
    `);
  });
}

async function listLogs({ equipmentId = null, page = 1, pageSize = 10 }) {
  return query(async (r) => {
    let where = '';
    if (equipmentId) {
      where = 'WHERE EquipmentId = @id';
      r.input('id', sql.Int, equipmentId);
    }
    const countRes = await r.query(`SELECT COUNT(*) AS Cnt FROM dbo.OperationLog ${where}`);
    const total = countRes.recordset[0].Cnt;
    const offset = (page - 1) * pageSize;
    r.input('offset', sql.Int, offset);
    r.input('take', sql.Int, pageSize);
    const res = await r.query(`
      SELECT * FROM dbo.OperationLog ${where}
      ORDER BY Id DESC
      OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY;
    `);
    return { total, list: res.recordset.map(mapLog) };
  });
}

async function count() {
  const { total } = await listEquipment({ page: 1, pageSize: 1 });
  return total;
}

async function close() {
  if (pool) {
    await pool.close();
    pool = null;
    poolPromise = null;
  }
}

module.exports = {
  init, listEquipment, getEquipment, getEquipmentByCode, createEquipment,
  updateEquipment, deleteEquipment, listAttachments, createAttachment,
  getAttachment, deleteAttachment, addLog, listLogs, count, close
};
