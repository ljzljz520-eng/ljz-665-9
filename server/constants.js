// 设备运行状态枚举
const STATUS_LIST = ['运行中', '停机', '检修中', '故障'];

const FIELD_LABELS = {
  stationName: '泵站名称',
  equipmentCode: '设备编号',
  equipmentName: '设备名称',
  powerKw: '功率(kW)',
  installLocation: '安装位置',
  teamName: '责任班组',
  commissionDate: '投运日期',
  status: '运行状态',
  remark: '备注'
};

module.exports = { STATUS_LIST, FIELD_LABELS };
