// AiAgent.jsx — Phase 3 : multi-agents + boutons de confirmation
// Author: Oussama Zaied - ESPRIT 2024-2025

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Input, Tooltip } from 'antd';
import {
  RobotOutlined,
  SendOutlined,
  CloseOutlined,
  ClearOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

const API_BASE = '/api/openstack/skyline/api/v1';

// Nouveau conversation_id à chaque session — évite les threads corrompus
const getConvId = () => crypto.randomUUID();

// ── Styles ──────────────────────────────────────────────────────────────────

const S = {
  fab: {
    position: 'fixed',
    bottom: 28,
    right: 28,
    zIndex: 1200,
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #0c63fa 0%, #5b8df7 100%)',
    border: 'none',
    boxShadow: '0 4px 20px rgba(12,99,250,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  panel: {
    position: 'fixed',
    bottom: 92,
    right: 28,
    zIndex: 1200,
    width: 420,
    height: 580,
    background: 'var(--color-background-primary)',
    borderRadius: 16,
    boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid var(--color-border-tertiary)',
  },
  header: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--color-border-tertiary)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--color-background-secondary)',
  },
  headerTitle: {
    flex: 1,
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--color-text-primary)',
  },
  headerSub: {
    fontSize: 11,
    color: 'var(--color-text-tertiary)',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  bubble: (role) => ({
    maxWidth: '85%',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    background: role === 'user'
      ? 'linear-gradient(135deg, #0c63fa, #3b82f6)'
      : 'var(--color-background-secondary)',
    color: role === 'user' ? '#fff' : 'var(--color-text-primary)',
    borderRadius: role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
    padding: '9px 13px',
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    border: role === 'user' ? 'none' : '1px solid var(--color-border-tertiary)',
  }),
  confirmBox: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    background: '#fffbeb',
    border: '1px solid #f59e0b',
    borderRadius: '16px 16px 16px 4px',
    padding: '12px 14px',
    fontSize: 13,
    lineHeight: 1.55,
  },
  confirmQuestion: {
    color: '#92400e',
    marginBottom: 10,
    fontWeight: 500,
  },
  confirmButtons: {
    display: 'flex',
    gap: 8,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'var(--color-text-tertiary)',
    display: 'inline-block',
    margin: '0 2px',
  },
  footer: {
    padding: '10px 14px',
    borderTop: '1px solid var(--color-border-tertiary)',
    background: 'var(--color-background-secondary)',
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    resize: 'none',
    borderRadius: 10,
    fontSize: 13,
  },
  sendBtn: {
    background: '#0c63fa',
    borderColor: '#0c63fa',
    borderRadius: 10,
    height: 36,
    minWidth: 36,
    padding: '0 12px',
  },
};

// ── Parser de confirmation ───────────────────────────────────────────────────
// Détecte si le contenu d'un message est une demande de confirmation JSON

function parseConfirmation(content) {
  // Cherche un JSON de confirmation dans le contenu
  try {
    // Cas 1 : contenu entièrement JSON
    const parsed = JSON.parse(content);
    if (parsed.type === 'confirmation_required') return parsed;
  } catch {}

  // Cas 2 : JSON embarqué dans du texte
  const match = content.match(/\{[^}]*"type"\s*:\s*"confirmation_required"[^}]*\}/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.type === 'confirmation_required') return parsed;
    } catch {}
  }

  // Cas 3 : CONFIRMATION REQUISE: texte (format texte simple)
  if (content.startsWith('CONFIRMATION REQUISE:')) {
    return {
      type: 'confirmation_required',
      question: content.replace('CONFIRMATION REQUISE:', '').trim(),
      confirm_text: 'Confirmer',
      cancel_text:  'Annuler',
    };
  }

  return null;
}

// ── Composant ────────────────────────────────────────────────────────────────

