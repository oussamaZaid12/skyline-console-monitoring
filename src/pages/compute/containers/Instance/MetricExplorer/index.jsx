// Monitoring Dashboard — explorateur de métriques type Grafana
// (choix du nœud / métrique / période, historique + live via SSE)
// Author: Oussama Zaied - ESPRIT

import React, { Component } from 'react';
import { inject, observer } from 'mobx-react';
import {
  Card,
  Row,
  Col,
  Select,
  Radio,
  Switch,
  Spin,
  Alert,
  Empty,
  DatePicker,
  Statistic,
} from 'antd';
import { Chart, Line, Area, Axis, Tooltip } from 'bizcharts';
import moment from 'moment';

const { Option } = Select;
const { RangePicker } = DatePicker;

const API_BASE = '/api/openstack/skyline/api/v1';

const COLOR = {
  primary: '#0c63fa',
  success: '#1890ff',
  warning: '#f5a623',
  danger: '#ca2621',
  purple: '#5f708a',
  textTitle: 'rgba(0,0,0,0.85)',
  textBody: 'rgba(0,0,0,0.65)',
  textCaption: 'rgba(0,0,0,0.45)',
  border: '#ccd3db',
  bg: '#f0f1f7',
  bgCard: '#ffffff',
};

// Périodes rapides (en secondes)
const PERIODS = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
};

// Pas (step) manuel disponible, en secondes. 'auto' = calculé par le backend.
const STEP_OPTIONS = [
  { value: 'auto', label: t('Auto') },
  { value: 15, label: '15s' },
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
];

// Correspondance clé de métrique (catalogue) -> champ du flux SSE
const SSE_FIELD_MAP = {
  cpu: 'cpu_percent',
  memory_mb: 'memory_mb',
  memory_pct: 'memory_pct',
  network_rx: 'network_rx_kbps',
  network_tx: 'network_tx_kbps',
  disk_read: 'disk_read_kbps',
  disk_write: 'disk_write_kbps',
  disk_read_iops: 'disk_read_iops',
  disk_write_iops: 'disk_write_iops',
};

const LIVE_WINDOW_POINTS = 60; // ~5min @ 5s

function formatTime(ts, longFormat) {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (longFormat) {
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');
    return `${MM}-${DD} ${hh}:${mm}`;
  }
  const ss = String(d.getSeconds()).padStart(2, '00');
  return `${hh}:${mm}:${ss}`;
}

// Ajoute une transparence à une couleur hexadécimale (#rrggbb -> rgba(...)).
function withAlpha(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((c) => parseInt(c, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const MetricChart = ({ data, color, unit, height = 360 }) => {
  if (!data || !data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: COLOR.textCaption, fontSize: 13 }}>
              {t('No data available for this period')}
            </span>
          }
        />
      </div>
    );
  }

  // Échelle verticale : toujours partir de 0, avec une marge au-dessus de la
  // valeur max pour que la courbe ne colle pas au plafond (et reste lisible
  // même si la métrique est quasi constante sur la période).
  const values = data.map((d) => d.value);
  const dataMax = Math.max(...values);
  const max = dataMax > 0 ? dataMax * 1.2 : 1;

  return (
    <Chart
      height={height}
      data={data}
      autoFit
      padding={[20, 30, 50, 60]}
      scale={{ value: { min: 0, max, nice: true } }}
    >
      <Axis
        name="time"
        label={{ style: { fontSize: 11, fill: COLOR.textCaption }, autoRotate: true }}
        tickCount={8}
        grid={null}
      />
      <Axis
        name="value"
        grid={{ line: { style: { stroke: COLOR.border, lineDash: [2, 2], lineWidth: 1 } } }}
        label={{
          style: { fontSize: 11, fill: COLOR.textCaption },
          formatter: (v) => `${v}${unit ? ` ${unit}` : ''}`,
        }}
      />
      <Tooltip showCrosshairs shared />
      <Area
        position="time*value"
        shape="smooth"
        color={color}
        style={{ fill: `l(270) 0:${withAlpha(color, 0.28)} 1:${withAlpha(color, 0.02)}` }}
      />
      <Line position="time*value" color={color} size={2} shape="smooth" />
    </Chart>
  );
};

@inject('rootStore')
@observer
export default class MetricExplorer extends Component {
  constructor(props) {
    super(props);
    this.state = {
      instances: [],
      catalog: [],
      selectedInstance: null,
      selectedMetric: 'cpu',
      period: '1h',
      customRange: null,
      step: 'auto',
      live: false,
      history: null,
      liveSeries: {},
      liveValue: null,
      loading: true,
      loadingChart: false,
      error: null,
      sseError: null,
    };
    this.refreshInterval = null;
    this.eventSource = null;
  }

  componentDidMount() {
    this.init();
  }

  componentWillUnmount() {
    this.stopAutoRefresh();
    this.stopSSE();
  }

