// AiAgent.jsx — Phase 3 : multi-agents + boutons de confirmation + ReactDOM Portal
// Author: Oussama Zaied - ESPRIT 2024-2025
// Portal = monté directement sur document.body, indépendant de la page courante

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Button, Input, Tooltip } from 'antd';
import {
  RobotOutlined, SendOutlined, CloseOutlined, ClearOutlined,
  ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;
const API_BASE = '/api/openstack/skyline/api/v1';
const getConvId = () => crypto.randomUUID();

const S = {
  fab: {
    position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
    width: 52, height: 52, borderRadius: '50%',
    background: 'linear-gradient(135deg, #0c63fa 0%, #5b8df7 100%)',
    border: 'none', boxShadow: '0 4px 20px rgba(12,99,250,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
  },
  panel: {
    position: 'fixed', bottom: 92, right: 28, zIndex: 9999,
    width: 420, height: 580,
    background: '#ffffff',
    borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: '1px solid #e8e8e8',
  },
  header: {
    padding: '14px 16px', borderBottom: '1px solid #e8e8e8',
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#f8f9fa',
  },
  headerTitle: { flex: 1, fontWeight: 600, fontSize: 14, color: '#1a1a1a' },
  headerSub:   { fontSize: 11, color: '#888' },
  messages: {
    flex: 1, overflowY: 'auto', padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 10,
    background: '#ffffff',
  },
  bubble: (role) => ({
    maxWidth: '85%',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    background: role === 'user' ? 'linear-gradient(135deg, #0c63fa, #3b82f6)' : '#f0f2f5',
    color: role === 'user' ? '#fff' : '#1a1a1a',
    borderRadius: role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
    padding: '9px 13px', fontSize: 13, lineHeight: 1.55,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    border: role === 'user' ? 'none' : '1px solid #e8e8e8',
  }),
  confirmBox: {
    alignSelf: 'flex-start', maxWidth: '85%',
    background: '#fffbeb', border: '1px solid #f59e0b',
    borderRadius: '16px 16px 16px 4px', padding: '12px 14px', fontSize: 13,
  },
  confirmQuestion: { color: '#92400e', marginBottom: 10, fontWeight: 500, whiteSpace: 'pre-wrap' },
  confirmButtons:  { display: 'flex', gap: 8 },
  typingDot: {
    width: 7, height: 7, borderRadius: '50%', background: '#aaa',
    display: 'inline-block', margin: '0 2px',
  },
  footer: {
    padding: '10px 14px', borderTop: '1px solid #e8e8e8',
    background: '#f8f9fa', display: 'flex', gap: 8, alignItems: 'flex-end',
  },
  textarea: { flex: 1, resize: 'none', borderRadius: 10, fontSize: 13 },
  sendBtn: {
    background: '#0c63fa', borderColor: '#0c63fa',
    borderRadius: 10, height: 36, minWidth: 36, padding: '0 12px',
  },
};

function parseConfirmation(content) {
  if (!content || typeof content !== 'string') return null;
  // Cas 1 — JSON direct
  try {
    const p = JSON.parse(content);
    if (p && p.type === 'confirmation_required') return p;
  } catch (_) {}
  // Cas 2 — guillemets échappés (double sérialisation Python)
  try {
    const u = content.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"').replace(/\\n/g, '\n');
    const p = JSON.parse(u);
    if (p && p.type === 'confirmation_required') return p;
  } catch (_) {}
  // Cas 3 — JSON embarqué dans du texte
  try {
    const m = content.match(/\{[\s\S]*?"type"\s*:\s*"confirmation_required"[\s\S]*?\}/);
    if (m) { const p = JSON.parse(m[0]); if (p && p.type === 'confirmation_required') return p; }
  } catch (_) {}
  // Cas 4 — texte simple
  if (content.includes('CONFIRMATION REQUISE:')) {
    return { type: 'confirmation_required', question: content.replace('CONFIRMATION REQUISE:', '').trim(), confirm_text: 'Confirmer', cancel_text: 'Annuler' };
  }
  return null;
}

function AiAgentWidget() {
  const [open, setOpen]           = useState(false);
  const [input, setInput]         = useState('');
  const [messages, setMessages]   = useState([{
    role: 'assistant',
    content: 'Bonjour ! Je suis votre assistant AIOps OpenStack.\n\nJe peux vous aider à :\n• Lister instances, flavors, images, volumes, réseaux\n• Créer ou supprimer des instances et volumes\n• Gérer les floating IPs et routers\n• Diagnostiquer les erreurs infrastructure\n\nComment puis-je vous aider ?',
  }]);
  const [streaming, setStreaming]               = useState(false);
  const [convId]                                = useState(getConvId);
  const [answeredConfirms, setAnsweredConfirms] = useState(new Set());
  const messagesEndRef = useRef(null);
  const abortRef       = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const sendMessage = useCallback(async (text) => {
    const msg = (text !== undefined ? text : input).trim();
    if (!msg || streaming) return;
    const history = messages.filter(m => m.role !== 'system');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setInput('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch(`${API_BASE}/ai-agent/chat`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history, conversation_id: convId }),
        signal: controller.signal,
      });
      const data = await resp.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || 'Pas de réponse.' }]);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev => [...prev, { role: 'assistant', content: 'Impossible de joindre le service agent.' }]);
    } finally { setStreaming(false); }
  }, [input, streaming, messages, convId]);

  const handleConfirm = useCallback((i, confirmed) => {
    setAnsweredConfirms(prev => new Set([...prev, i]));
    sendMessage(confirmed ? 'CONFIRMED' : 'CANCELLED');
  }, [sendMessage]);

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([{ role: 'assistant', content: 'Conversation réinitialisée. Comment puis-je vous aider ?' }]);
    setStreaming(false);
    setAnsweredConfirms(new Set());
  };

  const renderMessage = (msg, i) => {
    if (msg.role !== 'assistant') return <div key={i} style={S.bubble('user')}>{msg.content}</div>;
    const confirm = parseConfirmation(msg.content);
    const answered = answeredConfirms.has(i);
    if (confirm && !answered) {
      return (
        <div key={i} style={S.confirmBox}>
          <div style={S.confirmQuestion}>⚠️ {confirm.question}</div>
          <div style={S.confirmButtons}>
            <Button type="primary" size="small" icon={<CheckCircleOutlined/>}
              style={{ background: '#16a34a', borderColor: '#16a34a', borderRadius: 8 }}
              onClick={() => handleConfirm(i, true)}>
              {confirm.confirm_text || 'Confirmer'}
            </Button>
            <Button danger size="small" icon={<CloseCircleOutlined/>}
              style={{ borderRadius: 8 }} onClick={() => handleConfirm(i, false)}>
              {confirm.cancel_text || 'Annuler'}
            </Button>
          </div>
        </div>
      );
    }
    if (confirm && answered) {
      return (
        <div key={i} style={{ ...S.confirmBox, opacity: 0.5, background: '#f3f4f6', border: '1px solid #d1d5db' }}>
          <div style={{ color: '#6b7280', fontSize: 12 }}>✓ {confirm.question}</div>
        </div>
      );
    }
    return <div key={i} style={S.bubble('assistant')}>{msg.content}</div>;
  };

  const TypingIndicator = () => (
    <div style={{ ...S.bubble('assistant'), padding: '10px 14px' }}>
      <style>{`@keyframes b{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-5px);opacity:1}}.d1{animation:b 1.2s infinite 0s}.d2{animation:b 1.2s infinite .2s}.d3{animation:b 1.2s infinite .4s}`}</style>
      <span className="d1" style={S.typingDot}/><span className="d2" style={S.typingDot}/><span className="d3" style={S.typingDot}/>
    </div>
  );

  return (
    <>
      <Tooltip title="Assistant AIOps" placement="left">
        <button style={S.fab} onClick={() => setOpen(o => !o)}
          onMouseEnter={e => { e.currentTarget.style.transform='scale(1.08)'; e.currentTarget.style.boxShadow='0 6px 28px rgba(12,99,250,0.55)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(12,99,250,0.45)'; }}>
          {streaming ? <ThunderboltOutlined style={{ color:'#fff', fontSize:22 }}/> : <RobotOutlined style={{ color:'#fff', fontSize:22 }}/>}
        </button>
      </Tooltip>
      {open && (
        <div style={S.panel}>
          <div style={S.header}>
            <RobotOutlined style={{ color:'#0c63fa', fontSize:18 }}/>
            <div style={{ flex:1 }}>
              <div style={S.headerTitle}>Assistant AIOps</div>
              <div style={S.headerSub}>
                {streaming
                  ? <span style={{ color:'#0c63fa' }}><ThunderboltOutlined style={{ fontSize:10, marginRight:4 }}/>Génération en cours…</span>
                  : 'OpenStack · Multi-agents · Llama 3.3'}
              </div>
            </div>
            <Tooltip title="Effacer"><Button size="small" icon={<ClearOutlined/>} onClick={clearChat} type="text" style={{ color:'#888' }}/></Tooltip>
            <Button size="small" icon={<CloseOutlined/>} onClick={() => setOpen(false)} type="text" style={{ color:'#888' }}/>
          </div>
          <div style={S.messages}>
            {messages.map((msg, i) => renderMessage(msg, i))}
            {streaming && <TypingIndicator/>}
            <div ref={messagesEndRef}/>
          </div>
          <div style={S.footer}>
            <TextArea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ex : liste mes instances, crée une instance…"
              autoSize={{ minRows:1, maxRows:4 }} style={S.textarea} disabled={streaming}/>
            <Button type="primary" icon={<SendOutlined/>} onClick={() => sendMessage()}
              disabled={!input.trim() || streaming} style={S.sendBtn}/>
          </div>
        </div>
      )}
    </>
  );
}

// Export via ReactDOM.createPortal — monté sur document.body
// Visible sur TOUTES les pages, indépendamment des erreurs de page
// Auto-mount au chargement du module — indépendant de React tree
let _mounted = false;

function mountAiAgent() {
  if (_mounted) return;
  if (!document.body) return;
  _mounted = true;
  const existing = document.getElementById('aiops-agent-portal');
  if (existing) return;
  const container = document.createElement('div');
  container.id = 'aiops-agent-portal';
  document.body.appendChild(container);
  ReactDOM.render(<AiAgentWidget />, container);
}

// Attendre 2 secondes que React/Skyline soit initialisé
setTimeout(mountAiAgent, 2000);

export default function AiAgent() {
  useEffect(() => {
    mountAiAgent();
  }, []);
  return null;
}
