// Instance Monitoring — historique + temps réel + CPU cores + Disk I/O
// Author: Oussama Zaied - ESPRIT

import React, { Component } from 'react';
import { inject, observer } from 'mobx-react';
import { Card, Row, Col, Statistic, Spin, Alert, Radio } from 'antd';
import { Chart, Line, Axis, Tooltip } from 'bizcharts';
import styles from './index.less';

const COLOR = {
  primary:     '#0c63fa',
  success:     '#1890ff',
  warning:     '#f5a623',
  danger:      '#ca2621',
  purple:      '#5f708a',
  textTitle:   'rgba(0,0,0,0.85)',
  textBody:    'rgba(0,0,0,0.65)',
  textCaption: 'rgba(0,0,0,0.45)',
  border:      '#ccd3db',
  bg:          '#f0f1f7',
  bgCard:      '#ffffff',
};

function formatTime(ts, period) {
  const d = new Date(ts * 1000);
  if (period === '24h')
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

const CpuCores = ({ vcpus, cpuPercent }) => {
  const perCore = cpuPercent / vcpus;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: COLOR.textCaption, marginBottom: 6 }}>
        {vcpus} vCPU{vcpus > 1 ? 's' : ''} — {cpuPercent.toFixed(1)}% total
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Array.from({ length: vcpus }).map((_, i) => {
          const pct = Math.min(perCore, 100);
          const color = pct > 80 ? COLOR.danger : pct > 50 ? COLOR.warning : COLOR.primary;
          return (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 4, background: COLOR.bg, border: `1.5px solid ${COLOR.border}`, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${pct}%`, background: color, opacity: 0.85, transition: 'height 0.5s ease' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 9, fontWeight: 600, color: pct > 40 ? '#fff' : COLOR.textBody, zIndex: 1 }}>
                  {pct.toFixed(0)}%
                </div>
              </div>
              <div style={{ fontSize: 9, color: COLOR.textCaption, marginTop: 2 }}>vCPU{i}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MiniChart = ({ data, color, height = 180, maxY }) => {
  if (!data || !data.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLOR.textCaption, fontSize: 13 }}>
      {t('No data available')}
    </div>
  );
  return (
    <Chart height={height} data={data} autoFit padding={[10, 20, 50, 40]}>
      <Axis name="time" label={{ style: { fontSize: 10, fill: COLOR.textCaption }, autoRotate: true }} tickCount={6} />
      <Axis name="value" min={0} max={maxY} label={{ style: { fontSize: 10, fill: COLOR.textCaption } }} />
      <Tooltip showCrosshairs />
      <Line position="time*value" color={color} size={1.5} smooth />
    </Chart>
  );
};

const DualChart = ({ data1, data2, label1, label2, color1, color2, height = 180 }) => {
  const merged = [
    ...(data1 || []).map(p => ({ ...p, type: label1 })),
    ...(data2 || []).map(p => ({ ...p, type: label2 })),
  ];
  if (!merged.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLOR.textCaption, fontSize: 13 }}>
      {t('No data available')}
    </div>
  );
  return (
    <Chart height={height} data={merged} autoFit padding={[10, 40, 50, 40]}>
      <Axis name="time" label={{ style: { fontSize: 10, fill: COLOR.textCaption }, autoRotate: true }} tickCount={6} />
      <Axis name="value" min={0} label={{ style: { fontSize: 10, fill: COLOR.textCaption } }} />
      <Tooltip showCrosshairs shared />
      <Line position="time*value" color={['type', [color1, color2]]} size={1.5} smooth />
    </Chart>
  );
};

const Legend = ({ items }) => (
  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: COLOR.textCaption }}>
    {items.map(({ color, label }) => (
      <span key={label}>
        <span style={{ display: 'inline-block', width: 14, height: 3, background: color, marginRight: 5, verticalAlign: 'middle', borderRadius: 2 }} />
        {label}
      </span>
    ))}
  </div>
);

@inject('rootStore')
@observer
export default class Monitoring extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true, error: null, metrics: null, history: null,
      period: '1h', loadingHistory: false,
      realtimeCpu: [], realtimeMem: [],
      realtimeNetRx: [], realtimeNetTx: [],
      realtimeDiskRead: [], realtimeDiskWrite: [],
    };
    this.refreshInterval = null;
  }

  componentDidMount() {
    this.fetchRealtime();
    this.fetchHistory('1h');
    this.refreshInterval = setInterval(this.fetchRealtime, 5000);
  }

  componentWillUnmount() { clearInterval(this.refreshInterval); }

  get instanceId() { return this.props.detail?.id; }

  fetchRealtime = async () => {
    try {
      const response = await fetch(`/api/openstack/skyline/api/v1/instances/${this.instanceId}/metrics`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const now = new Date();
      const ts = Math.floor(now.getTime() / 1000);
      const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      this.setState(prev => ({
        loading: false, error: null, metrics: data,
        realtimeCpu:       [...prev.realtimeCpu.slice(-59),       { time: timeStr, value: data.cpu_percent, ts }],
        realtimeMem:       [...prev.realtimeMem.slice(-59),       { time: timeStr, value: data.memory_mb, ts }],
        realtimeNetRx:     [...prev.realtimeNetRx.slice(-59),     { time: timeStr, value: parseFloat((data.network_rx_bytes_per_sec / 1024).toFixed(2)), ts }],
        realtimeNetTx:     [...prev.realtimeNetTx.slice(-59),     { time: timeStr, value: parseFloat((data.network_tx_bytes_per_sec / 1024).toFixed(2)), ts }],
        realtimeDiskRead:  [...prev.realtimeDiskRead.slice(-59),  { time: timeStr, value: parseFloat((data.disk_read_bytes_per_sec / 1024).toFixed(2)), ts }],
        realtimeDiskWrite: [...prev.realtimeDiskWrite.slice(-59), { time: timeStr, value: parseFloat((data.disk_write_bytes_per_sec / 1024).toFixed(2)), ts }],
      }));
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  };

  fetchHistory = async (period) => {
    this.setState({ loadingHistory: true });
    try {
      const response = await fetch(`/api/openstack/skyline/api/v1/instance-history/${this.instanceId}?period=${period}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.setState({ history: data, loadingHistory: false, period });
    } catch (err) {
      this.setState({ loadingHistory: false });
    }
  };

  onPeriodChange = (e) => this.fetchHistory(e.target.value);

  mergeData(historyPoints, realtimePoints, period) {
    if (!historyPoints || !historyPoints.length)
      return realtimePoints.map(p => ({ time: p.time, value: p.value }));
    const histFormatted = historyPoints.map(p => ({ time: formatTime(p.time, period), value: p.value, ts: p.time }));
    const lastHistTs = historyPoints[historyPoints.length - 1]?.time || 0;
    const newRealtime = realtimePoints.filter(p => p.ts > lastHistTs).map(p => ({ time: p.time, value: p.value, ts: p.ts }));
    return [...histFormatted, ...newRealtime];
  }

  render() {
    const { loading, error, metrics, history, period, loadingHistory,
            realtimeCpu, realtimeMem, realtimeNetRx, realtimeNetTx,
            realtimeDiskRead, realtimeDiskWrite } = this.state;
    const { detail } = this.props;

    if (loading && !metrics) return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 12, color: COLOR.textCaption, fontSize: 13 }}>{t('Loading metrics...')}</div>
      </div>
    );

    if (error) return <Alert message={t('Error Loading Metrics')} description={error} type="error" showIcon style={{ margin: 24 }} />;

    const vcpus         = history?.vcpus || 1;
    const diskCapGb     = history?.disk_capacity_gb || 0;
    const cpuData       = this.mergeData(history?.cpu,              realtimeCpu,       period);
    const memData       = this.mergeData(history?.memory_mb,        realtimeMem,       period);
    const netRxData     = this.mergeData(history?.network_rx_kbps,  realtimeNetRx,     period);
    const netTxData     = this.mergeData(history?.network_tx_kbps,  realtimeNetTx,     period);
    const diskReadData  = this.mergeData(history?.disk_read_kbps,   realtimeDiskRead,  period);
    const diskWriteData = this.mergeData(history?.disk_write_kbps,  realtimeDiskWrite, period);
    const periodLabel   = { '1h': t('Last 1h'), '6h': t('Last 6h'), '24h': t('Last 24h') };

    return (
      <div className={styles.monitoring}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: COLOR.textTitle }}>{t('Instance Monitoring')} — {detail?.name}</div>
            <div style={{ fontSize: 12, color: COLOR.textCaption, marginTop: 2 }}>{history?.domain} · {t('Auto-refresh every 5s')}</div>
          </div>
          <Radio.Group value={period} onChange={this.onPeriodChange} size="small" buttonStyle="solid">
            <Radio.Button value="1h">1h</Radio.Button>
            <Radio.Button value="6h">6h</Radio.Button>
            <Radio.Button value="24h">24h</Radio.Button>
          </Radio.Group>
        </div>

        {metrics && (
          <Row gutter={16} style={{ marginBottom: 20 }}>
            <Col span={6}>
              <Card bordered={false} bodyStyle={{ padding: '14px 18px' }}
                style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderTop: `3px solid ${metrics.cpu_percent > 80 ? COLOR.danger : COLOR.primary}` }}>
                <Statistic title={<span style={{ fontSize: 12, color: COLOR.textCaption }}>{t('CPU Usage')}</span>}
                  value={metrics.cpu_percent} precision={1} suffix="%"
                  valueStyle={{ color: metrics.cpu_percent > 80 ? COLOR.danger : COLOR.primary, fontSize: 22 }} />
                <CpuCores vcpus={vcpus} cpuPercent={metrics.cpu_percent} />
              </Card>
            </Col>
            <Col span={6}>
              <Card bordered={false} bodyStyle={{ padding: '14px 18px' }}
                style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderTop: `3px solid ${COLOR.success}` }}>
                <Statistic title={<span style={{ fontSize: 12, color: COLOR.textCaption }}>{t('Memory')}</span>}
                  value={metrics.memory_mb} precision={0} suffix="MB"
                  valueStyle={{ color: COLOR.success, fontSize: 22 }} />
                <div style={{ marginTop: 10 }}>
                  <div style={{ height: 6, background: COLOR.bg, borderRadius: 3, overflow: 'hidden', border: `1px solid ${COLOR.border}` }}>
                    <div style={{ height: '100%', width: `${Math.min((metrics.memory_mb / 4096) * 100, 100)}%`, background: COLOR.success, borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ fontSize: 10, color: COLOR.textCaption, marginTop: 3 }}>{metrics.memory_mb.toFixed(0)} / 4096 MB</div>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bordered={false} bodyStyle={{ padding: '14px 18px' }}
                style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderTop: `3px solid ${COLOR.warning}` }}>
                <Statistic title={<span style={{ fontSize: 12, color: COLOR.textCaption }}>{t('Disk Write')}</span>}
                  value={(metrics.disk_write_bytes_per_sec / 1024).toFixed(1)} suffix="KB/s"
                  valueStyle={{ color: COLOR.warning, fontSize: 22 }} />
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLOR.textCaption }}>
                    <span>{t('Read')}</span>
                    <span style={{ color: COLOR.textBody, fontWeight: 500 }}>{(metrics.disk_read_bytes_per_sec / 1024).toFixed(1)} KB/s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLOR.textCaption, marginTop: 4 }}>
                    <span>{t('Capacity')}</span>
                    <span style={{ color: COLOR.textBody, fontWeight: 500 }}>{diskCapGb} GB</span>
                  </div>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bordered={false} bodyStyle={{ padding: '14px 18px' }}
                style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderTop: `3px solid ${COLOR.purple}` }}>
                <Statistic title={<span style={{ fontSize: 12, color: COLOR.textCaption }}>{t('Network RX')}</span>}
                  value={(metrics.network_rx_bytes_per_sec / 1024).toFixed(2)} suffix="KB/s"
                  valueStyle={{ color: COLOR.purple, fontSize: 22 }} />
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLOR.textCaption }}>
                  <span>{t('TX')}</span>
                  <span style={{ color: COLOR.textBody, fontWeight: 500 }}>{(metrics.network_tx_bytes_per_sec / 1024).toFixed(1)} KB/s</span>
                </div>
              </Card>
            </Col>
          </Row>
        )}

        <Spin spinning={loadingHistory}>
          <Row gutter={16}>
            <Col span={12} style={{ marginBottom: 16 }}>
              <Card bordered={false} bodyStyle={{ padding: '12px 16px' }}
                style={{ boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderRadius: 4 }}
                title={<span style={{ fontSize: 13, color: COLOR.textTitle }}>{t('CPU (%)')} — {periodLabel[period]}</span>}>
                <MiniChart data={cpuData} color={COLOR.primary} maxY={100} />
              </Card>
            </Col>
            <Col span={12} style={{ marginBottom: 16 }}>
              <Card bordered={false} bodyStyle={{ padding: '12px 16px' }}
                style={{ boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderRadius: 4 }}
                title={<span style={{ fontSize: 13, color: COLOR.textTitle }}>{t('Memory (MB)')} — {periodLabel[period]}</span>}>
                <MiniChart data={memData} color={COLOR.success} />
              </Card>
            </Col>
            <Col span={12} style={{ marginBottom: 16 }}>
              <Card bordered={false} bodyStyle={{ padding: '12px 16px' }}
                style={{ boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderRadius: 4 }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: COLOR.textTitle }}>{t('Network (KB/s)')} — {periodLabel[period]}</span>
                    <Legend items={[{ color: COLOR.primary, label: 'RX' }, { color: COLOR.warning, label: 'TX' }]} />
                  </div>
                }>
                <DualChart data1={netRxData} data2={netTxData} label1="RX" label2="TX" color1={COLOR.primary} color2={COLOR.warning} />
              </Card>
            </Col>
            <Col span={12} style={{ marginBottom: 16 }}>
              <Card bordered={false} bodyStyle={{ padding: '12px 16px' }}
                style={{ boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderRadius: 4 }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: COLOR.textTitle }}>{t('Disk I/O (KB/s)')} — {periodLabel[period]}</span>
                    <Legend items={[{ color: COLOR.purple, label: t('Read') }, { color: COLOR.danger, label: t('Write') }]} />
                  </div>
                }>
                <DualChart data1={diskReadData} data2={diskWriteData} label1={t('Read')} label2={t('Write')} color1={COLOR.purple} color2={COLOR.danger} />
              </Card>
            </Col>
          </Row>
        </Spin>
      </div>
    );
  }
}