  init = async () => {
    try {
      const [instances, catalog] = await Promise.all([
        this.fetchInstances(),
        this.fetchCatalog(),
      ]);
      const selectedInstance = instances.length ? instances[0].uuid : null;
      this.setState({ instances, catalog, selectedInstance, loading: false }, () => {
        this.fetchHistory();
        this.startAutoRefresh();
      });
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  };

  fetchInstances = async () => {
    const res = await fetch(`${API_BASE}/vm-ranking`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const all = [
      ...(data.by_cpu || []),
      ...(data.by_memory || []),
      ...(data.by_network || []),
    ]
      .filter((vm) => vm.uuid)
      .reduce((acc, vm) => {
        if (!acc.find((v) => v.uuid === vm.uuid)) acc.push({ uuid: vm.uuid, name: vm.name });
        return acc;
      }, []);
    return all;
  };

  fetchCatalog = async () => {
    const res = await fetch(`${API_BASE}/instance-metrics-catalog`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  startAutoRefresh = () => {
    this.stopAutoRefresh();
    // Rafraîchit l'historique toutes les 30s (sauf en mode Live, où le SSE prend le relais)
    this.refreshInterval = setInterval(() => {
      if (!this.state.live) this.fetchHistory();
    }, 30000);
  };

  stopAutoRefresh = () => {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = null;
  };

  getRange = () => {
    const { period, customRange } = this.state;
    if (period === 'custom' && customRange) {
      return [customRange[0].unix(), customRange[1].unix()];
    }
    const end = moment().unix();
    const start = end - PERIODS[period];
    return [start, end];
  };

  fetchHistory = async () => {
    const { selectedInstance, selectedMetric, step } = this.state;
    if (!selectedInstance || !selectedMetric) return;
    this.setState({ loadingChart: true });
    try {
      const [start, end] = this.getRange();
      const params = new URLSearchParams({ metric: selectedMetric, start, end });
      if (step && step !== 'auto') params.set('step', step);
      const res = await fetch(
        `${API_BASE}/instance-metric-range/${selectedInstance}?${params.toString()}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.setState({ history: data, loadingChart: false, error: null });
    } catch (err) {
      this.setState({ loadingChart: false, error: err.message });
    }
  };

  startSSE = () => {
    this.stopSSE();
    const { selectedInstance } = this.state;
    if (!selectedInstance) return;

    const url = `${API_BASE}/instances/${selectedInstance}/metrics-stream`;
    this.eventSource = new EventSource(url, { withCredentials: true });

    this.eventSource.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const time = Math.floor(Date.now() / 1000);
      this.setState((prev) => {
        const liveSeries = { ...prev.liveSeries };
        Object.keys(SSE_FIELD_MAP).forEach((metricKey) => {
          const field = SSE_FIELD_MAP[metricKey];
          const series = liveSeries[metricKey] || [];
          liveSeries[metricKey] = [...series.slice(-(LIVE_WINDOW_POINTS - 1)), { time, value: m[field] }];
        });
        return {
          liveSeries,
          liveValue: m,
          sseError: null,
        };
      });
    };

    this.eventSource.addEventListener('connected', () => {
      this.setState({ sseError: null });
    });

    this.eventSource.onerror = (e) => {
      if (e?.data) {
        let msg = t('Real-time stream error');
        try {
          msg = JSON.parse(e.data).error || msg;
        } catch (_) {
          /* ignore */
        }
        this.setState({ sseError: msg });
      } else {
        this.setState({ sseError: t('Real-time stream disconnected, retrying...') });
      }
    };
  };

  stopSSE = () => {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  };

  handleInstanceChange = (value) => {
    this.setState(
      { selectedInstance: value, history: null, liveSeries: {}, liveValue: null },
      () => {
        if (this.state.live) this.startSSE();
        else this.fetchHistory();
      }
    );
  };

  handleMetricChange = (value) => {
    this.setState({ selectedMetric: value }, () => {
      if (!this.state.live) this.fetchHistory();
    });
  };

  handlePeriodChange = (e) => {
    this.setState({ period: e.target.value, customRange: null }, () => {
      if (!this.state.live) this.fetchHistory();
    });
  };

  handleCustomRangeChange = (dates) => {
    this.setState({ period: 'custom', customRange: dates }, () => {
      if (!this.state.live && dates) this.fetchHistory();
    });
  };

  handleStepChange = (value) => {
    this.setState({ step: value }, () => {
      if (!this.state.live) this.fetchHistory();
    });
  };

  handleLiveChange = (checked) => {
    this.setState({ live: checked }, () => {
      if (checked) this.startSSE();
      else {
        this.stopSSE();
        this.setState({ sseError: null });
        this.fetchHistory();
      }
    });
  };

  render() {
    const {
      instances,
      catalog,
      selectedInstance,
      selectedMetric,
      period,
      customRange,
      step,
      live,
      history,
      liveSeries,
      liveValue,
      loading,
      loadingChart,
      error,
      sseError,
    } = this.state;

    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: COLOR.textCaption, fontSize: 13 }}>
            {t('Loading...')}
          </div>
        </div>
      );
    }

    const metricDef = catalog.find((c) => c.key === selectedMetric) || {};
    const longFormat = period === '7d' || period === '24h' || period === 'custom';

    let chartData = [];
    let currentValue = null;
    if (live) {
      const series = liveSeries[selectedMetric] || [];
      chartData = series.map((p) => ({ time: formatTime(p.time, false), value: p.value }));
      currentValue = liveValue ? liveValue[SSE_FIELD_MAP[selectedMetric]] : null;
    } else if (history) {
      chartData = history.points.map((p) => ({
        time: formatTime(p.time, longFormat),
        value: p.value,
      }));
      currentValue = history.points.length ? history.points[history.points.length - 1].value : null;
    }

    return (
      <div style={{ padding: '20px 24px', background: COLOR.bg, minHeight: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: COLOR.textTitle }}>
              {t('Monitoring Dashboard')}
            </div>
            <div style={{ width: 32, height: 2, background: COLOR.primary, marginTop: 4, borderRadius: 1 }} />
          </div>
          {live && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: sseError ? COLOR.warning : '#52c41a',
                fontWeight: 500,
                fontSize: 12,
              }}
              title={sseError || ''}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: sseError ? COLOR.warning : '#52c41a',
                  display: 'inline-block',
                }}
              />
              {sseError ? t('Live stream unavailable') : 'Live'}
            </span>
          )}
        </div>

        {error && (
          <Alert message={t('Error')} description={error} type="error" showIcon style={{ marginBottom: 16 }} />
        )}

        {/* Configuration panel */}
        <Card
          bordered={false}
          bodyStyle={{ padding: '16px 20px' }}
          style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)', marginBottom: 16 }}
        >
          <Row gutter={[16, 16]} align="middle">
            <Col>
              <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 4 }}>{t('Node (VM)')}</div>
              <Select
                value={selectedInstance}
                onChange={this.handleInstanceChange}
                style={{ minWidth: 200 }}
              >
                {instances.map((i) => (
                  <Option key={i.uuid} value={i.uuid}>
                    {i.name}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 4 }}>{t('Metric')}</div>
              <Select
                value={selectedMetric}
                onChange={this.handleMetricChange}
                style={{ minWidth: 200 }}
              >
                {catalog.map((m) => (
                  <Option key={m.key} value={m.key}>
                    {t(m.label)} {m.unit ? `(${m.unit})` : ''}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 4 }}>{t('Period')}</div>
              <Radio.Group value={period} onChange={this.handlePeriodChange} disabled={live} buttonStyle="solid" size="middle">
                <Radio.Button value="15m">15m</Radio.Button>
                <Radio.Button value="1h">1h</Radio.Button>
                <Radio.Button value="6h">6h</Radio.Button>
                <Radio.Button value="24h">24h</Radio.Button>
                <Radio.Button value="7d">7d</Radio.Button>
              </Radio.Group>
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 4 }}>{t('Custom Range')}</div>
              <RangePicker
                showTime
                disabled={live}
                value={period === 'custom' ? customRange : null}
                onChange={this.handleCustomRangeChange}
                disabledDate={(current) => current && current > moment().endOf('day')}
              />
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 4 }}>{t('Step')}</div>
              <Select value={step} onChange={this.handleStepChange} disabled={live} style={{ minWidth: 100 }}>
                {STEP_OPTIONS.map((o) => (
                  <Option key={o.label} value={o.value}>
                    {o.label}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 4 }}>{t('Live')}</div>
              <Switch checked={live} onChange={this.handleLiveChange} />
            </Col>
          </Row>
        </Card>

        <Row gutter={16}>
          <Col span={6}>
            <Card
              bordered={false}
              bodyStyle={{ padding: '16px 20px' }}
              style={{
                background: COLOR.bgCard,
                borderRadius: 4,
                boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
                borderTop: `3px solid ${COLOR.primary}`,
                height: '100%',
              }}
            >
              <Statistic
                title={
                  <span style={{ fontSize: 12, color: COLOR.textCaption }}>
                    {t(metricDef.label || '')}
                  </span>
                }
                value={currentValue === null || currentValue === undefined ? '-' : currentValue}
                precision={typeof currentValue === 'number' ? 2 : undefined}
                suffix={metricDef.unit}
                valueStyle={{ color: COLOR.primary, fontSize: 26 }}
              />
              {history && (
                <div style={{ fontSize: 11, color: COLOR.textCaption, marginTop: 8 }}>
                  {history.domain} — step {history.step}s
                </div>
              )}
            </Card>
          </Col>
          <Col span={18}>
            <Card
              bordered={false}
              bodyStyle={{ padding: '12px 16px' }}
              style={{ boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderRadius: 4 }}
              title={
                <span style={{ fontSize: 13, color: COLOR.textTitle }}>
                  {t(metricDef.label || '')} {metricDef.unit ? `(${metricDef.unit})` : ''}
                </span>
              }
            >
              <Spin spinning={loadingChart && !live}>
                <MetricChart data={chartData} color={COLOR.primary} unit={metricDef.unit} />
              </Spin>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }
}
