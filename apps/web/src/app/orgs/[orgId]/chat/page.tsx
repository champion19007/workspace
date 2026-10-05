'use client';

import React, { useState } from 'react';
import { Send, Bot, User, ShieldAlert, ArrowUpRight } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  citations?: string[];
  timestamp: string;
}

export default function AskAiPage() {

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      sender: 'assistant',
      content:
        'Hello! I am your Workspace v1 assistant. I can help search across your organization’s meetings, transcripts, notes, and task system of record with strict tenant isolation.',
      timestamp: 'Just now',
    },
  ]);

  const promptSuggestions = [
    'What action items were agreed upon in yesterday’s platform sync?',
    'Summarize open tasks in Platform Core & Multi-Tenancy',
    'Who is assigned to the Fastify API contract review?',
  ];

  const handleSend = (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      content: text.trim(),
      timestamp: 'Just now',
    };

    const assistantReply: ChatMessage = {
      id: `a-${Date.now()}`,
      sender: 'assistant',
      content:
        'Under Stage 21 (P1 Feature), I will execute a hybrid search (pgvector cosine + tsvector GIN) across verified organization chunks, generating answers with strict evidence citations.',
      citations: ['chunk:019318ef-0001', 'chunk:019318ef-0004'],
      timestamp: 'Just now',
    };

    setMessages((prev) => [...prev, userMsg, assistantReply]);
    setInput('');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
      {/* P1 Feature Warning Banner (Screenshot 943 reference) */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs">
          <div className="font-bold text-amber-300">
            P1 Feature Preview: Ask AI Assistant
          </div>
          <p className="text-amber-200/80 mt-0.5 leading-relaxed">
            This capability is preserved for Stage 21 per the product requirements. Full
            hybrid search and evidence citation validation will be wired to the vector database.
          </p>
        </div>
      </div>

      {/* Main Chat Container */}
      <div className="rounded-2xl bg-panel border border-border-subtle flex flex-col h-[580px] overflow-hidden shadow-xl">
        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${
                msg.sender === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  msg.sender === 'user'
                    ? 'bg-accent text-accent-foreground font-bold'
                    : 'bg-panel-inset border border-border-subtle text-accent'
                }`}
              >
                {msg.sender === 'user' ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>

              <div
                className={`max-w-lg p-3.5 rounded-2xl text-xs space-y-2 leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-accent text-accent-foreground font-medium rounded-tr-none'
                    : 'bg-panel-elevated border border-border-subtle text-foreground rounded-tl-none'
                }`}
              >
                <p>{msg.content}</p>

                {msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2 border-t border-border-subtle/60 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold">
                      Grounding Citations:
                    </span>
                    {msg.citations.map((c, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-panel-inset text-accent border border-border-subtle"
                      >
                        [{c}]
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Suggested Prompts */}
        <div className="px-5 py-2.5 bg-panel-inset/50 border-t border-border-subtle flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase shrink-0">
            Suggested:
          </span>
          {promptSuggestions.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(prompt)}
              className="text-[11px] text-muted-foreground hover:text-foreground bg-panel border border-border-subtle hover:border-accent/40 px-2.5 py-1 rounded-lg shrink-0 transition-colors flex items-center gap-1"
            >
              <span>{prompt}</span>
              <ArrowUpRight className="w-3 h-3 text-accent" />
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-panel-inset border-t border-border-subtle flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about meetings, notes, or tasks across your organization..."
            className="flex-1 bg-panel border border-border-subtle px-3.5 py-2.5 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => handleSend()}
            aria-label="Send message"
            className="p-2.5 rounded-xl bg-accent text-accent-foreground font-bold hover:opacity-90 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
