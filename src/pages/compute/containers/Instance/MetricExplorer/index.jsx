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
  { value: 5, label: '5s' },
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

// Nombre maximum de points conservés par métrique en mode Live, pour éviter
// une croissance illimitée de la mémoire sur une session longue (la période
// choisie sert juste à pré-remplir la courbe ; au-delà, on tronque par le début).
const MAX_LIVE_POINTS = 3000;

// Durée de la transition animée lorsqu'un nouveau point réel arrive en mode
// Live (toutes les 5s, au rythme du flux SSE). Une durée proche de l'intervalle
// réel fait "glisser" la courbe vers le nouveau point au lieu de le faire
// apparaître brutalement — sans jamais redessiner le graphique entre-temps
// (ce qui casserait le survol/tooltip).
const LIVE_UPDATE_ANIMATION_MS = 4500;

// Valeur spéciale du sélecteur de métrique : affiche toutes les métriques
// du catalogue en même temps, sous forme de grille de mini-graphiques.
const ALL_METRICS_KEY = '__all__';

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

// `data` doit contenir des timestamps en millisecondes (axe temps continu),
// pas des libellés déjà formatés : ceci permet à G2 d'interpoler/animer la
// courbe en continu (technique de "lissage") au lieu de la redessiner en
// catégories discrètes à chaque nouveau point.
const MetricChart = ({
  data,
  color,
  unit,
  height = 360,
  longFormat = false,
  live = false,
}) => {
  if (!data || !data.length) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
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
      scale={{
        value: { min: 0, max, nice: true },
        // Formatter posé sur l'ÉCHELLE (reçoit la vraie valeur en ms), pas sur
        // le label de l'Axis (qui reçoit le texte déjà formaté par l'échelle
        // "time" — Number(text) y vaudrait NaN). G2 réutilise ce même formatter
        // pour le tooltip par défaut, donc l'heure y est aussi correcte.
        time: {
          type: 'time',
          formatter: (v) => formatTime(Number(v) / 1000, longFormat),
        },
      }}
    >
      <Axis
        name="time"
        label={{
          style: { fontSize: 11, fill: COLOR.textCaption },
          autoRotate: true,
        }}
        tickCount={6}
        grid={null}
      />
      <Axis
        name="value"
        grid={{
          line: {
            style: { stroke: COLOR.border, lineDash: [2, 2], lineWidth: 1 },
          },
        }}
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
        tooltip={false}
        style={{
          fill: `l(270) 0:${withAlpha(color, 0.28)} 1:${withAlpha(
            color,
            0.02
          )}`,
        }}
      />
      <Line
        position="time*value"
        color={color}
        size={2}
        shape="smooth"
        // En mode Live, chaque nouveau point réel (toutes les 5s, via SSE) ne
        // s'affiche pas brutalement : la courbe glisse vers lui pendant
        // LIVE_UPDATE_ANIMATION_MS. Contrairement à une approche par ticker,
        // le graphique n'est jamais redessiné entre deux vraies données, donc
        // le survol/tooltip reste pleinement utilisable à tout moment.
        animate={
          live
            ? {
                update: {
                  duration: LIVE_UPDATE_ANIMATION_MS,
                  easing: 'easeCubic',
                },
              }
            : undefined
        }
      />
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
      allHistory: {},
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
      this.setState(
        { instances, catalog, selectedInstance, loading: false },
        () => {
          this.fetchHistory();
          this.startAutoRefresh();
        }
      );
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  };

  fetchInstances = async () => {
    // Endpoint scopé au projet de l'utilisateur connecté (jamais les VM
    // d'un autre projet) — distinct de /vm-ranking qui sert au classement.
    const res = await fetch(`${API_BASE}/alerts/my-instances`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  fetchCatalog = async () => {
    const res = await fetch(`${API_BASE}/instance-metrics-catalog`, {
      credentials: 'include',
    });
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

  // Durée (en secondes) de la période actuellement sélectionnée. Utilisée en
  // mode Live pour garder une fenêtre glissante de cette taille, plutôt que de
  // laisser le graphique s'allonger indéfiniment.
  getPeriodSeconds = () => {
    const [start, end] = this.getRange();
    return Math.max(end - start, 1);
  };

  fetchOneMetricRange = async (metricKey) => {
    const { selectedInstance, step } = this.state;
    const [start, end] = this.getRange();
    const params = new URLSearchParams({ metric: metricKey, start, end });
    if (step && step !== 'auto') params.set('step', step);
    const res = await fetch(
      `${API_BASE}/instance-metric-range/${selectedInstance}?${params.toString()}`,
      { credentials: 'include' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  fetchHistory = async () => {
    const { selectedInstance, selectedMetric, catalog } = this.state;
    if (!selectedInstance || !selectedMetric) return;
    this.setState({ loadingChart: true });
    try {
      if (selectedMetric === ALL_METRICS_KEY) {
        const results = await Promise.all(
          catalog.map((m) =>
            this.fetchOneMetricRange(m.key)
              .then((data) => [m.key, data])
              .catch(() => [m.key, null])
          )
        );
        const allHistory = results.reduce((acc, [key, data]) => {
          acc[key] = data;
          return acc;
        }, {});
        this.setState({ allHistory, loadingChart: false, error: null });
        return;
      }
      const data = await this.fetchOneMetricRange(selectedMetric);
      this.setState({ history: data, loadingChart: false, error: null });
    } catch (err) {
      this.setState({ loadingChart: false, error: err.message });
    }
  };

  // Pré-remplit liveSeries avec l'historique (période/step en cours) pour
  // chaque métrique du catalogue, afin que le mode Live démarre avec la
  // courbe déjà visible (ex: la dernière heure) plutôt que vide. Le flux SSE
  // viendra ensuite prolonger ces séries en temps réel.
  seedLiveSeries = async () => {
    const { selectedInstance, catalog } = this.state;
    if (!selectedInstance || !catalog.length) return;
    this.setState({ loadingChart: true });
    try {
      const results = await Promise.all(
        catalog.map((m) =>
          this.fetchOneMetricRange(m.key)
            .then((data) => [m.key, data.points || []])
            .catch(() => [m.key, []])
        )
      );
      const liveSeries = results.reduce((acc, [key, points]) => {
        acc[key] = points.slice(-MAX_LIVE_POINTS);
        return acc;
      }, {});
      this.setState({ liveSeries, loadingChart: false, error: null });
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
      // Fenêtre glissante : ne garde que les points compris dans la durée de
      // la période choisie (ex: 1h) — les points plus anciens sortent au fur
      // et à mesure que de nouveaux points arrivent, comme la fenêtre du mode
      // historique, mais qui "avance" en temps réel.
      const cutoff = time - this.getPeriodSeconds();
      this.setState((prev) => {
        const liveSeries = { ...prev.liveSeries };
        Object.keys(SSE_FIELD_MAP).forEach((metricKey) => {
          const field = SSE_FIELD_MAP[metricKey];
          const series = liveSeries[metricKey] || [];
          const extended = [...series, { time, value: m[field] }];
          liveSeries[metricKey] = extended
            .filter((p) => p.time >= cutoff)
            .slice(-MAX_LIVE_POINTS);
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
        this.setState({
          sseError: t('Real-time stream disconnected, retrying...'),
        });
      }
    };
  };

  stopSSE = () => {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  };

  // Convertit une série {time en secondes, value} en {time en ms, value} pour
  // l'axe temps continu de MetricChart. Pas d'interpolation : on affiche la
  // vraie donnée reçue, et c'est l'animation de transition (animate.update,
  // cf. MetricChart) qui rend visible l'avancée d'un point réel au suivant.
  toChartSeries = (rawSeries) =>
    (rawSeries || []).map((p) => ({ time: p.time * 1000, value: p.value }));

  handleInstanceChange = (value) => {
    this.setState(
      {
        selectedInstance: value,
        history: null,
        allHistory: {},
        liveSeries: {},
        liveValue: null,
      },
      async () => {
        if (this.state.live) {
          await this.seedLiveSeries();
          this.startSSE();
        } else {
          this.fetchHistory();
        }
      }
    );
  };

  handleMetricChange = (value) => {
    this.setState({ selectedMetric: value }, () => {
      // En mode Live, liveSeries contient déjà toutes les métriques : pas besoin de refetch.
      if (!this.state.live) this.fetchHistory();
    });
  };

  handlePeriodChange = (e) => {
    this.setState({ period: e.target.value, customRange: null }, () => {
      if (this.state.live) this.seedLiveSeries();
      else this.fetchHistory();
    });
  };

  handleCustomRangeChange = (dates) => {
    this.setState({ period: 'custom', customRange: dates }, () => {
      if (!dates) return;
      if (this.state.live) this.seedLiveSeries();
      else this.fetchHistory();
    });
  };

  handleStepChange = (value) => {
    this.setState({ step: value }, () => {
      if (this.state.live) this.seedLiveSeries();
      else this.fetchHistory();
    });
  };

  handleLiveChange = (checked) => {
    this.setState({ live: checked }, async () => {
      if (checked) {
        // Pré-remplit avec l'historique de la période en cours, puis ouvre le flux SSE
        // qui prolonge la courbe en temps réel sans repartir de zéro.
        await this.seedLiveSeries();
        this.startSSE();
      } else {
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
      allHistory,
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
          <div
            style={{ marginTop: 12, color: COLOR.textCaption, fontSize: 13 }}
          >
            {t('Loading...')}
          </div>
        </div>
      );
    }

    const showAllMetrics = selectedMetric === ALL_METRICS_KEY;
    const metricDef = catalog.find((c) => c.key === selectedMetric) || {};
    const longFormat =
      period === '7d' || period === '24h' || period === 'custom';

    let chartData = [];
    let currentValue = null;
    // Moyenne sur la fenêtre actuellement affichée : la période choisie hors
    // Live, ou la même durée glissante pendant le Live — permet de voir la
    // différence avec "currentValue", qui est le dernier point (pas une moyenne).
    let averageValue = null;
    if (!showAllMetrics) {
      if (live) {
        const series = liveSeries[selectedMetric] || [];
        // Le lissage (interpolation) ne s'applique qu'à la courbe affichée ;
        // la valeur courante et la moyenne restent calculées sur les vraies
        // mesures reçues, pour ne jamais afficher de chiffre "deviné".
        chartData = this.toChartSeries(series);
        currentValue = liveValue
          ? liveValue[SSE_FIELD_MAP[selectedMetric]]
          : null;
        averageValue = series.length
          ? series.reduce((sum, p) => sum + p.value, 0) / series.length
          : null;
      } else if (history) {
        chartData = history.points.map((p) => ({
          time: p.time * 1000,
          value: p.value,
        }));
        currentValue = history.points.length
          ? history.points[history.points.length - 1].value
          : null;
        averageValue = history.points.length
          ? history.points.reduce((sum, p) => sum + p.value, 0) /
            history.points.length
          : null;
      }
    }

    // Pour chaque métrique du catalogue, calcule les données du mini-graphique
    // (mode Live : à partir du flux SSE déjà reçu, lissé ; mode historique : à
    // partir de allHistory, peuplé par fetchHistory lorsque "All metrics" est choisi).
    const buildGridData = (metricKey) => {
      if (live) {
        const series = liveSeries[metricKey] || [];
        return {
          data: this.toChartSeries(series),
          current: liveValue ? liveValue[SSE_FIELD_MAP[metricKey]] : null,
          domain: null,
          step: null,
        };
      }
      const h = allHistory[metricKey];
      if (!h) return { data: [], current: null, domain: null, step: null };
      return {
        data: h.points.map((p) => ({ time: p.time * 1000, value: p.value })),
        current: h.points.length ? h.points[h.points.length - 1].value : null,
        domain: h.domain,
        step: h.step,
      };
    };

    return (
      <div
        style={{
          padding: '20px 24px',
          background: COLOR.bg,
          height: '100%',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{ fontSize: 18, fontWeight: 600, color: COLOR.textTitle }}
            >
              {t('Monitoring Dashboard')}
            </div>
            <div
              style={{
                width: 32,
                height: 2,
                background: COLOR.primary,
                marginTop: 4,
                borderRadius: 1,
              }}
            />
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
              {/* Pulsation continue : rassure visuellement que le flux est actif
                  même entre deux vraies valeurs reçues (toutes les 5s). */}
              <span
                style={{
                  position: 'relative',
                  width: 8,
                  height: 8,
                  display: 'inline-block',
                }}
              >
                {!sseError && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#52c41a',
                      animation:
                        'metric-explorer-live-pulse 1.6s ease-out infinite',
                    }}
                  />
                )}
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: sseError ? COLOR.warning : '#52c41a',
                  }}
                />
              </span>
              {sseError ? t('Live stream unavailable') : 'Live'}
            </span>
          )}
        </div>
        <style>
          {`@keyframes metric-explorer-live-pulse {
            0% { transform: scale(1); opacity: 0.7; }
            100% { transform: scale(2.8); opacity: 0; }
          }`}
        </style>

        {error && (
          <Alert
            message={t('Error')}
            description={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Configuration panel */}
        <Card
          bordered={false}
          bodyStyle={{ padding: '16px 20px' }}
          style={{
            background: COLOR.bgCard,
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
            marginBottom: 16,
          }}
        >
          <Row gutter={[16, 16]} align="middle">
            <Col>
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.textCaption,
                  marginBottom: 4,
                }}
              >
                {t('Node (VM)')}
              </div>
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
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.textCaption,
                  marginBottom: 4,
                }}
              >
                {t('Metric')}
              </div>
              <Select
                value={selectedMetric}
                onChange={this.handleMetricChange}
                style={{ minWidth: 200 }}
              >
                <Option value={ALL_METRICS_KEY}>{t('All metrics')}</Option>
                {catalog.map((m) => (
                  <Option key={m.key} value={m.key}>
                    {t(m.label)} {m.unit ? `(${m.unit})` : ''}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col>
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.textCaption,
                  marginBottom: 4,
                }}
              >
                {t('Period')}
              </div>
              <Radio.Group
                value={period}
                onChange={this.handlePeriodChange}
                buttonStyle="solid"
                size="middle"
              >
                <Radio.Button value="15m">15m</Radio.Button>
                <Radio.Button value="1h">1h</Radio.Button>
                <Radio.Button value="6h">6h</Radio.Button>
                <Radio.Button value="24h">24h</Radio.Button>
                <Radio.Button value="7d">7d</Radio.Button>
              </Radio.Group>
            </Col>
            <Col>
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.textCaption,
                  marginBottom: 4,
                }}
              >
                {t('Custom Range')}
              </div>
              <RangePicker
                showTime
                value={period === 'custom' ? customRange : null}
                onChange={this.handleCustomRangeChange}
                disabledDate={(current) =>
                  current && current > moment().endOf('day')
                }
              />
            </Col>
            <Col>
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.textCaption,
                  marginBottom: 4,
                }}
              >
                {t('Step')}
              </div>
              <Select
                value={step}
                onChange={this.handleStepChange}
                style={{ minWidth: 100 }}
              >
                {STEP_OPTIONS.map((o) => (
                  <Option key={o.label} value={o.value}>
                    {o.label}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col>
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.textCaption,
                  marginBottom: 4,
                }}
              >
                {t('Live')}
              </div>
              <Switch checked={live} onChange={this.handleLiveChange} />
            </Col>
          </Row>
        </Card>

        {showAllMetrics ? (
          <Spin spinning={loadingChart}>
            <Row gutter={[16, 16]}>
              {catalog.map((m) => {
                const grid = buildGridData(m.key);
                return (
                  <Col span={8} key={m.key}>
                    <Card
                      bordered={false}
                      bodyStyle={{ padding: '12px 16px' }}
                      style={{
                        boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
                        borderRadius: 4,
                        height: '100%',
                      }}
                      title={
                        <span style={{ fontSize: 13, color: COLOR.textTitle }}>
                          {t(m.label)} {m.unit ? `(${m.unit})` : ''}
                        </span>
                      }
                      extra={
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: COLOR.primary,
                          }}
                        >
                          {grid.current === null || grid.current === undefined
                            ? '-'
                            : Number(grid.current).toFixed(2)}
                          {m.unit ? ` ${m.unit}` : ''}
                        </span>
                      }
                    >
                      <MetricChart
                        data={grid.data}
                        color={COLOR.primary}
                        unit={m.unit}
                        height={200}
                        longFormat={longFormat}
                        live={live}
                      />
                      {grid.domain && (
                        <div
                          style={{
                            fontSize: 11,
                            color: COLOR.textCaption,
                            marginTop: 4,
                          }}
                        >
                          {grid.domain} — step {grid.step}s
                        </div>
                      )}
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </Spin>
        ) : (
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
                      {t(metricDef.label || '')}{' '}
                      {live
                        ? `— ${t('Live')}`
                        : `— ${t('Last point in period')}`}
                    </span>
                  }
                  value={
                    currentValue === null || currentValue === undefined
                      ? '-'
                      : currentValue
                  }
                  precision={typeof currentValue === 'number' ? 2 : undefined}
                  suffix={metricDef.unit}
                  valueStyle={{ color: COLOR.primary, fontSize: 26 }}
                />
                {averageValue !== null && averageValue !== undefined && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: `1px dashed ${COLOR.border}`,
                    }}
                  >
                    <span style={{ fontSize: 12, color: COLOR.textCaption }}>
                      {live
                        ? t('Average over the live window')
                        : t('Average over period')}
                    </span>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: COLOR.purple,
                      }}
                    >
                      {averageValue.toFixed(2)}
                      {metricDef.unit ? ` ${metricDef.unit}` : ''}
                    </div>
                  </div>
                )}
                {history && (
                  <div
                    style={{
                      fontSize: 11,
                      color: COLOR.textCaption,
                      marginTop: 8,
                    }}
                  >
                    {history.domain} — step {history.step}s
                  </div>
                )}
              </Card>
            </Col>
            <Col span={18}>
              <Card
                bordered={false}
                bodyStyle={{ padding: '12px 16px' }}
                style={{
                  boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
                  borderRadius: 4,
                }}
                title={
                  <span style={{ fontSize: 13, color: COLOR.textTitle }}>
                    {t(metricDef.label || '')}{' '}
                    {metricDef.unit ? `(${metricDef.unit})` : ''}
                  </span>
                }
              >
                <Spin spinning={loadingChart}>
                  <MetricChart
                    data={chartData}
                    color={COLOR.primary}
                    unit={metricDef.unit}
                    longFormat={longFormat}
                    live={live}
                  />
                </Spin>
              </Card>
            </Col>
          </Row>
        )}
      </div>
    );
  }
}