export default function AiAgent() {
  const [open, setOpen]           = useState(false);
  const [input, setInput]         = useState('');
  const [messages, setMessages]   = useState([{
    role: 'assistant',
    content: 'Bonjour ! Je suis votre assistant AIOps OpenStack.\n\nJe peux vous aider à :\n• Lister instances, flavors, images, volumes, réseaux\n• Créer ou supprimer des instances et volumes\n• Gérer les floating IPs et routers\n• Diagnostiquer les erreurs infrastructure\n\nComment puis-je vous aider ?',
  }]);
  const [streaming, setStreaming]   = useState(false);
  const [streamingText, setStreamingText] = useState('');
  // conversation_id nouveau à chaque ouverture de session
  const [convId]                  = useState(getConvId);
  // Garde trace des messages de confirmation déjà répondus
  const [answeredConfirms, setAnsweredConfirms] = useState(new Set());

  const messagesEndRef = useRef(null);
  const abortRef       = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // ── Envoi d'un message texte ─────────────────────────────────────────────

  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || streaming) return;

    const userMsg = { role: 'user', content: msg };
    const history = messages.filter(m => m.role !== 'system');
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamingText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${API_BASE}/ai-agent/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history, conversation_id: convId }),
        signal: controller.signal,
      });

      const data = await resp.json();
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.response || 'Pas de réponse.' },
      ]);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Impossible de joindre le service agent.' },
      ]);
    } finally {
      setStreaming(false);
      setStreamingText('');
    }
  }, [input, streaming, messages, convId]);

  // ── Confirmation — l'utilisateur clique Confirmer ou Annuler ─────────────

  const handleConfirm = useCallback((msgIndex, confirmed) => {
    // Marquer ce message comme répondu (cache le bouton)
    setAnsweredConfirms(prev => new Set([...prev, msgIndex]));

    const reply = confirmed ? 'CONFIRMED' : 'CANCELLED';
    sendMessage(reply);
  }, [sendMessage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([{
      role: 'assistant',
      content: 'Conversation réinitialisée. Comment puis-je vous aider ?',
    }]);
    setStreamingText('');
    setStreaming(false);
    setAnsweredConfirms(new Set());
  };

  // ── Rendu d'un message (texte ou confirmation) ───────────────────────────

  const renderMessage = (msg, i) => {
    if (msg.role !== 'assistant') {
      return (
        <div key={i} style={S.bubble('user')}>
          {msg.content}
        </div>
      );
    }

    const confirm = parseConfirmation(msg.content);
    const alreadyAnswered = answeredConfirms.has(i);

    // Message de confirmation avec boutons
    if (confirm && !alreadyAnswered) {
      return (
        <div key={i} style={S.confirmBox}>
          <div style={S.confirmQuestion}>
            ⚠️ {confirm.question}
          </div>
          <div style={S.confirmButtons}>
            <Button
              type="primary"
              size="small"
              icon={<CheckCircleOutlined />}
              style={{ background: '#16a34a', borderColor: '#16a34a', borderRadius: 8 }}
              onClick={() => handleConfirm(i, true)}
            >
              {confirm.confirm_text || 'Confirmer'}
            </Button>
            <Button
              danger
              size="small"
              icon={<CloseCircleOutlined />}
              style={{ borderRadius: 8 }}
              onClick={() => handleConfirm(i, false)}
            >
              {confirm.cancel_text || 'Annuler'}
            </Button>
          </div>
        </div>
      );
    }

    // Message de confirmation déjà répondu — affiche en grisé
    if (confirm && alreadyAnswered) {
      return (
        <div key={i} style={{
          ...S.confirmBox,
          opacity: 0.5,
          background: '#f3f4f6',
          border: '1px solid #d1d5db',
        }}>
          <div style={{ color: '#6b7280', fontSize: 12 }}>
            ✓ {confirm.question}
          </div>
        </div>
      );
    }

    // Message texte normal
    return (
      <div key={i} style={S.bubble('assistant')}>
        {msg.content}
      </div>
    );
  };

  // ── Indicateur de frappe ─────────────────────────────────────────────────

  const TypingIndicator = () => (
    <div style={{ ...S.bubble('assistant'), padding: '10px 14px' }}>
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
        .dot1 { animation: bounce 1.2s infinite 0s; }
        .dot2 { animation: bounce 1.2s infinite 0.2s; }
        .dot3 { animation: bounce 1.2s infinite 0.4s; }
      `}</style>
      <span className="dot1" style={S.typingDot} />
      <span className="dot2" style={S.typingDot} />
      <span className="dot3" style={S.typingDot} />
    </div>
  );

  // ── Rendu principal ──────────────────────────────────────────────────────

  return (
    <>
      <Tooltip title="Assistant AIOps" placement="left">
        <button
          style={S.fab}
          onClick={() => setOpen(o => !o)}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.08)';
            e.currentTarget.style.boxShadow = '0 6px 28px rgba(12,99,250,0.55)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(12,99,250,0.45)';
          }}
        >
          {streaming
            ? <ThunderboltOutlined style={{ color: '#fff', fontSize: 22 }} />
            : <RobotOutlined       style={{ color: '#fff', fontSize: 22 }} />
          }
        </button>
      </Tooltip>

      {open && (
        <div style={S.panel}>
          {/* Header */}
          <div style={S.header}>
            <RobotOutlined style={{ color: '#0c63fa', fontSize: 18 }} />
            <div style={{ flex: 1 }}>
              <div style={S.headerTitle}>Assistant AIOps</div>
              <div style={S.headerSub}>
                {streaming
                  ? <span style={{ color: '#0c63fa' }}>
                      <ThunderboltOutlined style={{ fontSize: 10, marginRight: 4 }} />
                      Génération en cours…
                    </span>
                  : 'OpenStack · Multi-agents · Llama 3.3'
                }
              </div>
            </div>
            <Tooltip title="Effacer la conversation">
              <Button
                size="small"
                icon={<ClearOutlined />}
                onClick={clearChat}
                type="text"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
            </Tooltip>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setOpen(false)}
              type="text"
              style={{ color: 'var(--color-text-tertiary)' }}
            />
          </div>

          {/* Messages */}
          <div style={S.messages}>
            {messages.map((msg, i) => renderMessage(msg, i))}

            {streaming && !streamingText && <TypingIndicator />}

            <div ref={messagesEndRef} />
          </div>

          {/* Footer */}
          <div style={S.footer}>
            <TextArea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ex : liste mes instances, crée une instance…"
              autoSize={{ minRows: 1, maxRows: 4 }}
              style={S.textarea}
              disabled={streaming}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => sendMessage()}
              disabled={!input.trim() || streaming}
              style={S.sendBtn}
            />
          </div>
        </div>
      )}
    </>
  );
}
