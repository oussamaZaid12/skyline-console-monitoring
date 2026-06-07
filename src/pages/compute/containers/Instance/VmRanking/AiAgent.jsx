// AiAgent.jsx – Phase 4 : UI Glassmorphism + Architecture Designer + Pulumi Download
// Author: Oussama Zaied - ESPRIT 2024-2025
// Portal monté directement sur document.body — visible sur toutes les pages

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Button, Input, Select, Tooltip } from 'antd';
import {
  RobotOutlined, SendOutlined, CloseOutlined, ClearOutlined,
  ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CloudServerOutlined, DownloadOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;
const { Option } = Select;

// ── API ───────────────────────────────────────────────────────────────────────
const API_BASE = '/api/agent';

// ── Architecture Templates ────────────────────────────────────────────────────
const ARCH_TEMPLATES = [
  {
    type: 'single_vm',
    label: 'VM Unique',
    emoji: '🖥️',
    diagram: '🖥️',
    desc: '1 machine virtuelle',
    color: '#3b82f6',
    bg: '#eff6ff',
    border: '#bfdbfe',
    params: ['name', 'flavor', 'image'],
  },
  {
    type: 'multi_vm',
    label: 'Cluster VMs',
    emoji: '🖥️×N',
    diagram: '🖥️ 🖥️ 🖥️',
    desc: 'N instances identiques',
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    params: ['name', 'count', 'flavor', 'image'],
  },
  {
    type: 'two_tier',
    label: '2 Tiers',
    emoji: '🖥️+🗄️',
    diagram: '🖥️ Web\n    |\n🗄️ DB',
    desc: 'Web + Base de données',
    color: '#0891b2',
    bg: '#ecfeff',
    border: '#a5f3fc',
    params: ['name', 'flavor', 'db_flavor', 'image'],
  },
  {
    type: 'three_tier',
    label: '3 Tiers',
    emoji: '⚖️+🖥️+🗄️',
    diagram: '⚖️ LB\n    |\n🖥️ 🖥️\n    |\n🗄️ DB',
    desc: 'LB + Web×N + DB',
    color: '#059669',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    params: ['name', 'web_count', 'flavor', 'db_flavor', 'image'],
  },
  {
    type: 'full_network',
    label: 'Réseau Complet',
    emoji: '🌐+🔒+🔀',
    diagram: '🌐 Network\n    |\n🔀 Router + 🔒 SG',
    desc: 'Network + Subnet + Router + SG',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    params: ['name', 'cidr'],
  },
];

const FLAVORS  = ['m1.tiny', 'm1.small', 'm1.medium', 'm1.large', 'm1.xlarge'];
const IMAGES   = ['cirros', 'ubuntu', 'centos'];
const NETWORKS = ['demo-net', 'public1', 'lb-mgmt-net'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const getConvId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
};

// Skyline stocke le token Keystone de la session active dans localStorage
// sous la forme {"expires": <ms epoch>, "value": "gAAAAA..."}. On le relit
// ici pour le transmettre à l'agent : sans lui, get_conn() ne peut pas ouvrir
// de connexion OpenStack au nom de l'utilisateur (chaque utilisateur a ses
// propres projets/instances — impossible d'utiliser un compte de service unique).
const getKeystoneToken = () => {
  try {
    const raw = localStorage.getItem('keystone_token');
    if (!raw) return '';
    const { expires, value } = JSON.parse(raw);
    if (!value || (expires && Date.now() > expires)) return '';
    return value;
  } catch (_) { return ''; }
};

function parseConfirmation(content) {
  if (!content || typeof content !== 'string') return null;
  try { const p = JSON.parse(content); if (p?.type === 'confirmation_required') return p; } catch (_) {}
  try {
    const u = content.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"').replace(/\\n/g, '\n');
    const p = JSON.parse(u); if (p?.type === 'confirmation_required') return p;
  } catch (_) {}
  try {
    const m = content.match(/\{[\s\S]*?"type"\s*:\s*"confirmation_required"[\s\S]*?\}/);
    if (m) { const p = JSON.parse(m[0]); if (p?.type === 'confirmation_required') return p; }
  } catch (_) {}
  if (content.includes('CONFIRMATION REQUISE:')) {
    return {
      type: 'confirmation_required',
      question: content.replace('CONFIRMATION REQUISE:', '').trim(),
      confirm_text: 'Confirmer', cancel_text: 'Annuler',
    };
  }
  return null;
}

function extractStackName(question) {
  const m = (question || '').match(/stack=([^\n\s,]+)/);
  return m ? m[1].trim() : null;
}

function isPulumiConfirm(confirm) {
  return confirm?.confirm_text === 'Déployer' || !!extractStackName(confirm?.question);
}

// ── Pulumi Preview Parser ────────────────────────────────────────────────────
function PulumiPreviewCard({ question }) {
  const stackName = extractStackName(question);
  const resMatch  = question.match(/Ressources à créer\s*:\s*(\d+)/);
  const resCount  = resMatch ? parseInt(resMatch[1]) : 0;
  const titleMatch = question.match(/PULUMI PREVIEW — ([^\n]+)/);
  const title = titleMatch ? titleMatch[1] : 'ARCHITECTURE';

  const iconFor = (name) => {
    if (/^(lb|load)/i.test(name))  return '⚖️';
    if (/-db$|^db-/i.test(name))   return '🗄️';
    if (/-web-?|web-/i.test(name)) return '🖥️';
    if (/^vm-/i.test(name))        return '🖥️';
    if (/net-|network/i.test(name))return '🌐';
    if (/subnet/i.test(name))      return '📡';
    if (/router/i.test(name))      return '🔀';
    if (/sg-|secgroup/i.test(name))return '🔒';
    return '📦';
  };

  const resources = [];
  for (const m of question.matchAll(/name\s*:\s*"([^"]+)"/g)) resources.push(m[1]);

  return (
    <div>
      <div style={{ fontWeight: 700, color: '#92400e', fontSize: 13, marginBottom: 8 }}>
        ⚠️ {title}
      </div>
      {stackName && (
        <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#78350f', background: 'rgba(217,119,6,0.1)', borderRadius: 6, padding: '3px 8px', marginBottom: 10, wordBreak: 'break-all' }}>
          stack: {stackName}
        </div>
      )}
      {resources.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {resources.map((r, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#451a03' }}>
              <span>{iconFor(r)}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{r}</span>
            </div>
          ))}
        </div>
      )}
      {resCount > 0 && (
        <div style={{ fontSize: 11, color: '#78350f', fontWeight: 600 }}>
          📊 {resCount} ressource(s) à créer
        </div>
      )}
    </div>
  );
}

