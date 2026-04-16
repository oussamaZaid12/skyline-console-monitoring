// AI Agent OpenStack — Interface de chat
// Author: Oussama Zaied - ESPRIT

import React, { Component } from 'react';
import { inject, observer } from 'mobx-react';
import { Input, Button, Spin, Avatar } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined, ClearOutlined } from '@ant-design/icons';

const COLOR = {
  primary:     '#0c63fa',
  textTitle:   'rgba(0,0,0,0.85)',
  textBody:    'rgba(0,0,0,0.65)',
  textCaption: 'rgba(0,0,0,0.45)',
  border:      '#ccd3db',
  bg:          '#f0f1f7',
  bgCard:      '#ffffff',
};

const TypingDots = () => (
  <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
    {[0, 1, 2].map(i => (
      <div key={i} style={{
        width: 7, height: 7, borderRadius: '50%', background: COLOR.textCaption,
        animation: `typing-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
      }} />
    ))}
    <style>{`@keyframes typing-bounce { 0%,80%,100%{transform:scale(0.7);opacity:0.4} 40%{transform:scale(1);opacity:1} }`}</style>
  </div>
);

const Message = ({ msg }) => {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 10, marginBottom: 16, alignItems: 'flex-start' }}>
      <Avatar size={32} icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{ background: isUser ? COLOR.primary : '#5f708a', flexShrink: 0 }} />
      <div style={{
        maxWidth: '75%', background: isUser ? COLOR.primary : COLOR.bgCard,
        color: isUser ? '#fff' : COLOR.textBody,
        borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        padding: '10px 14px', fontSize: 13, lineHeight: 1.6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  );
};

@inject('rootStore')
@observer
export default class AiAgent extends Component {
  constructor(props) {
    super(props);
    this.state = {
      messages: [{
        role: 'assistant',
        content: 'Bonjour ! Je suis votre assistant OpenStack. Je peux vous aider à :\n• Lister vos instances, flavors, images et réseaux\n• Créer ou supprimer des instances\n• Consulter les métriques CPU/RAM d\'une instance\n\nComment puis-je vous aider ?',
      }],
      input: '', loading: false,
    };
    this.messagesEndRef = React.createRef();
    this.inputRef = React.createRef();
  }

  componentDidUpdate() {
    if (this.messagesEndRef.current)
      this.messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }

  sendMessage = async () => {
    const { input, messages, loading } = this.state;
    if (!input.trim() || loading) return;
    const userMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    this.setState({ messages: newMessages, input: '', loading: true });
    try {
      const response = await fetch('/api/openstack/skyline/api/v1/ai-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage.content, history: messages.slice(-10) }),
      });
      const data = await response.json();
      this.setState(prev => ({
        messages: [...prev.messages, { role: 'assistant', content: data.response || 'Désolé, erreur.' }],
        loading: false,
      }));
    } catch (err) {
      this.setState(prev => ({
        messages: [...prev.messages, { role: 'assistant', content: `Erreur: ${err.message}` }],
        loading: false,
      }));
    }
    setTimeout(() => this.inputRef.current?.focus(), 100);
  };

  handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
  };

  clearHistory = () => this.setState({
    messages: [{ role: 'assistant', content: 'Conversation réinitialisée. Comment puis-je vous aider ?' }],
  });

  render() {
    const { messages, input, loading } = this.state;
    const suggestions = ['Liste mes instances', 'Quels flavors sont disponibles ?', 'Métriques de web-server-1', 'Créer une instance'];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', background: COLOR.bg, padding: 16, gap: 12 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: COLOR.bgCard, borderRadius: 4, padding: '12px 16px', boxShadow: '0 2px 6px rgba(36,46,66,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={36} icon={<RobotOutlined />} style={{ background: COLOR.primary }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLOR.textTitle }}>Assistant OpenStack</div>
              <div style={{ fontSize: 11, color: '#52c41a' }}>En ligne · Llama 3.3 70B via Groq</div>
            </div>
          </div>
          <Button icon={<ClearOutlined />} size="small" onClick={this.clearHistory}
            style={{ color: COLOR.textCaption, border: `1px solid ${COLOR.border}` }}>
            Réinitialiser
          </Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: COLOR.bgCard, borderRadius: 4, padding: 16, boxShadow: '0 2px 6px rgba(36,46,66,0.06)' }}>
          {messages.map((msg, i) => <Message key={i} msg={msg} />)}
          {loading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
              <Avatar size={32} icon={<RobotOutlined />} style={{ background: '#5f708a', flexShrink: 0 }} />
              <div style={{ background: COLOR.bgCard, borderRadius: '12px 12px 12px 4px', padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={this.messagesEndRef} />
        </div>

        {messages.length <= 2 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => this.setState({ input: s }, this.sendMessage)}
                style={{ background: COLOR.bgCard, border: `1px solid ${COLOR.border}`, borderRadius: 16, padding: '6px 14px', fontSize: 12, color: COLOR.textBody, cursor: 'pointer' }}
                onMouseEnter={e => e.target.style.borderColor = COLOR.primary}
                onMouseLeave={e => e.target.style.borderColor = COLOR.border}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, background: COLOR.bgCard, borderRadius: 4, padding: '10px 12px', boxShadow: '0 2px 6px rgba(36,46,66,0.06)', border: `1px solid ${COLOR.border}` }}>
          <Input.TextArea ref={this.inputRef} value={input}
            onChange={e => this.setState({ input: e.target.value })}
            onKeyDown={this.handleKeyDown}
            placeholder="Tapez votre message... (Entrée pour envoyer)"
            autoSize={{ minRows: 1, maxRows: 4 }} disabled={loading}
            style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 13, background: 'transparent', boxShadow: 'none' }} />
          <Button type="primary" icon={loading ? <Spin size="small" /> : <SendOutlined />}
            onClick={this.sendMessage} disabled={!input.trim() || loading}
            style={{ background: COLOR.primary, border: 'none', borderRadius: 6, height: 36, width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }} />
        </div>
      </div>
    );
  }
}