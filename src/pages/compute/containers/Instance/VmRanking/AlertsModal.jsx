// AlertsModal — Gestion des règles d'alerting
// Author: Oussama Zaied - ESPRIT

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, Button, Form, Table, Switch, Tag,
  Tabs, Badge, notification, Select, InputNumber, Input,
} from 'antd';
import {
  BellOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, CheckCircleOutlined,
} from '@ant-design/icons';

const { Option } = Select;
const { TabPane } = Tabs;

const API_BASE = '/api/openstack/skyline/api/v1';

const COLOR = {
  primary:    '#0c63fa',
  danger:     '#ca2621',
  textCaption:'rgba(0,0,0,0.45)',
};

const METRICS = [
  { value: 'cpu',        label: 'CPU (%)' },
  { value: 'ram',        label: 'RAM (MB)' },
  { value: 'disk_read',  label: 'Disk Read (MB/s)' },
  { value: 'disk_write', label: 'Disk Write (MB/s)' },
  { value: 'net_in',     label: 'Network In (MB/s)' },
  { value: 'net_out',    label: 'Network Out (MB/s)' },
];

export default function AlertsModal({ instances = [] }) {
  const [open, setOpen]                   = useState(false);
  const [rules, setRules]                 = useState([]);
  const [history, setHistory]             = useState([]);
  const [activeCount, setActiveCount]     = useState(0);
  const [showForm, setShowForm]           = useState(false);
  const [editingRule, setEditingRule]     = useState(null);
  const [notifyEmail, setNotifyEmail]     = useState(false);
  const [notifyWebhook, setNotifyWebhook] = useState(false);
  const [form] = Form.useForm();

  const apiFetch = useCallback(async (path, options = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const data = await apiFetch('/alerts/rules');
      setRules(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[AlertsModal] fetchRules:', e);
    }
  }, [apiFetch]);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await apiFetch('/alerts/history');
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[AlertsModal] fetchHistory:', e);
    }
  }, [apiFetch]);

  const fetchActive = useCallback(async (showToast = false) => {
    try {
      const data = await apiFetch('/alerts/active');
      setActiveCount(prev => {
        if (showToast && data.count > prev && data.alerts && data.alerts.length) {
          data.alerts.slice(0, 3).forEach(a => {
            notification.warning({
              message: `Alerte : ${a.rule_name}`,
              description: `VM: ${a.instance_name} — ${a.metric}: ${a.value}`,
              placement: 'topRight',
              duration: 8,
            });
          });
        }
        return data.count || 0;
      });
    } catch (e) {
      console.error('[AlertsModal] fetchActive:', e);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchActive(false);
    const interval = setInterval(() => fetchActive(true), 30000);
    return () => clearInterval(interval);
  }, [fetchActive]);

  const handleOpen = () => {
    setOpen(true);
    fetchRules();
    fetchHistory();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (values.instance_id !== 'all') {
        const found = instances.find(i => i.uuid === values.instance_id);
        values.instance_name = found ? found.name : values.instance_id;
      } else {
        values.instance_name = 'Toutes les VMs';
      }

      if (editingRule) {
        await apiFetch(`/alerts/rules/${editingRule.id}`, {
          method: 'PUT', body: JSON.stringify(values),
        });
      } else {
        await apiFetch('/alerts/rules', {
          method: 'POST', body: JSON.stringify(values),
        });
      }
      setShowForm(false);
      setEditingRule(null);
      form.resetFields();
      setNotifyEmail(false);
      setNotifyWebhook(false);
      fetchRules();
      notification.success({
        message: editingRule ? 'Règle mise à jour' : 'Règle créée',
        duration: 3,
      });
    } catch (e) {
      if (e.errorFields) return;
      notification.error({ message: 'Erreur', description: String(e), duration: 5 });
    }
  };

  const handleDelete = async (id) => {
    await apiFetch(`/alerts/rules/${id}`, { method: 'DELETE' });
    fetchRules();
  };

  const handleToggle = async (id) => {
    await apiFetch(`/alerts/rules/${id}/toggle`, { method: 'PATCH' });
    fetchRules();
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setNotifyEmail(rule.notify_email);
    setNotifyWebhook(rule.notify_webhook);
    form.setFieldsValue(rule);
    setShowForm(true);
  };

  const handleResolve = async (eventId) => {
    await apiFetch(`/alerts/events/${eventId}/resolve`, { method: 'POST' });
    fetchHistory();
    fetchActive(false);
  };

  const metricLabel = (m) => (METRICS.find(x => x.value === m) || {}).label || m;

  const rulesColumns = [
    { title: 'Nom', dataIndex: 'name', key: 'name' },
    { title: 'VM',  dataIndex: 'instance_name', key: 'vm' },
    { title: 'Métrique', dataIndex: 'metric', key: 'metric', render: metricLabel },
    {
      title: 'Condition', key: 'cond',
      render: (_, r) => `${r.operator === 'gt' ? '>' : '<'} ${r.threshold}`,
    },
    {
      title: 'Notifications', key: 'notifs',
      render: (_, r) => (
        <span>
          {r.notify_ui      ? <Tag color="blue">UI</Tag> : null}
          {r.notify_email   ? <Tag color="orange">Email</Tag> : null}
          {r.notify_webhook ? <Tag color="green">Webhook</Tag> : null}
        </span>
      ),
    },
    {
      title: 'Actif', key: 'active',
      render: (_, r) => (
        <Switch checked={r.is_active} onChange={() => handleToggle(r.id)} />
      ),
    },
    {
      title: 'Actions', key: 'actions',
      render: (_, r) => (
        <span style={{ display: 'flex', gap: 8 }}>
          <Button size="small" icon={<EditOutlined />}   onClick={() => handleEdit(r)} />
          <Button size="small" icon={<DeleteOutlined />} danger onClick={() => handleDelete(r.id)} />
        </span>
      ),
    },
  ];

  const historyColumns = [
    { title: 'Alerte',    dataIndex: 'rule_name',     key: 'name' },
    { title: 'VM',        dataIndex: 'instance_name', key: 'vm' },
    { title: 'Métrique',  dataIndex: 'metric',        key: 'metric', render: metricLabel },
    {
      title: 'Valeur', dataIndex: 'value', key: 'value',
      render: (v, r) => (
        <span style={{ color: r.is_resolved ? 'inherit' : COLOR.danger, fontWeight: 600 }}>
          {v}
        </span>
      ),
    },
    { title: 'Seuil', dataIndex: 'threshold', key: 'threshold' },
    {
      title: 'Déclenché', dataIndex: 'triggered_at', key: 'triggered_at',
      render: (tval) => new Date(tval).toLocaleString('fr-FR'),
    },
    {
      title: 'Statut', key: 'status',
      render: (_, r) => r.is_resolved
        ? <Tag color="green">Résolu</Tag>
        : <Tag color="red">Actif</Tag>,
    },
    {
      title: '', key: 'resolve',
      render: (_, r) => !r.is_resolved ? (
        <Button size="small" icon={<CheckCircleOutlined />} onClick={() => handleResolve(r.id)}>
          Résoudre
        </Button>
      ) : null,
    },
  ];

  return (
    <>
      <Badge count={activeCount} offset={[-4, 4]}>
        <Button
          type="primary"
          icon={<BellOutlined />}
          onClick={handleOpen}
          style={{ backgroundColor: COLOR.primary, borderColor: COLOR.primary }}
        >
          Alertes
        </Button>
      </Badge>

      <Modal
        title={<span><BellOutlined style={{ marginRight: 8 }} />Gestion des alertes</span>}
        visible={open}
        onCancel={() => { setOpen(false); setShowForm(false); }}
        footer={null}
        width={960}
        destroyOnClose
      >
        <Tabs defaultActiveKey="rules">
          <TabPane tab="Règles" key="rules">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ backgroundColor: COLOR.primary, borderColor: COLOR.primary }}
                onClick={() => {
                  setEditingRule(null);
                  setNotifyEmail(false);
                  setNotifyWebhook(false);
                  form.resetFields();
                  setShowForm(true);
                }}
              >
                Nouvelle règle
              </Button>
            </div>

            {showForm ? (
              <div style={{
                background: '#f5f7fa',
                border: '1px solid #e0e4ef',
                borderRadius: 8,
                padding: '16px 20px',
                marginBottom: 16,
              }}>
                <Form form={form} layout="vertical" onFinish={handleSave}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr', gap: 12 }}>
                    <Form.Item name="name" label="Nom" rules={[{ required: true, message: 'Requis' }]}>
                      <Input placeholder="ex: CPU élevé prod-01" />
                    </Form.Item>
                    <Form.Item name="instance_id" label="VM cible" initialValue="all" rules={[{ required: true }]}>
                      <Select>
                        <Option value="all">Toutes les VMs</Option>
                        {instances.map(i => (
                          <Option key={i.uuid} value={i.uuid}>{i.name}</Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item name="metric" label="Métrique" initialValue="cpu" rules={[{ required: true }]}>
                      <Select>
                        {METRICS.map(m => <Option key={m.value} value={m.value}>{m.label}</Option>)}
                      </Select>
                    </Form.Item>
                    <Form.Item name="operator" label="Condition" initialValue="gt">
                      <Select>
                        <Option value="gt">&gt;</Option>
                        <Option value="lt">&lt;</Option>
                      </Select>
                    </Form.Item>
                    <Form.Item name="threshold" label="Seuil" rules={[{ required: true, message: 'Requis' }]}>
                      <InputNumber style={{ width: '100%' }} placeholder="80" />
                    </Form.Item>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 4 }}>
                    <Form.Item name="notify_ui" label="UI" valuePropName="checked" initialValue={true}>
                      <Switch />
                    </Form.Item>
                    <Form.Item name="notify_email" label="Email" valuePropName="checked" initialValue={false}>
                      <Switch onChange={v => setNotifyEmail(v)} />
                    </Form.Item>
                    <Form.Item name="notify_webhook" label="Webhook" valuePropName="checked" initialValue={false}>
                      <Switch onChange={v => setNotifyWebhook(v)} />
                    </Form.Item>
                  </div>

                  {notifyEmail ? (
                    <Form.Item name="email_address" label="Email de destination"
                      rules={[{ type: 'email', message: 'Email invalide' }]}>
                      <Input placeholder="admin@example.com" />
                    </Form.Item>
                  ) : null}
                  {notifyWebhook ? (
                    <Form.Item name="webhook_url" label="URL Webhook (Slack/Teams)">
                      <Input placeholder="https://hooks.slack.com/services/..." />
                    </Form.Item>
                  ) : null}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                    <Button onClick={() => { setShowForm(false); setEditingRule(null); }}>
                      Annuler
                    </Button>
                    <Button type="primary" htmlType="submit"
                      style={{ backgroundColor: COLOR.primary, borderColor: COLOR.primary }}>
                      {editingRule ? 'Mettre à jour' : 'Créer la règle'}
                    </Button>
                  </div>
                </Form>
              </div>
            ) : null}

            <Table
              dataSource={rules}
              columns={rulesColumns}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: 'Aucune règle. Cliquez sur "Nouvelle règle".' }}
            />
          </TabPane>

          <TabPane
            tab={<span>Historique {activeCount > 0 ? <Badge count={activeCount} size="small" style={{ marginLeft: 6 }} /> : null}</span>}
            key="history"
          >
            <Table
              dataSource={history}
              columns={historyColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 20 }}
              locale={{ emptyText: 'Aucune alerte déclenchée.' }}
            />
          </TabPane>
        </Tabs>
      </Modal>
    </>
  );
}