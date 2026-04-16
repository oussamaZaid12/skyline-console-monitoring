// VM Ranking — Classement des instances par consommation
// Author: Oussama Zaied - ESPRIT

import React, { Component } from 'react';
import { inject, observer } from 'mobx-react';
import { Table, Card, Row, Col, Statistic, Spin, Alert, Tabs, Typography } from 'antd';
import { RiseOutlined, DatabaseOutlined, WifiOutlined, ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;
const { TabPane } = Tabs;

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

const MiniBar = ({ percent, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
    <div style={{ flex: 1, height: 6, background: COLOR.bg, borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
      <div style={{
        width: `${Math.min(percent, 100)}%`, height: '100%',
        background: color, borderRadius: 3, transition: 'width 0.4s ease',
      }} />
    </div>
  </div>
);

const RankBadge = ({ index }) => {
  const colors = ['#ca2621', '#f5a623', COLOR.primary];
  return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%',
      background: colors[index] || COLOR.textCaption,
      color: '#fff', fontSize: 11, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {index + 1}
    </div>
  );
};

@inject('rootStore')
@observer
export default class VmRanking extends Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: null, data: null, lastUpdate: null };
    this.refreshInterval = null;
  }

  componentDidMount() {
    this.fetchData();
    this.refreshInterval = setInterval(this.fetchData, 30000);
  }

  componentWillUnmount() { clearInterval(this.refreshInterval); }

  fetchData = async () => {
    try {
      const response = await fetch('/api/openstack/skyline/api/v1/vm-ranking');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.setState({ loading: false, error: null, data, lastUpdate: new Date().toLocaleTimeString() });
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  };

  makeColumns = (mainKey, mainLabel, mainColor, mainRender, extraCols = []) => [
    { title: '#', key: 'rank', width: 48, render: (_, __, i) => <RankBadge index={i} /> },
    {
      title: t('Instance'), key: 'instance',
      render: (_, row) => row.uuid
        ? <a href={`/compute/instance/detail/${row.uuid}?tab=monitoring`} style={{ color: COLOR.primary, fontWeight: 500 }}>{row.name}</a>
        : <span style={{ fontWeight: 500, color: COLOR.textTitle }}>{row.name}</span>,
    },
    {
      title: mainLabel, dataIndex: mainKey, key: mainKey, width: 260,
      sorter: (a, b) => a[mainKey] - b[mainKey],
      render: mainRender,
    },
    ...extraCols,
  ];

  cpuColumns = () => this.makeColumns(
    'cpu_percent', t('CPU Usage'), COLOR.primary,
    (v) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <MiniBar percent={v} color={v > 80 ? COLOR.danger : v > 50 ? COLOR.warning : COLOR.primary} />
        </div>
        <span style={{ width: 48, textAlign: 'right', color: COLOR.textBody, fontSize: 13 }}>{v.toFixed(1)}%</span>
      </div>
    ),
    [
      { title: t('Memory'), dataIndex: 'memory_mb', key: 'memory_mb', width: 110, render: (v) => <span style={{ color: COLOR.textBody }}>{v.toFixed(0)} MB</span> },
      { title: t('Network RX'), dataIndex: 'network_rx_kbps', key: 'network_rx_kbps', width: 120, render: (v) => <span style={{ color: COLOR.textBody }}>{v.toFixed(2)} KB/s</span> },
    ]
  );

  memoryColumns = () => this.makeColumns(
    'memory_mb', t('Memory Usage'), COLOR.success,
    (v) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}><MiniBar percent={(v / 4096) * 100} color={COLOR.success} /></div>
        <span style={{ width: 60, textAlign: 'right', color: COLOR.textBody, fontSize: 13 }}>{v.toFixed(0)} MB</span>
      </div>
    ),
    [{ title: t('CPU'), dataIndex: 'cpu_percent', key: 'cpu_percent', width: 80, render: (v) => <span style={{ color: COLOR.textBody }}>{v.toFixed(1)}%</span> }]
  );

  networkColumns = () => this.makeColumns(
    'network_rx_kbps', t('Network RX'), COLOR.purple,
    (v) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}><MiniBar percent={Math.min(v, 100)} color={COLOR.purple} /></div>
        <span style={{ width: 72, textAlign: 'right', color: COLOR.textBody, fontSize: 13 }}>{v.toFixed(2)} KB/s</span>
      </div>
    ),
    [
      { title: t('CPU'), dataIndex: 'cpu_percent', key: 'cpu_percent', width: 80, render: (v) => <span style={{ color: COLOR.textBody }}>{v.toFixed(1)}%</span> },
      { title: t('Memory'), dataIndex: 'memory_mb', key: 'memory_mb', width: 110, render: (v) => <span style={{ color: COLOR.textBody }}>{v.toFixed(0)} MB</span> },
    ]
  );

  render() {
    const { loading, error, data, lastUpdate } = this.state;

    if (loading && !data) return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 12, color: COLOR.textCaption, fontSize: 13 }}>{t('Loading VM metrics...')}</div>
      </div>
    );

    if (error) return <Alert message={t('Error Loading Metrics')} description={error} type="error" showIcon style={{ margin: 24 }} />;

    const topCpu = data.by_cpu[0];
    const topMem = data.by_memory[0];
    const topNet = data.by_network[0];

    const statCards = [
      { label: t('Top CPU Consumer'),     icon: <RiseOutlined />,     value: topCpu ? topCpu.cpu_percent : 0,          suffix: '%',    precision: 1, instance: topCpu?.name || '-', color: COLOR.danger },
      { label: t('Top Memory Consumer'),  icon: <DatabaseOutlined />, value: topMem ? topMem.memory_mb : 0,            suffix: 'MB',   precision: 0, instance: topMem?.name || '-', color: COLOR.primary },
      { label: t('Top Network Consumer'), icon: <WifiOutlined />,     value: topNet ? topNet.network_rx_kbps : 0,      suffix: 'KB/s', precision: 2, instance: topNet?.name || '-', color: COLOR.purple },
    ];

    return (
      <div style={{ padding: '20px 24px', background: COLOR.bg, minHeight: '100%' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: COLOR.textTitle }}>{t('Instance Monitoring — VM Ranking')}</div>
            <div style={{ width: 32, height: 2, background: COLOR.primary, marginTop: 4, borderRadius: 1 }} />
          </div>
          <div style={{ fontSize: 12, color: COLOR.textCaption, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ReloadOutlined spin={loading} style={{ fontSize: 11 }} />
            {t('Last update')}: {lastUpdate} — {t('Auto-refresh every 30s')}
          </div>
        </div>

        <Row gutter={16} style={{ marginBottom: 16 }}>
          {statCards.map((s, i) => (
            <Col span={8} key={i}>
              <Card bordered={false} bodyStyle={{ padding: '16px 20px' }}
                style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)', borderTop: `3px solid ${s.color}` }}>
                <div style={{ fontSize: 12, color: COLOR.textCaption, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.icon} {s.label}
                </div>
                <div style={{ fontSize: 26, fontWeight: 600, color: s.color, lineHeight: 1.2, marginBottom: 4 }}>
                  {s.precision === 0 ? s.value.toFixed(0) : s.value.toFixed(s.precision)}
                  <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 4 }}>{s.suffix}</span>
                </div>
                <div style={{ fontSize: 12, color: COLOR.textCaption }}>{s.instance}</div>
              </Card>
            </Col>
          ))}
        </Row>

        <Card bordered={false} bodyStyle={{ padding: 0 }}
          style={{ background: COLOR.bgCard, borderRadius: 4, boxShadow: '0 2px 6px rgba(36,46,66,0.06)' }}>
          <Tabs defaultActiveKey="cpu" style={{ padding: '0 20px' }}
            tabBarStyle={{ marginBottom: 0, borderBottom: `1px solid ${COLOR.border}` }}>
            <TabPane tab={<span style={{ fontSize: 13 }}><RiseOutlined /> {t('By CPU')}</span>} key="cpu">
              <Table dataSource={data.by_cpu} columns={this.cpuColumns()} rowKey="domain" pagination={false} size="middle" />
            </TabPane>
            <TabPane tab={<span style={{ fontSize: 13 }}><DatabaseOutlined /> {t('By Memory')}</span>} key="memory">
              <Table dataSource={data.by_memory} columns={this.memoryColumns()} rowKey="domain" pagination={false} size="middle" />
            </TabPane>
            <TabPane tab={<span style={{ fontSize: 13 }}><WifiOutlined /> {t('By Network')}</span>} key="network">
              <Table dataSource={data.by_network} columns={this.networkColumns()} rowKey="domain" pagination={false} size="middle" />
            </TabPane>
          </Tabs>
        </Card>

        <div style={{ marginTop: 12, fontSize: 12, color: COLOR.textCaption, textAlign: 'right' }}>
          {data.total_vms} {t('instances monitored')}
        </div>
      </div>
    );
  }
}