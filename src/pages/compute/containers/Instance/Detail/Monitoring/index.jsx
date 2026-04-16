import React, { Component } from 'react';
import { inject, observer } from 'mobx-react';
import { Card, Row, Col, Statistic, Spin, Alert } from 'antd';
import { Chart, Line, Axis, Tooltip } from 'bizcharts';

@inject('rootStore')
@observer
export default class Monitoring extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      metrics: null,
      cpuData: [],
      memoryData: [],
    };
    this.refreshInterval = null;
  }

  componentDidMount() {
    this.fetchMetrics();
    this.refreshInterval = setInterval(this.fetchMetrics, 30000);
  }

  componentWillUnmount() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  fetchMetrics = async () => {
    const { detail } = this.props;
    try {
      const response = await fetch(
        `/api/openstack/skyline/api/v1/instances/${detail.id}/metrics`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const now = new Date();
      const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(
        2,
        '0'
      )}:${String(now.getSeconds()).padStart(2, '0')}`;
      this.setState((prev) => ({
        loading: false,
        error: null,
        metrics: data,
        cpuData: [
          ...prev.cpuData.slice(-29),
          { time: timeStr, value: data.cpu_percent },
        ],
        memoryData: [
          ...prev.memoryData.slice(-29),
          { time: timeStr, value: data.memory_mb },
        ],
      }));
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  };

  render() {
    const { loading, error, metrics, cpuData, memoryData } = this.state;
    const { detail } = this.props;

    if (loading && !metrics)
      return (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      );

    if (error)
      return (
        <Alert message={t('Error')} description={error} type="error" showIcon />
      );

    if (!metrics) return null;

    return (
      <div style={{ padding: 24 }}>
        <h2>
          {t('Instance Monitoring')} — {detail.name}
        </h2>
        <p style={{ color: '#666', marginBottom: 24 }}>
          {t('Auto-refresh every 30 seconds')}
        </p>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic
                title={t('CPU Usage')}
                value={metrics.cpu_percent}
                precision={1}
                suffix="%"
                valueStyle={{
                  color: metrics.cpu_percent > 80 ? '#cf1322' : '#3f8600',
                }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title={t('Memory')}
                value={metrics.memory_mb}
                precision={0}
                suffix="MB"
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title={t('Disk Write')}
                value={(metrics.disk_write_bytes_per_sec / 1024).toFixed(1)}
                suffix="KB/s"
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title={t('Network TX')}
                value={(metrics.network_tx_bytes_per_sec / 1024).toFixed(1)}
                suffix="KB/s"
                valueStyle={{ color: '#eb2f96' }}
              />
            </Card>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Card title={t('CPU Usage (%)')}>
              <Chart height={200} data={cpuData} autoFit>
                <Axis name="time" />
                <Axis name="value" min={0} max={100} />
                <Tooltip />
                <Line position="time*value" color="#1890ff" />
              </Chart>
            </Card>
          </Col>
          <Col span={12}>
            <Card title={t('Memory Usage (MB)')}>
              <Chart height={200} data={memoryData} autoFit>
                <Axis name="time" />
                <Axis name="value" />
                <Tooltip />
                <Line position="time*value" color="#52c41a" />
              </Chart>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }
}
