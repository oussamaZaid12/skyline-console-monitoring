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
  Popconfirm,
} from 'antd';
import {
  BellOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
  SearchOutlined,
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
    { value: 'apply_security_group', label: 'Apply a security group' },
    { value: 'reassign_floating_ip', label: 'Réassigner une floating IP' },
  ],
  storage: [
    { value: 'extend_volume', label: 'Extend volume (+X GB)' },
    { value: 'backup_volume', label: 'Backup volume' },
  ],
};

const DELAY_OPTIONS = [
  { value: 0, label: 'Immédiat' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
];

const OPERATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
];

const OPERATOR_SYMBOLS = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

// Durée pendant laquelle la condition doit rester vraie en continu avant que
// l'alerte ne se déclenche (évite de réagir à un simple pic ponctuel).
const DURATION_OPTIONS = [
  { value: 0, label: 'Immédiat' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
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
      currentFlavorId: null,
      loadingFlavors: false,
      volumes: [],
      loadingVolumes: false,
      securityGroups: [],
      loadingSecurityGroups: false,
      actionLogSearch: '',
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
      // Endpoint scopé au projet de l'utilisateur connecté (jamais les VM
      // d'un autre projet) — distinct de /vm-ranking qui sert au classement.
      const res = await fetch(`${API_BASE}/alerts/my-instances`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      this.setState({ instances: Array.isArray(data) ? data : [] });
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
        currentFlavorId: null,
        volumes: [],
        showForm: true,
      },
      () => {
        if (this.formRef.current) this.formRef.current.resetFields();
      }
    );
  };

  openEditForm = (rule) => {
    const { action } = rule;
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
        currentFlavorId: null,
        volumes: [],
        showForm: true,
      },
      () => {
        if (this.formRef.current) {
          // Compatibilité avec les anciens formats enregistrés avant le passage
          // à une taille indépendante par volume (params.volumes = [{volume_id,
          // size_gb}, ...]) : un seul volume (volume_id + size_gb), ou plusieurs
          // volumes partageant la même taille (volume_ids + size_gb).
          let params = action ? { ...(action.params || {}) } : {};
          if (!params.volumes) {
            if (params.volume_ids) {
              params = {
                ...params,
                volumes: params.volume_ids.map((id) => ({
                  volume_id: id,
                  size_gb: params.size_gb,
                })),
              };
            } else if (params.volume_id) {
              params = {
                ...params,
                volumes: [
                  { volume_id: params.volume_id, size_gb: params.size_gb },
                ],
              };
            }
          }
          this.formRef.current.setFieldsValue({
            ...rule,
            action: action
              ? {
                  category: action.category,
                  action_type: action.action_type,
                  params,
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
          if (
            action &&
            action.category === 'storage' &&
            action.action_type === 'extend_volume'
          ) {
            this.maybeFetchVolumes();
          }
          if (
            action &&
            action.category === 'network' &&
            action.action_type === 'apply_security_group'
          ) {
            this.maybeFetchSecurityGroups();
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
      this.setState({ flavors: [], currentFlavorId: null });
      return;
    }
    this.setState({ loadingFlavors: true });
    try {
      const data = await this.apiFetch(
        `/alerts/actions/flavors?instance_id=${instanceId}`
      );
      this.setState({
        flavors: data.flavors || [],
        currentFlavorId: data.current_flavor_id || null,
        loadingFlavors: false,
      });
    } catch (e) {
      this.setState({
        flavors: [],
        currentFlavorId: null,
        loadingFlavors: false,
      });
    }
  };

  maybeFetchVolumes = async () => {
    const instanceId = this.formRef.current
      ? this.formRef.current.getFieldValue('instance_id')
      : null;
    if (!instanceId || instanceId === 'all') {
      this.setState({ volumes: [] });
      return;
    }
    this.setState({ loadingVolumes: true });
    try {
      const data = await this.apiFetch(
        `/alerts/actions/volumes?instance_id=${instanceId}`
      );
      const volumes = data.volumes || [];
      this.setState({ volumes, loadingVolumes: false });
      // Présélectionne une première ligne si la VM n'a qu'un seul volume.
      if (volumes.length === 1 && this.formRef.current) {
        this.formRef.current.setFieldsValue({
          action: { params: { volumes: [{ volume_id: volumes[0].id }] } },
        });
      }
    } catch (e) {
      this.setState({ volumes: [], loadingVolumes: false });
    }
  };

  maybeFetchSecurityGroups = async () => {
    // Les security groups sont listés au niveau du projet (pas par instance),
    // donc pas besoin d'attendre la sélection d'une VM.
    this.setState({ loadingSecurityGroups: true });
    try {
      const data = await this.apiFetch('/alerts/actions/security-groups');
      this.setState({
        securityGroups: data.security_groups || [],
        loadingSecurityGroups: false,
      });
    } catch (e) {
      this.setState({ securityGroups: [], loadingSecurityGroups: false });
    }
  };

  // Ne garde que les flavors réellement sélectionnables pour le sens choisi,
  // afin d'éviter à l'utilisateur de choisir une cible qui sera rejetée par
  // Nova (le disque racine ne peut jamais être réduit, quel que soit le sens)
  // ou qui ne correspond pas au sens demandé (scale up = plus grand, scale
  // down = plus petit, en vCPU/RAM).
  getSelectableFlavors = () => {
    const { flavors, currentFlavorId, actionType } = this.state;
    const current = flavors.find(
      (f) => String(f.id) === String(currentFlavorId)
    );
    if (!current) return flavors;

    return flavors.filter((f) => {
      if (String(f.id) === String(current.id)) return false;
      // Le disque racine ne peut jamais être réduit (limitation Nova) :
      // s'applique dans les deux sens.
      if (f.disk < current.disk) return false;
      if (actionType === 'scale_up') {
        // Doit être réellement plus grand (vCPU ou RAM), pas juste un disque plus grand.
        return f.vcpus > current.vcpus || f.ram > current.ram;
      }
      if (actionType === 'scale_down') {
        return f.vcpus < current.vcpus || f.ram < current.ram;
      }
      return true;
    });
  };

  handleInstanceChange = () => {
    const { actionEnabled, actionCategory, actionType } = this.state;
    if (!actionEnabled) return;
    if (
      actionCategory === 'compute' &&
      ['scale_up', 'scale_down'].includes(actionType)
    ) {
      this.maybeFetchFlavors();
    }
    if (actionCategory === 'storage' && actionType === 'extend_volume') {
      this.maybeFetchVolumes();
    }
  };

  handleActionEnabledChange = (checked) => {
    this.setState({ actionEnabled: checked });
    const { actionCategory, actionType } = this.state;
    if (!checked) return;
    if (
      actionCategory === 'compute' &&
      ['scale_up', 'scale_down'].includes(actionType)
    ) {
      this.maybeFetchFlavors();
    }
    if (actionCategory === 'storage' && actionType === 'extend_volume') {
      this.maybeFetchVolumes();
    }
    if (actionCategory === 'network' && actionType === 'apply_security_group') {
      this.maybeFetchSecurityGroups();
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
    if (val === 'storage' && defaultType === 'extend_volume') {
      this.maybeFetchVolumes();
    }
    if (val === 'network' && defaultType === 'apply_security_group') {
      this.maybeFetchSecurityGroups();
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
    if (this.state.actionCategory === 'storage' && val === 'extend_volume') {
      this.maybeFetchVolumes();
    }
    if (
      this.state.actionCategory === 'network' &&
      val === 'apply_security_group'
    ) {
      this.maybeFetchSecurityGroups();
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

  // Équivalent des liens reçus par email, mais directement depuis l'interface :
  // le client peut confirmer/annuler une action sans avoir à ouvrir sa boîte mail.
  handleConfirmActionLog = async (logId) => {
    try {
      await this.apiFetch(`/alerts/actions/logs/${logId}/confirm`, {
        method: 'POST',
      });
      notification.success({
        message: t('Action confirmed'),
        description: t('The automatic action will be executed shortly.'),
        duration: 4,
      });
      this.fetchActionLogs();
    } catch (e) {
      notification.error({
        message: t('Error'),
        description: String(e),
        duration: 5,
      });
    }
  };

  handleCancelActionLogConfirmation = async (logId) => {
    try {
      await this.apiFetch(`/alerts/actions/logs/${logId}/cancel`, {
        method: 'POST',
      });
      notification.info({
        message: t('Action cancelled'),
        duration: 3,
      });
      this.fetchActionLogs();
    } catch (e) {
      notification.error({
        message: t('Error'),
        description: String(e),
        duration: 5,
      });
    }
  };

  metricLabel = (m) => (METRICS.find((x) => x.value === m) || {}).label || m;

  handleActionLogSearchChange = (e) => {
    this.setState({ actionLogSearch: e.target.value });
  };

  getFilteredActionLogs = () => {
    const { actionLogs, actionLogSearch } = this.state;
    const query = (actionLogSearch || '').trim().toLowerCase();
    if (!query) return actionLogs;
    return actionLogs.filter(
      (r) =>
        (r.rule_name || '').toLowerCase().includes(query) ||
        (r.instance_name || '').toLowerCase().includes(query)
    );
  };

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
      render: (_, r) => {
        const op = OPERATOR_SYMBOLS[r.operator] || '>';
        const duration = r.duration_seconds || 0;
        const durationTxt = duration
          ? ` ${t('for')} ${
              (DURATION_OPTIONS.find((d) => d.value === duration) || {})
                .label || `${duration}s`
            }`
          : '';
        return `${op} ${r.threshold}${durationTxt}`;
      },
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
    {
      title: t('Confirmation'),
      key: 'confirmation',
      width: 190,
      render: (_, r) =>
        r.status === 'awaiting_confirmation' ? (
          <span style={{ display: 'flex', gap: 6 }}>
            <Popconfirm
              title={t('Execute this automatic action now?')}
              okText={t('Confirm')}
              cancelText={t('Cancel')}
              onConfirm={() => this.handleConfirmActionLog(r.id)}
            >
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined />}
                style={{
                  backgroundColor: COLOR.success,
                  borderColor: COLOR.success,
                }}
              >
                {t('Confirm')}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t('Cancel this automatic action?')}
              okText={t('Yes')}
              cancelText={t('No')}
              onConfirm={() => this.handleCancelActionLogConfirmation(r.id)}
            >
              <Button size="small" danger icon={<CloseCircleOutlined />}>
                {t('Cancel')}
              </Button>
            </Popconfirm>
          </span>
        ) : (
          '-'
        ),
    },
  ];

  render() {
    const {
      loading,
      rules,
      history,
      activeAlerts,
      activeCount,
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
      volumes,
      loadingVolumes,
      securityGroups,
      loadingSecurityGroups,
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
                      {OPERATOR_OPTIONS.map((o) => (
                        <Option key={o.value} value={o.value}>
                          {o.label}
                        </Option>
                      ))}
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

                <Form.Item
                  name="duration_seconds"
                  label={t('Trigger only if condition stays true for')}
                  initialValue={60}
                  extra={t(
                    'Avoids reacting to a brief, one-off spike: the condition must remain true continuously for this long before the alert fires. Enter any duration in seconds, or use a shortcut below.'
                  )}
                  style={{ marginBottom: 6 }}
                >
                  <InputNumber
                    min={0}
                    step={1}
                    style={{ width: 220 }}
                    addonAfter={t('seconds')}
                    placeholder="120"
                  />
                </Form.Item>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {DURATION_OPTIONS.map((d) => (
                    <Button
                      key={d.value}
                      size="small"
                      onClick={() =>
                        this.formRef.current &&
                        this.formRef.current.setFieldsValue({
                          duration_seconds: d.value,
                        })
                      }
                    >
                      {d.label}
                    </Button>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 4,
                    paddingTop: 12,
                    borderTop: `1px dashed ${COLOR.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: COLOR.textCaption,
                      marginBottom: 8,
                    }}
                  >
                    {t(
                      'Notifications — the alert always appears in the UI (active alerts list and the menu badge). Optionally, also notify by:'
                    )}
                  </div>
                  <Form.Item name="notify_ui" initialValue hidden>
                    <Switch />
                  </Form.Item>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                      }}
                    >
                      <Form.Item
                        name="notify_email"
                        valuePropName="checked"
                        initialValue={false}
                        style={{ marginBottom: 0 }}
                      >
                        <Switch
                          onChange={(v) => this.setState({ notifyEmail: v })}
                        />
                      </Form.Item>
                      <div>
                        <div style={{ fontWeight: 500 }}>Email</div>
                        <div style={{ fontSize: 11, color: COLOR.textCaption }}>
                          {t(
                            'Receive an email as soon as the alert triggers (even if no one is logged in).'
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                      }}
                    >
                      <Form.Item
                        name="notify_webhook"
                        valuePropName="checked"
                        initialValue={false}
                        style={{ marginBottom: 0 }}
                      >
                        <Switch
                          onChange={(v) => this.setState({ notifyWebhook: v })}
                        />
                      </Form.Item>
                      <div>
                        <div style={{ fontWeight: 500 }}>Webhook</div>
                        <div style={{ fontSize: 11, color: COLOR.textCaption }}>
                          {t(
                            'Send the alert to an external URL (e.g. a Slack, Microsoft Teams or Rocket.Chat channel) to notify a team.'
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
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
                    label={t('Webhook URL (Slack / Teams / Rocket.Chat)')}
                    extra={t(
                      'Works with any service accepting incoming webhooks: Slack, Microsoft Teams, Rocket.Chat, etc.'
                    )}
                  >
                    <Input placeholder="https://chat.example.com/hooks/... or https://hooks.slack.com/services/..." />
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
                            extra={t(
                              'Only flavors actually usable for this direction are listed (Nova never allows shrinking the root disk).'
                            )}
                          >
                            <Select
                              loading={loadingFlavors}
                              placeholder={t('Select a flavor')}
                              notFoundContent={
                                flavors.length
                                  ? t('No eligible flavor for this direction')
                                  : t('Select a target instance first')
                              }
                            >
                              {this.getSelectableFlavors().map((f) => (
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
                        actionType === 'apply_security_group' && (
                          <Form.Item
                            name={['action', 'params', 'security_group_id']}
                            label={t('Security group to apply')}
                            rules={[{ required: true, message: t('Required') }]}
                            extra={t(
                              'The selected security group is added to the VM network ports — existing security groups are kept, rules are additive.'
                            )}
                          >
                            <Select
                              loading={loadingSecurityGroups}
                              placeholder={t('Select a security group')}
                              notFoundContent={t(
                                'No security group found in your project'
                              )}
                            >
                              {securityGroups.map((sg) => (
                                <Option key={sg.id} value={sg.id}>
                                  {sg.description
                                    ? `${sg.name} — ${sg.description}`
                                    : sg.name}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
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
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                color: COLOR.textCaption,
                                marginBottom: 8,
                              }}
                            >
                              {t(
                                'Choose one or more volumes — each one can get its own size to add.'
                              )}
                            </div>
                            <Form.List name={['action', 'params', 'volumes']}>
                              {(fields, { add, remove }) => (
                                <>
                                  {fields.map((field) => (
                                    <Form.Item
                                      shouldUpdate
                                      noStyle
                                      key={field.key}
                                    >
                                      {() => {
                                        const rowVolumes = this.formRef.current
                                          ? this.formRef.current.getFieldValue([
                                              'action',
                                              'params',
                                              'volumes',
                                            ]) || []
                                          : [];
                                        const otherSelectedIds = rowVolumes
                                          .filter((_, i) => i !== field.name)
                                          .map((r) => r && r.volume_id)
                                          .filter(Boolean);
                                        const rowValue =
                                          rowVolumes[field.name] || {};
                                        const vol = volumes.find(
                                          (v) => v.id === rowValue.volume_id
                                        );
                                        const sizeGb = rowValue.size_gb;

                                        return (
                                          <div
                                            style={{
                                              display: 'flex',
                                              gap: 8,
                                              alignItems: 'flex-start',
                                              flexWrap: 'wrap',
                                              marginBottom: 4,
                                            }}
                                          >
                                            <Form.Item
                                              name={[field.name, 'volume_id']}
                                              rules={[
                                                {
                                                  required: true,
                                                  message: t('Required'),
                                                },
                                              ]}
                                              style={{
                                                flex: '1 1 260px',
                                                minWidth: 200,
                                                marginBottom: 4,
                                              }}
                                            >
                                              <Select
                                                loading={loadingVolumes}
                                                placeholder={t(
                                                  'Select a volume'
                                                )}
                                                notFoundContent={
                                                  volumes.length === 0 &&
                                                  !loadingVolumes
                                                    ? t(
                                                        'No volume attached to this instance'
                                                      )
                                                    : t(
                                                        'Select a target instance first'
                                                      )
                                                }
                                              >
                                                {volumes
                                                  .filter(
                                                    (v) =>
                                                      !otherSelectedIds.includes(
                                                        v.id
                                                      )
                                                  )
                                                  .map((v) => (
                                                    <Option
                                                      key={v.id}
                                                      value={v.id}
                                                    >
                                                      {`${v.name} — ${v.size} GB (${v.status})`}
                                                    </Option>
                                                  ))}
                                              </Select>
                                            </Form.Item>
                                            <Form.Item
                                              name={[field.name, 'size_gb']}
                                              rules={[
                                                {
                                                  required: true,
                                                  message: t('Required'),
                                                },
                                              ]}
                                              style={{
                                                flex: '0 0 130px',
                                                width: 130,
                                                marginBottom: 4,
                                              }}
                                            >
                                              <InputNumber
                                                style={{ width: '100%' }}
                                                min={1}
                                                placeholder="10"
                                                addonAfter="GB"
                                              />
                                            </Form.Item>
                                            <Button
                                              danger
                                              size="small"
                                              icon={<DeleteOutlined />}
                                              onClick={() => remove(field.name)}
                                              style={{
                                                marginTop: 2,
                                                flex: '0 0 auto',
                                              }}
                                            />
                                            {vol && sizeGb ? (
                                              <div
                                                style={{
                                                  flexBasis: '100%',
                                                  fontSize: 11,
                                                  color: COLOR.textCaption,
                                                  marginTop: -2,
                                                  marginBottom: 6,
                                                }}
                                              >
                                                {t('Total after extension')}:{' '}
                                                <strong
                                                  style={{
                                                    color: COLOR.purple,
                                                  }}
                                                >
                                                  {vol.size + Number(sizeGb)} GB
                                                </strong>{' '}
                                                ({t('currently')} {vol.size} GB)
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      }}
                                    </Form.Item>
                                  ))}
                                  <Button
                                    size="small"
                                    onClick={() => add()}
                                    disabled={fields.length >= volumes.length}
                                  >
                                    + {t('Add a volume')}
                                  </Button>
                                </>
                              )}
                            </Form.List>
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
                          label={t('Confirmation email (optional)')}
                          rules={[
                            { type: 'email', message: t('Invalid email') },
                          ]}
                          extra={t(
                            'If left empty, you will not receive a confirmation link by email — you can still confirm or cancel the action directly from the Action Log table in the Skyline interface.'
                          )}
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
          extra={
            <Input
              allowClear
              placeholder={t('Search by rule or instance name')}
              prefix={<SearchOutlined style={{ color: COLOR.textCaption }} />}
              value={this.state.actionLogSearch}
              onChange={this.handleActionLogSearchChange}
              style={{ width: 260 }}
            />
          }
          bordered={false}
          style={{
            marginTop: 16,
            background: COLOR.bgCard,
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(36,46,66,0.06)',
          }}
        >
          <Table
            dataSource={this.getFilteredActionLogs()}
            columns={this.actionLogColumns()}
            rowKey="id"
            size="middle"
            pagination={{ pageSize: 10 }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    this.state.actionLogSearch
                      ? t('No action log matches your search.')
                      : t('No automatic actions triggered yet.')
                  }
                />
              ),
            }}
          />
        </Card>
      </div>
    );
  }
}
