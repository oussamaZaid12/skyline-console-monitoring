// Alerts — Dashboard de gestion des règles d'alerting et notifications
// Author: Oussama Zaied - ESPRIT

import React, { Component } from 'react';
import {
  Table,
  Card,
  Row,
  Col,
  Button,
  Form,
  Switch,
  Tag,
  notification,
  Select,
  InputNumber,
  Input,
  Empty,
} from 'antd';
import {
  BellOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';

const { Option } = Select;

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

const METRICS = [
  { value: 'cpu', label: 'CPU (%)' },
  { value: 'ram', label: 'RAM (MB)' },
  { value: 'disk_read', label: 'Disk Read (MB/s)' },
  { value: 'disk_write', label: 'Disk Write (MB/s)' },
  { value: 'net_in', label: 'Network In (MB/s)' },
  { value: 'net_out', label: 'Network Out (MB/s)' },
];

const ACTION_CATEGORIES = [
  { value: 'compute', label: 'Compute (Nova)' },
  { value: 'network', label: 'Réseau (Neutron)' },
  { value: 'storage', label: 'Stockage (Cinder)' },
  { value: 'loadbalancer', label: 'Load Balancer (Octavia)' },
];

const ACTION_TYPES = {
  compute: [
    { value: 'scale_up', label: 'Scale Up — augmenter le flavor' },
    { value: 'scale_down', label: 'Scale Down — réduire le flavor' },
    { value: 'reboot', label: 'Reboot' },
    { value: 'suspend', label: 'Suspend' },
    { value: 'snapshot', label: 'Snapshot' },
  ],
  network: [
    { value: 'add_firewall_rule', label: 'Ajouter une règle firewall' },
    { value: 'reassign_floating_ip', label: 'Réassigner une floating IP' },
  ],
  storage: [
    { value: 'extend_volume', label: 'Extend volume (+X GB)' },
    { value: 'backup_volume', label: 'Backup volume' },
  ],
  loadbalancer: [
    { value: 'lb_add_member', label: 'Ajouter un member au pool' },
    { value: 'lb_remove_member', label: 'Retirer un member du pool' },
  ],
};

const DELAY_OPTIONS = [
  { value: 0, label: 'Immédiat' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
];

const ACTION_STATUS_COLORS = {
  pending: 'default',
  awaiting_confirmation: 'orange',
  scheduled: 'blue',
  executing: 'processing',
  success: 'green',
  failed: 'red',
  cancelled: 'default',
};

export default class Alerts extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      instances: [],
      rules: [],
      history: [],
      activeAlerts: [],
      activeCount: 0,
      actionLogs: [],
      showForm: false,
      editingRule: null,
      notifyEmail: false,
      notifyWebhook: false,
      actionEnabled: false,
      actionCategory: 'compute',
      actionType: 'scale_up',
      actionRequireConfirmation: false,
      flavors: [],
      loadingFlavors: false,
      lastUpdate: null,
    };
    this.refreshInterval = null;
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchAll(false);
    this.refreshInterval = setInterval(() => this.fetchAll(true), 30000);
  }

  componentWillUnmount() {
    clearInterval(this.refreshInterval);
  }

  apiFetch = async (path, options = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  fetchInstances = async () => {
    try {
      const res = await fetch(`${API_BASE}/vm-ranking`);
      if (!res.ok) return;
      const data = await res.json();
      const all = [
        ...(data.by_cpu || []),
        ...(data.by_memory || []),
        ...(data.by_network || []),
      ]
        .filter((vm) => vm.uuid)
        .reduce((acc, vm) => {
          if (!acc.find((v) => v.uuid === vm.uuid))
            acc.push({ uuid: vm.uuid, name: vm.name });
          return acc;
        }, []);
      this.setState({ instances: all });
    } catch (e) {
      console.error('[Alerts] fetchInstances:', e);
    }
  };

  fetchRules = async () => {
    try {
      const data = await this.apiFetch('/alerts/rules');
      this.setState({ rules: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error('[Alerts] fetchRules:', e);
    }
  };

  fetchHistory = async () => {
    try {
      const data = await this.apiFetch('/alerts/history');
      this.setState({ history: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error('[Alerts] fetchHistory:', e);
    }
  };

  fetchActive = async (showToast) => {
    try {
      const data = await this.apiFetch('/alerts/active');
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      const count = data.count || 0;
      if (showToast && count > this.state.activeCount && alerts.length) {
        alerts.slice(0, 3).forEach((a) => {
          notification.warning({
            message: `${t('Alert')}: ${a.rule_name}`,
            description: `VM: ${a.instance_name} — ${a.metric}: ${a.value}`,
            placement: 'topRight',
            duration: 8,
          });
        });
      }
      this.setState({ activeAlerts: alerts, activeCount: count });
    } catch (e) {
      console.error('[Alerts] fetchActive:', e);
    }
  };

  fetchActionLogs = async () => {
    try {
      const data = await this.apiFetch('/alerts/actions/logs');
      this.setState({ actionLogs: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error('[Alerts] fetchActionLogs:', e);
    }
  };

  fetchAll = async (showToast) => {
    this.setState({ loading: true });
    await Promise.all([
      this.fetchInstances(),
      this.fetchRules(),
      this.fetchHistory(),
      this.fetchActive(showToast),
      this.fetchActionLogs(),
    ]);
    this.setState({
      loading: false,
      lastUpdate: new Date().toLocaleTimeString(),
    });
  };

  openCreateForm = () => {
    this.setState(
      {
        editingRule: null,
        notifyEmail: false,
        notifyWebhook: false,
        actionEnabled: false,
        actionCategory: 'compute',
        actionType: 'scale_up',
        actionRequireConfirmation: false,
        flavors: [],
        showForm: true,
      },
      () => {
        if (this.formRef.current) this.formRef.current.resetFields();
      }
    );
  };

  openEditForm = (rule) => {
    const action = rule.action;
    this.setState(
      {
        editingRule: rule,
        notifyEmail: rule.notify_email,
        notifyWebhook: rule.notify_webhook,
        actionEnabled: !!action,
        actionCategory: action ? action.category : 'compute',
        actionType: action ? action.action_type : 'scale_up',
        actionRequireConfirmation: action ? action.require_confirmation : false,
        flavors: [],
        showForm: true,
      },
      () => {
        if (this.formRef.current) {
          this.formRef.current.setFieldsValue({
            ...rule,
            action: action
              ? {
                  category: action.category,
                  action_type: action.action_type,
                  params: action.params || {},
                  delay_seconds: action.delay_seconds,
                  cooldown_seconds: action.cooldown_seconds,
                  require_confirmation: action.require_confirmation,
                  confirmation_email: action.confirmation_email,
                }
              : undefined,
          });
          if (
            action &&
            action.category === 'compute' &&
            ['scale_up', 'scale_down'].includes(action.action_type)
          ) {
            this.maybeFetchFlavors();
          }
        }
      }
    );
  };

  closeForm = () => {
    this.setState({ showForm: false, editingRule: null, actionEnabled: false });
  };

  maybeFetchFlavors = async () => {
    const instanceId = this.formRef.current
      ? this.formRef.current.getFieldValue('instance_id')
      : null;
    if (!instanceId || instanceId === 'all') {
      this.setState({ flavors: [] });
      return;
    }
    this.setState({ loadingFlavors: true });
    try {
      const data = await this.apiFetch(
        `/alerts/actions/flavors?instance_id=${instanceId}`
      );
      this.setState({ flavors: data.flavors || [], loadingFlavors: false });
    } catch (e) {
      this.setState({ flavors: [], loadingFlavors: false });
    }
  };

  handleInstanceChange = () => {
    const { actionEnabled, actionCategory, actionType } = this.state;
    if (
      actionEnabled &&
      actionCategory === 'compute' &&
      ['scale_up', 'scale_down'].includes(actionType)
    ) {
      this.maybeFetchFlavors();
    }
  };

  handleActionEnabledChange = (checked) => {
    this.setState({ actionEnabled: checked });
    const { actionCategory, actionType } = this.state;
    if (
      checked &&
      actionCategory === 'compute' &&
      ['scale_up', 'scale_down'].includes(actionType)
    ) {
      this.maybeFetchFlavors();
    }
  };

  handleActionCategoryChange = (val) => {
    const defaultType = ACTION_TYPES[val][0].value;
    this.setState({ actionCategory: val, actionType: defaultType });
    if (this.formRef.current) {
      this.formRef.current.setFieldsValue({
        action: { action_type: defaultType, params: {} },
      });
    }
    if (val === 'compute' && ['scale_up', 'scale_down'].includes(defaultType)) {
      this.maybeFetchFlavors();
    }
  };

  handleActionTypeChange = (val) => {
    this.setState({ actionType: val });
    if (this.formRef.current) {
      this.formRef.current.setFieldsValue({ action: { params: {} } });
    }
    if (
      this.state.actionCategory === 'compute' &&
      ['scale_up', 'scale_down'].includes(val)
    ) {
      this.maybeFetchFlavors();
    }
  };

  handleSave = async () => {
    const { instances, editingRule, actionEnabled } = this.state;
    try {
      const values = await this.formRef.current.validateFields();
      if (values.instance_id !== 'all') {
        const found = instances.find((i) => i.uuid === values.instance_id);
        values.instance_name = found ? found.name : values.instance_id;
      } else {
        values.instance_name = t('All instances');
      }

      if (!actionEnabled) {
        values.action = null;
      }

      if (editingRule) {
        await this.apiFetch(`/alerts/rules/${editingRule.id}`, {
          method: 'PUT',
          body: JSON.stringify(values),
        });
      } else {
        await this.apiFetch('/alerts/rules', {
          method: 'POST',
          body: JSON.stringify(values),
        });
      }
      this.setState({
        showForm: false,
        editingRule: null,
        notifyEmail: false,
        notifyWebhook: false,
        actionEnabled: false,
      });
      this.fetchRules();
      notification.success({
        message: editingRule ? t('Rule updated') : t('Rule created'),
        duration: 3,
      });
    } catch (e) {
      if (e.errorFields) return;
      notification.error({
        message: t('Error'),
        description: String(e),
        duration: 5,
      });
    }
  };

  handleDelete = async (id) => {
    await this.apiFetch(`/alerts/rules/${id}`, { method: 'DELETE' });
    this.fetchRules();
  };

  handleToggle = async (id) => {
    await this.apiFetch(`/alerts/rules/${id}/toggle`, { method: 'PATCH' });
    this.fetchRules();
  };

  handleResolve = async (eventId) => {
    await this.apiFetch(`/alerts/events/${eventId}/resolve`, {
      method: 'POST',
    });
    this.fetchHistory();
    this.fetchActive(false);
  };

  handleDeleteEvent = async (eventId) => {
    await this.apiFetch(`/alerts/events/${eventId}`, { method: 'DELETE' });
    this.fetchHistory();
    this.fetchActive(false);
  };

  handleDeleteActionLog = async (logId) => {
    await this.apiFetch(`/alerts/actions/logs/${logId}`, { method: 'DELETE' });
    this.fetchActionLogs();
  };

  metricLabel = (m) => (METRICS.find((x) => x.value === m) || {}).label || m;

  rulesColumns = () => [
    { title: t('Name'), dataIndex: 'name', key: 'name' },
    { title: t('Instance'), dataIndex: 'instance_name', key: 'vm' },
    {
      title: t('Metric'),
      dataIndex: 'metric',
      key: 'metric',
      render: this.metricLabel,
    },
    {
      title: t('Condition'),
      key: 'cond',
      render: (_, r) => `${r.operator === 'gt' ? '>' : '<'} ${r.threshold}`,
    },
    {
      title: t('Notifications'),
      key: 'notifs',
      render: (_, r) => (
        <span>
          {r.notify_ui ? <Tag color="blue">UI</Tag> : null}
          {r.notify_email ? <Tag color="orange">Email</Tag> : null}
          {r.notify_webhook ? <Tag color="green">Webhook</Tag> : null}
        </span>
      ),
    },
    {
      title: t('Active'),
      key: 'active',
      width: 90,
      render: (_, r) => (
        <Switch
          checked={r.is_active}
          onChange={() => this.handleToggle(r.id)}
        />
      ),
    },
    {
      title: t('Actions'),
      key: 'actions',
      width: 100,
      render: (_, r) => (
        <span style={{ display: 'flex', gap: 8 }}>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => this.openEditForm(r)}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={() => this.handleDelete(r.id)}
          />
        </span>
      ),
    },
  ];

  historyColumns = () => [
    {
      title: '',
      key: 'delete',
      width: 48,
      render: (_, r) => (
        <Button
          size="small"
          icon={<DeleteOutlined />}
          danger
          onClick={() => this.handleDeleteEvent(r.id)}
        />
      ),
    },
    { title: t('Alert'), dataIndex: 'rule_name', key: 'name' },
    { title: t('Instance'), dataIndex: 'instance_name', key: 'vm' },
    {
      title: t('Metric'),
      dataIndex: 'metric',
      key: 'metric',
      render: this.metricLabel,
    },
    {
      title: t('Value'),
      dataIndex: 'value',
      key: 'value',
      render: (v, r) => (
        <span
          style={{
            color: r.is_resolved ? 'inherit' : COLOR.danger,
            fontWeight: 600,
          }}
        >
          {v}
        </span>
      ),
    },
    { title: t('Threshold'), dataIndex: 'threshold', key: 'threshold' },
    {
      title: t('Triggered at'),
      dataIndex: 'triggered_at',
      key: 'triggered_at',
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      title: t('Status'),
      key: 'status',
      render: (_, r) =>
        r.is_resolved ? (
          <Tag color="green">{t('Resolved')}</Tag>
        ) : (
          <Tag color="red">{t('Active')}</Tag>
        ),
    },
    {
      title: '',
      key: 'resolve',
      render: (_, r) =>
        !r.is_resolved ? (
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={() => this.handleResolve(r.id)}
          >
            {t('Resolve')}
          </Button>
        ) : null,
    },
  ];

  activeColumns = () => [
    { title: t('Alert'), dataIndex: 'rule_name', key: 'name' },
    { title: t('Instance'), dataIndex: 'instance_name', key: 'vm' },
    {
      title: t('Metric'),
      dataIndex: 'metric',
      key: 'metric',
      render: this.metricLabel,
    },
    {
      title: t('Value'),
      key: 'value',
      render: (_, r) => (
        <span style={{ color: COLOR.danger, fontWeight: 600 }}>
          {r.value}{' '}
          <span style={{ color: COLOR.textCaption, fontWeight: 400 }}>
            / {r.threshold}
          </span>
        </span>
      ),
    },
    {
      title: t('Triggered at'),
      dataIndex: 'triggered_at',
      key: 'triggered_at',
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      title: '',
      key: 'resolve',
      render: (_, r) => (
        <Button
          size="small"
          type="primary"
          ghost
          icon={<CheckCircleOutlined />}
          onClick={() => this.handleResolve(r.id)}
        >
          {t('Resolve')}
        </Button>
      ),
    },
  ];

  actionLogColumns = () => [
    {
      title: '',
      key: 'delete',
      width: 48,
      render: (_, r) => (
        <Button
          size="small"
          icon={<DeleteOutlined />}
          danger
          onClick={() => this.handleDeleteActionLog(r.id)}
        />
      ),
    },
    {
      title: t('Date'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val).toLocaleString(),
    },
    { title: t('Alert'), dataIndex: 'rule_name', key: 'rule_name' },
    { title: t('Instance'), dataIndex: 'instance_name', key: 'instance_name' },
    {
      title: t('Action'),
      key: 'action',
      render: (_, r) => {
        const cat =
          (ACTION_CATEGORIES.find((c) => c.value === r.category) || {}).label ||
          r.category;
        const act = (ACTION_TYPES[r.category] || []).find(
          (a) => a.value === r.action_type
        );
        return `${cat} — ${act ? act.label : r.action_type}`;
      },
    },
    {
      title: t('Status'),
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (val) => (
        <Tag color={ACTION_STATUS_COLORS[val] || 'default'}>{val}</Tag>
      ),
    },
    {
      title: t('Result'),
      dataIndex: 'result_message',
      key: 'result_message',
      render: (val) => val || '-',
    },
  ];

  render() {
    const {
      loading,
      rules,
      history,
      activeAlerts,
      activeCount,
      actionLogs,
      showForm,
      editingRule,
      notifyEmail,
      notifyWebhook,
      lastUpdate,
      instances,
      actionEnabled,
      actionCategory,
      actionType,
      actionRequireConfirmation,
      flavors,
      loadingFlavors,
    } = this.state;

    const activeRulesCount = rules.filter((r) => r.is_active).length;

    const statCards = [
      {
        label: t('Active Alerts'),
        icon: <WarningOutlined />,
        value: activeCount,
        color: activeCount > 0 ? COLOR.danger : COLOR.success,
      },
      {
        label: t('Alert Rules'),
        icon: <BellOutlined />,
        value: rules.length,
        color: COLOR.primary,
      },
      {
        label: t('Active Rules'),
        icon: <CheckCircleOutlined />,
        value: activeRulesCount,
        color: COLOR.purple,
      },
    ];

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
              {t('Alerts')}
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
          <div
            style={{
              fontSize: 12,
              color: COLOR.textCaption,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
            onClick={() => this.fetchAll(false)}
          >
            <ReloadOutlined spin={loading} style={{ fontSize: 11 }} />
            {t('Last update')}: {lastUpdate} — {t('Auto-refresh every 30s')}
          </div>
        </div>

        {/* Stat Cards */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {statCards.map((s, i) => (
            <Col span={8} key={i}>
              <Card
                bordered={false}
                bodyStyle={{ padding: '16px 20px' }}
                style={{
                  background: COLOR.bgCard,
                  borderRadius: 4,
                  boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
                  borderTop: `3px solid ${s.color}`,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: COLOR.textCaption,
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {s.icon} {s.label}
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: s.color,
                    lineHeight: 1.2,
                  }}
                >
                  {s.value}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        {/* Active alerts */}
        {activeAlerts.length > 0 && (
          <Card
            title={
              <span>
                <WarningOutlined
                  style={{ color: COLOR.danger, marginRight: 8 }}
                />
                {t('Active Alerts')}
              </span>
            }
            bordered={false}
            bodyStyle={{ padding: 0 }}
            style={{
              marginBottom: 16,
              background: COLOR.bgCard,
              borderRadius: 4,
              boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
            }}
          >
            <Table
              dataSource={activeAlerts}
              columns={this.activeColumns()}
              rowKey="id"
              pagination={false}
              size="middle"
            />
          </Card>
        )}

        {/* Rules */}
        <Card
          title={t('Alert Rules')}
          extra={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{
                backgroundColor: COLOR.primary,
                borderColor: COLOR.primary,
              }}
              onClick={this.openCreateForm}
            >
              {t('New Rule')}
            </Button>
          }
          bordered={false}
          style={{
            marginBottom: 16,
            background: COLOR.bgCard,
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
          }}
        >
          {showForm && (
            <div
              style={{
                background: '#f5f7fa',
                border: '1px solid #e0e4ef',
                borderRadius: 8,
                padding: '16px 20px',
                marginBottom: 16,
              }}
            >
              <Form
                ref={this.formRef}
                layout="vertical"
                onFinish={this.handleSave}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr',
                    gap: 12,
                  }}
                >
                  <Form.Item
                    name="name"
                    label={t('Name')}
                    rules={[{ required: true, message: t('Required') }]}
                  >
                    <Input placeholder={t('e.g. High CPU prod-01')} />
                  </Form.Item>
                  <Form.Item
                    name="instance_id"
                    label={t('Target Instance')}
                    initialValue="all"
                    rules={[{ required: true }]}
                  >
                    <Select onChange={this.handleInstanceChange}>
                      <Option value="all">{t('All instances')}</Option>
                      {instances.map((i) => (
                        <Option key={i.uuid} value={i.uuid}>
                          {i.name}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item
                    name="metric"
                    label={t('Metric')}
                    initialValue="cpu"
                    rules={[{ required: true }]}
                  >
                    <Select>
                      {METRICS.map((m) => (
                        <Option key={m.value} value={m.value}>
                          {m.label}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item
                    name="operator"
                    label={t('Condition')}
                    initialValue="gt"
                  >
                    <Select>
                      <Option value="gt">&gt;</Option>
                      <Option value="lt">&lt;</Option>
                    </Select>
                  </Form.Item>
                  <Form.Item
                    name="threshold"
                    label={t('Threshold')}
                    rules={[{ required: true, message: t('Required') }]}
                  >
                    <InputNumber style={{ width: '100%' }} placeholder="80" />
                  </Form.Item>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  <Form.Item
                    name="notify_ui"
                    label="UI"
                    valuePropName="checked"
                    initialValue
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="notify_email"
                    label="Email"
                    valuePropName="checked"
                    initialValue={false}
                  >
                    <Switch
                      onChange={(v) => this.setState({ notifyEmail: v })}
                    />
                  </Form.Item>
                  <Form.Item
                    name="notify_webhook"
                    label="Webhook"
                    valuePropName="checked"
                    initialValue={false}
                  >
                    <Switch
                      onChange={(v) => this.setState({ notifyWebhook: v })}
                    />
                  </Form.Item>
                </div>

                {notifyEmail && (
                  <Form.Item
                    name="email_address"
                    label={t('Notification email')}
                    rules={[{ type: 'email', message: t('Invalid email') }]}
                  >
                    <Input placeholder="admin@example.com" />
                  </Form.Item>
                )}
                {notifyWebhook && (
                  <Form.Item
                    name="webhook_url"
                    label={t('Webhook URL (Slack/Teams)')}
                  >
                    <Input placeholder="https://hooks.slack.com/services/..." />
                  </Form.Item>
                )}

                {/* Actions automatiques (avancé) */}
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px dashed ${COLOR.border}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: actionEnabled ? 12 : 0,
                    }}
                  >
                    <Switch
                      checked={actionEnabled}
                      onChange={this.handleActionEnabledChange}
                    />
                    <span style={{ fontWeight: 500, color: COLOR.textTitle }}>
                      {t('Automatic action (advanced)')}
                    </span>
                  </div>

                  {actionEnabled && (
                    <div
                      style={{
                        background: '#fff',
                        border: `1px solid ${COLOR.border}`,
                        borderRadius: 6,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 12,
                        }}
                      >
                        <Form.Item
                          name={['action', 'category']}
                          label={t('Category')}
                          initialValue="compute"
                        >
                          <Select onChange={this.handleActionCategoryChange}>
                            {ACTION_CATEGORIES.map((c) => (
                              <Option key={c.value} value={c.value}>
                                {c.label}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item
                          name={['action', 'action_type']}
                          label={t('Action')}
                          initialValue="scale_up"
                        >
                          <Select onChange={this.handleActionTypeChange}>
                            {(ACTION_TYPES[actionCategory] || []).map((a) => (
                              <Option key={a.value} value={a.value}>
                                {a.label}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </div>

                      {/* Compute */}
                      {actionCategory === 'compute' &&
                        ['scale_up', 'scale_down'].includes(actionType) && (
                          <Form.Item
                            name={['action', 'params', 'target_flavor_id']}
                            label={t('Target flavor')}
                            rules={[{ required: true, message: t('Required') }]}
                          >
                            <Select
                              loading={loadingFlavors}
                              placeholder={t('Select a flavor')}
                              notFoundContent={t(
                                'Select a target instance first'
                              )}
                            >
                              {flavors.map((f) => (
                                <Option key={f.id} value={f.id}>
                                  {`${f.name} (${f.vcpus} vCPU, ${f.ram} MB RAM, ${f.disk} GB)`}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                        )}
                      {actionCategory === 'compute' && actionType === 'reboot' && (
                        <Form.Item
                          name={['action', 'params', 'reboot_type']}
                          label={t('Reboot type')}
                          initialValue="soft"
                        >
                          <Select>
                            <Option value="soft">Soft</Option>
                            <Option value="hard">Hard</Option>
                          </Select>
                        </Form.Item>
                      )}

                      {/* Network */}
                      {actionCategory === 'network' &&
                        actionType === 'add_firewall_rule' && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(4, 1fr)',
                              gap: 12,
                            }}
                          >
                            <Form.Item
                              name={['action', 'params', 'protocol']}
                              label={t('Protocol')}
                              initialValue="tcp"
                            >
                              <Select>
                                <Option value="tcp">TCP</Option>
                                <Option value="udp">UDP</Option>
                                <Option value="icmp">ICMP</Option>
                              </Select>
                            </Form.Item>
                            <Form.Item
                              name={['action', 'params', 'port_range']}
                              label={t('Port / Range')}
                            >
                              <Input placeholder="80 ou 1000-2000" />
                            </Form.Item>
                            <Form.Item
                              name={['action', 'params', 'direction']}
                              label={t('Direction')}
                              initialValue="ingress"
                            >
                              <Select>
                                <Option value="ingress">Ingress</Option>
                                <Option value="egress">Egress</Option>
                              </Select>
                            </Form.Item>
                            <Form.Item
                              name={['action', 'params', 'rule_action']}
                              label={t('Rule action')}
                              initialValue="block"
                            >
                              <Select>
                                <Option value="block">{t('Block')}</Option>
                                <Option value="limit">{t('Limit')}</Option>
                              </Select>
                            </Form.Item>
                          </div>
                        )}
                      {actionCategory === 'network' &&
                        actionType === 'reassign_floating_ip' && (
                          <Form.Item
                            name={['action', 'params', 'floating_ip']}
                            label={t('Floating IP')}
                          >
                            <Input placeholder="203.0.113.10" />
                          </Form.Item>
                        )}

                      {/* Storage */}
                      {actionCategory === 'storage' &&
                        actionType === 'extend_volume' && (
                          <Form.Item
                            name={['action', 'params', 'size_gb']}
                            label={t('Size to add (GB)')}
                            rules={[{ required: true, message: t('Required') }]}
                          >
                            <InputNumber
                              style={{ width: '100%' }}
                              min={1}
                              placeholder="10"
                            />
                          </Form.Item>
                        )}

                      {/* Load Balancer */}
                      {actionCategory === 'loadbalancer' && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 12,
                          }}
                        >
                          <Form.Item
                            name={['action', 'params', 'pool_id']}
                            label={t('Load balancer pool')}
                          >
                            <Input placeholder={t('Pool ID')} />
                          </Form.Item>
                          <Form.Item
                            name={['action', 'params', 'member_instance_id']}
                            label={t('VM to add/remove')}
                          >
                            <Select>
                              {instances.map((i) => (
                                <Option key={i.uuid} value={i.uuid}>
                                  {i.name}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                        </div>
                      )}

                      {/* Config générale */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: 12,
                          marginTop: 4,
                        }}
                      >
                        <Form.Item
                          name={['action', 'delay_seconds']}
                          label={t('Delay before execution')}
                          initialValue={0}
                        >
                          <Select>
                            {DELAY_OPTIONS.map((d) => (
                              <Option key={d.value} value={d.value}>
                                {d.label}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item
                          name={['action', 'cooldown_seconds']}
                          label={t('Cooldown (seconds)')}
                          initialValue={600}
                        >
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item
                          name={['action', 'require_confirmation']}
                          label={t('Manual confirmation')}
                          valuePropName="checked"
                          initialValue={false}
                        >
                          <Switch
                            onChange={(v) =>
                              this.setState({ actionRequireConfirmation: v })
                            }
                          />
                        </Form.Item>
                      </div>

                      {actionRequireConfirmation && (
                        <Form.Item
                          name={['action', 'confirmation_email']}
                          label={t('Confirmation email')}
                          rules={[
                            { type: 'email', message: t('Invalid email') },
                          ]}
                        >
                          <Input placeholder="admin@example.com" />
                        </Form.Item>
                      )}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                    marginTop: 8,
                  }}
                >
                  <Button onClick={this.closeForm}>{t('Cancel')}</Button>
                  <Button
                    type="primary"
                    htmlType="submit"
                    style={{
                      backgroundColor: COLOR.primary,
                      borderColor: COLOR.primary,
                    }}
                  >
                    {editingRule ? t('Update') : t('Create Rule')}
                  </Button>
                </div>
              </Form>
            </div>
          )}

          <Table
            dataSource={rules}
            columns={this.rulesColumns()}
            rowKey="id"
            size="middle"
            pagination={false}
            locale={{
              emptyText: (
                <Empty
                  description={t(
                    'No rules yet. Click "New Rule" to create one.'
                  )}
                />
              ),
            }}
          />
        </Card>

        {/* History */}
        <Card
          title={t('Alert History')}
          bordered={false}
          style={{
            background: COLOR.bgCard,
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
          }}
        >
          <Table
            dataSource={history}
            columns={this.historyColumns()}
            rowKey="id"
            size="middle"
            pagination={{ pageSize: 10 }}
            locale={{
              emptyText: <Empty description={t('No alerts triggered yet.')} />,
            }}
          />
        </Card>

        {/* Action Logs */}
        <Card
          title={t('Action Log')}
          bordered={false}
          style={{
            marginTop: 16,
            background: COLOR.bgCard,
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
          }}
        >
          <Table
            dataSource={actionLogs}
            columns={this.actionLogColumns()}
            rowKey="id"
            size="middle"
            pagination={{ pageSize: 10 }}
            locale={{
              emptyText: (
                <Empty description={t('No automatic actions triggered yet.')} />
              ),
            }}
          />
        </Card>
      </div>
    );
  }
}