// ── Architecture Designer ────────────────────────────────────────────────────
function ArchitectureDesigner({ onSend }) {
  const [selected, setSelected]   = useState(null);
  const [config, setConfig]       = useState({
    name: '', count: 2, web_count: 2,
    flavor: 'm1.tiny', db_flavor: 'm1.tiny',
    image: 'cirros', network: 'demo-net', cidr: '10.10.0.0/24',
  });

  const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
  const tpl = ARCH_TEMPLATES.find(t => t.type === selected);

  const handlePreview = () => {
    if (!tpl) return;
    const parts = [`type=${tpl.type}`, `name=${config.name || 'monapp'}`];
    if (tpl.params.includes('count'))     parts.push(`count=${config.count}`);
    if (tpl.params.includes('web_count')) parts.push(`web_count=${config.web_count}`);
    if (tpl.params.includes('flavor'))    parts.push(`flavor=${config.flavor}`);
    if (tpl.params.includes('db_flavor')) parts.push(`db_flavor=${config.db_flavor}`);
    if (tpl.params.includes('image'))     parts.push(`image=${config.image}`);
    if (tpl.params.includes('cidr'))      parts.push(`cidr=${config.cidr}`);
    if (!tpl.params.includes('cidr'))     parts.push(`network=${config.network}`);
    onSend(`Déploie une architecture : ${parts.join(',')}`);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 10px', background: '#f8fafd' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.6px', marginBottom: 10 }}>
        CHOISISSEZ UN TEMPLATE D'ARCHITECTURE
      </div>

      {/* Template Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {ARCH_TEMPLATES.map(t => {
          const isSelected = selected === t.type;
          return (
            <div
              key={t.type}
              onClick={() => setSelected(t.type)}
              style={{
                padding: '12px 10px', borderRadius: 14, cursor: 'pointer',
                background: isSelected ? t.bg : '#ffffff',
                border: `2px solid ${isSelected ? t.color : '#e2e8f0'}`,
                textAlign: 'center', transition: 'all 0.2s ease',
                boxShadow: isSelected ? `0 4px 14px ${t.color}28` : '0 1px 3px rgba(0,0,0,0.06)',
                transform: isSelected ? 'scale(1.02)' : 'scale(1)',
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 4, whiteSpace: 'pre', lineHeight: 1.4 }}>{t.diagram}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.label}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{t.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Config panel */}
      {selected && tpl && (
        <div style={{ background: '#ffffff', borderRadius: 14, padding: '14px', border: `1px solid ${tpl.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: tpl.color, letterSpacing: '0.5px', marginBottom: 12 }}>
            ⚙️ CONFIGURATION — {tpl.label.toUpperCase()}
          </div>
          {[
            { label: 'Nom', show: true, type: 'input', key: 'name', placeholder: 'monapp' },
            { label: 'Count', show: tpl.params.includes('count'), type: 'number', key: 'count', min: 1, max: 10 },
            { label: 'Web ×N', show: tpl.params.includes('web_count'), type: 'number', key: 'web_count', min: 1, max: 10 },
          ].filter(f => f.show).map(field => (
            <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', width: 72, flexShrink: 0 }}>{field.label}</span>
              <Input size="small" type={field.type === 'number' ? 'number' : 'text'}
                value={config[field.key]} min={field.min} max={field.max}
                placeholder={field.placeholder}
                onChange={e => set(field.key, field.type === 'number' ? parseInt(e.target.value) || field.min : e.target.value)}
                style={{ flex: 1, borderRadius: 8 }}/>
            </div>
          ))}
          {tpl.params.includes('flavor') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', width: 72, flexShrink: 0 }}>Flavor</span>
              <Select size="small" value={config.flavor} onChange={v => set('flavor', v)} style={{ flex: 1 }}>
                {FLAVORS.map(f => <Option key={f} value={f}>{f}</Option>)}
              </Select>
            </div>
          )}
          {tpl.params.includes('db_flavor') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', width: 72, flexShrink: 0 }}>DB Flavor</span>
              <Select size="small" value={config.db_flavor} onChange={v => set('db_flavor', v)} style={{ flex: 1 }}>
                {FLAVORS.map(f => <Option key={f} value={f}>{f}</Option>)}
              </Select>
            </div>
          )}
          {tpl.params.includes('image') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', width: 72, flexShrink: 0 }}>Image</span>
              <Select size="small" value={config.image} onChange={v => set('image', v)} style={{ flex: 1 }}>
                {IMAGES.map(i => <Option key={i} value={i}>{i}</Option>)}
              </Select>
            </div>
          )}
          {!tpl.params.includes('cidr') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', width: 72, flexShrink: 0 }}>Réseau</span>
              <Select size="small" value={config.network} onChange={v => set('network', v)} style={{ flex: 1 }}>
                {NETWORKS.map(n => <Option key={n} value={n}>{n}</Option>)}
              </Select>
            </div>
          )}
          {tpl.params.includes('cidr') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', width: 72, flexShrink: 0 }}>CIDR</span>
              <Input size="small" value={config.cidr} onChange={e => set('cidr', e.target.value)}
                placeholder="10.10.0.0/24" style={{ flex: 1, borderRadius: 8 }}/>
            </div>
          )}
          <Button
            type="primary" style={{ width: '100%', height: 38, borderRadius: 12, fontWeight: 600, fontSize: 13, marginTop: 6, background: `linear-gradient(135deg, ${tpl.color}, #0c63fa)`, borderColor: 'transparent' }}
            icon={<CloudServerOutlined />}
            onClick={handlePreview}>
            🔍 Prévisualiser l'architecture
          </Button>
        </div>
      )}
    </div>
  );
}

// ── CSS Animations (injected once) ───────────────────────────────────────────
const CSS = `
@keyframes aiops-slideup {
  0%  { opacity:0; transform: translateY(18px) scale(0.97); }
  100%{ opacity:1; transform: translateY(0)    scale(1); }
}
@keyframes aiops-fadein {
  0%  { opacity:0; transform: translateY(5px); }
  100%{ opacity:1; transform: translateY(0); }
}
@keyframes aiops-bounce {
  0%,80%,100%{ transform:translateY(0);   opacity:.45; }
  40%         { transform:translateY(-5px);opacity:1; }
}
@keyframes aiops-pulse {
  0%  { box-shadow: 0 4px 22px rgba(12,99,250,.55), 0 0 0 0   rgba(12,99,250,.35); }
  70% { box-shadow: 0 4px 22px rgba(12,99,250,.55), 0 0 0 12px rgba(12,99,250,0); }
  100%{ box-shadow: 0 4px 22px rgba(12,99,250,.55), 0 0 0 0   rgba(12,99,250,0); }
}
#aiops-agent-portal *::-webkit-scrollbar { width: 4px; }
#aiops-agent-portal *::-webkit-scrollbar-track { background: transparent; }
#aiops-agent-portal *::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
`;

// ── Main Widget ───────────────────────────────────────────────────────────────
function AiAgentWidget() {
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState('chat');
  const [input, setInput]     = useState('');
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: 'Bonjour ! Je suis votre assistant AIOps OpenStack. 🚀\n\nJe peux vous aider à :\n• 📋 Lister instances, flavors, images, volumes, réseaux\n• ⚡ Créer / supprimer des instances et volumes\n• 🏗️ Déployer des architectures complètes via Pulumi IaC\n• 📊 Diagnostiquer et monitorer votre infrastructure\n• 📈 Métriques Prometheus + logs OpenSearch\n\nUtilisez l\'onglet 🏗️ Architecture pour designer visuellement !',
  }]);
  const [streaming, setStreaming]             = useState(false);
  const [convId]                              = useState(getConvId);
  const [answeredConfirms, setAnsweredConfirms] = useState(new Set());
  const messagesEndRef = useRef(null);
  const abortRef       = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const sendMessage = useCallback(async (text) => {
    const msg = (text !== undefined ? text : input).trim();
    if (!msg || streaming) return;
    if (text !== undefined) setTab('chat');
    const history = messages.filter(m => m.role !== 'system');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setInput('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current  = controller;
    try {
      const keystone_token = getKeystoneToken();
      const resp = await fetch(`${API_BASE}/chat`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history, conversation_id: convId, keystone_token }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!keystone_token && /Token Keystone manquant|session OpenStack/i.test(data.response || '')) {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Session Skyline introuvable ou expirée — reconnectez-vous puis réessayez.' }]);
        return;
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || 'Pas de réponse.' }]);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Impossible de joindre le service agent.\n\n${err.message}` }]);
    } finally { setStreaming(false); }
  }, [input, streaming, messages, convId]);

  const handleConfirm = useCallback((i, confirmed) => {
    setAnsweredConfirms(prev => new Set([...prev, i]));
    sendMessage(confirmed ? 'CONFIRMED' : 'CANCELLED');
  }, [sendMessage]);

  const handleDownload = useCallback((stackName) => {
    window.open(`${API_BASE}/download/${stackName}`, '_blank');
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([{ role: 'assistant', content: '🔄 Conversation réinitialisée. Comment puis-je vous aider ?' }]);
    setStreaming(false);
    setAnsweredConfirms(new Set());
  };

  const renderMessage = (msg, i) => {
    if (msg.role !== 'assistant') {
      return (
        <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', animation: 'aiops-fadein 0.22s ease' }}>
          <div style={{
            maxWidth: '85%', background: 'linear-gradient(135deg, #0c63fa, #4f46e5)',
            color: '#fff', borderRadius: '18px 18px 4px 18px',
            padding: '10px 14px', fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            boxShadow: '0 2px 10px rgba(12,99,250,0.3)',
          }}>
            {msg.content}
          </div>
        </div>
      );
    }

    const confirm   = parseConfirmation(msg.content);
    const answered  = answeredConfirms.has(i);
    const stackName = confirm ? extractStackName(confirm.question) : null;
    const isPulumi  = confirm ? isPulumiConfirm(confirm) : false;

    if (confirm && !answered) {
      return (
        <div key={i} style={{
          alignSelf: 'flex-start', maxWidth: '92%', width: '92%',
          background: isPulumi ? 'linear-gradient(135deg, #fffbeb, #fef9ec)' : '#fff8f0',
          border: `1.5px solid ${isPulumi ? '#f59e0b' : '#fb923c'}`,
          borderRadius: '4px 18px 18px 18px', padding: '14px',
          boxShadow: `0 3px 12px ${isPulumi ? 'rgba(245,158,11,0.15)' : 'rgba(251,146,60,0.15)'}`,
          animation: 'aiops-fadein 0.25s ease',
        }}>
          {isPulumi
            ? <PulumiPreviewCard question={confirm.question} />
            : <div style={{ color: '#92400e', fontWeight: 500, whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 10 }}>⚠️ {confirm.question}</div>
          }
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Button type="primary" size="small" icon={<CheckCircleOutlined />}
              style={{ background: '#16a34a', borderColor: '#16a34a', borderRadius: 8 }}
              onClick={() => handleConfirm(i, true)}>
              {confirm.confirm_text || 'Confirmer'}
            </Button>
            <Button danger size="small" icon={<CloseCircleOutlined />}
              style={{ borderRadius: 8 }}
              onClick={() => handleConfirm(i, false)}>
              {confirm.cancel_text || 'Annuler'}
            </Button>
            {isPulumi && stackName && (
              <Button size="small" icon={<DownloadOutlined />}
                style={{ borderRadius: 8, background: '#0f172a', borderColor: '#334155', color: '#e2e8f0' }}
                onClick={() => handleDownload(stackName)}>
                📥 Pulumi.zip
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (confirm && answered) {
      return (
        <div key={i} style={{
          fontSize: 12, color: '#94a3b8', padding: '6px 10px',
          background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start',
          animation: 'aiops-fadein 0.2s ease',
        }}>
          ✓ Action traitée
        </div>
      );
    }

    return (
      <div key={i} style={{
        maxWidth: '88%', alignSelf: 'flex-start',
        background: '#ffffff', color: '#1e293b',
        borderRadius: '4px 18px 18px 18px', padding: '10px 14px',
        fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)',
        animation: 'aiops-fadein 0.22s ease',
      }}>
        {msg.content}
      </div>
    );
  };

  const TypingIndicator = () => (
    <div style={{
      alignSelf: 'flex-start', background: '#ffffff', borderRadius: '4px 18px 18px 18px',
      padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    }}>
      {[0, 0.2, 0.4].map((d, j) => (
        <span key={j} style={{
          width: 7, height: 7, borderRadius: '50%', background: '#94a3b8',
          display: 'inline-block', margin: '0 2px',
          animation: `aiops-bounce 1.2s ease-in-out ${d}s infinite`,
        }}/>
      ))}
    </div>
  );

  return (
    <>
      <style>{CSS}</style>

      {/* FAB button */}
      <Tooltip title="Assistant AIOps" placement="left">
        <button
          style={{
            position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
            width: 54, height: 54, borderRadius: '50%',
            background: 'linear-gradient(135deg, #0c63fa 0%, #7c3aed 100%)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'aiops-pulse 2.5s ease-out infinite',
            transition: 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)',
          }}
          onClick={() => setOpen(o => !o)}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.12) rotate(-8deg)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1) rotate(0)'; }}
        >
          {streaming
            ? <ThunderboltOutlined style={{ color: '#fff', fontSize: 22 }}/>
            : <RobotOutlined style={{ color: '#fff', fontSize: 22 }}/>}
        </button>
      </Tooltip>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 28, zIndex: 9998,
          width: 460, maxHeight: 640, minHeight: 480,
          background: 'rgba(255,255,255,0.98)',
          borderRadius: 20, overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(12,99,250,0.08)',
          display: 'flex', flexDirection: 'column',
          animation: 'aiops-slideup 0.32s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #0c63fa 0%, #4f46e5 55%, #7c3aed 100%)',
            padding: '14px 16px 0', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RobotOutlined style={{ color: '#fff', fontSize: 18 }}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', letterSpacing: '-0.2px' }}>
                  Assistant AIOps
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>
                  {streaming
                    ? <span style={{ color: '#fde68a' }}>⚡ Traitement en cours…</span>
                    : 'OpenStack · Llama 3.3 · Pulumi IaC'}
                </div>
              </div>
              <Tooltip title="Effacer">
                <Button size="small" icon={<ClearOutlined/>} onClick={clearChat} type="text"
                  style={{ color: 'rgba(255,255,255,0.7)', borderRadius: 8 }}/>
              </Tooltip>
              <Button size="small" icon={<CloseOutlined/>} onClick={() => setOpen(false)} type="text"
                style={{ color: 'rgba(255,255,255,0.7)', borderRadius: 8 }}/>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { key: 'chat',   label: '💬 Chat' },
                { key: 'design', label: '🏗️ Architecture' },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  padding: '8px 16px', borderRadius: '10px 10px 0 0',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', outline: 'none',
                  background: tab === t.key ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.14)',
                  color: tab === t.key ? '#0c63fa' : 'rgba(255,255,255,0.88)',
                  transition: 'all 0.2s ease',
                }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          {tab === 'chat' ? (
            <>
              <div style={{
                flex: 1, overflowY: 'auto', padding: '14px',
                display: 'flex', flexDirection: 'column', gap: 10,
                background: '#f8fafd', minHeight: 0,
              }}>
                {messages.map((msg, i) => renderMessage(msg, i))}
                {streaming && <TypingIndicator />}
                <div ref={messagesEndRef}/>
              </div>

              <div style={{ padding: '10px 14px', borderTop: '1px solid #eef0f4', background: '#fff', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                <TextArea
                  value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Décrivez votre besoin… (Shift+Enter = saut de ligne)"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  style={{ flex: 1, resize: 'none', borderRadius: 12, fontSize: 13, border: '1.5px solid #e2e8f0' }}
                  disabled={streaming}/>
                <Button type="primary" icon={<SendOutlined/>}
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || streaming}
                  style={{ background: 'linear-gradient(135deg, #0c63fa, #4f46e5)', borderColor: 'transparent', borderRadius: 12, height: 36, width: 36, padding: 0 }}/>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <ArchitectureDesigner onSend={sendMessage} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Mount (Portal sur document.body) ─────────────────────────────────────────
let _mounted = false;

function mountAiAgent() {
  if (_mounted || !document.body) return;
  _mounted = true;
  const existing = document.getElementById('aiops-agent-portal');
  if (existing) return;
  const container = document.createElement('div');
  container.id = 'aiops-agent-portal';
  document.body.appendChild(container);
  ReactDOM.render(<AiAgentWidget />, container);
}

setTimeout(mountAiAgent, 2000);

export default function AiAgent() {
  useEffect(() => { mountAiAgent(); }, []);
  return null;
}
