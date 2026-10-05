'use client';

import React, { useState } from 'react';
import { FileText, Plus, Search, Clock } from 'lucide-react';
import { EmptyState } from '@/components/ui/table-shell';
import { Dialog } from '@/components/ui/dialog';

interface DocItem {
  id: string;
  title: string;
  excerpt: string;
  author: string;
  updatedAt: string;
  category: string;
}

const INITIAL_DOCS: DocItem[] = [
  {
    id: 'doc-1',
    title: 'Workspace v1 System Design & Product Requirements',
    excerpt: 'Core product specification for multi-tenant isolation, Zoom integration, and human approvals.',
    author: 'Alex Mercer',
    updatedAt: '2026-10-05',
    category: 'Architecture',
  },
  {
    id: 'doc-2',
    title: 'PostgreSQL Multi-Tenancy & Row-Level Security Playbook',
    excerpt: 'Security guidelines for compound foreign keys and transaction-scoped app.org_id configuration.',
    author: 'Priya Sharma',
    updatedAt: '2026-10-04',
    category: 'Engineering',
  },
  {
    id: 'doc-3',
    title: 'Design Partner Launch Onboarding Protocol',
    excerpt: 'Step-by-step checklist for inviting initial design partner organizations to Workspace v1.',
    author: 'Rohan Gupta',
    updatedAt: '2026-10-02',
    category: 'Operations',
  },
];

export default function DocsPage() {
  const [docs, setDocs] = useState<DocItem[]>(INITIAL_DOCS);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newExcerpt, setNewExcerpt] = useState('');
  const [newCategory, setNewCategory] = useState('General');

  const filtered = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newDoc: DocItem = {
      id: `doc-${Date.now()}`,
      title: newTitle.trim(),
      excerpt: newExcerpt.trim() || 'New workspace document.',
      author: 'Alex Mercer',
      updatedAt: new Date().toISOString().split('T')[0],
      category: newCategory,
    };

    setDocs((prev) => [newDoc, ...prev]);
    setNewTitle('');
    setNewExcerpt('');
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Documents Directory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Knowledge base, product specifications, and team documentation.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Document</span>
        </button>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-xl bg-panel border border-border-subtle">
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents by title or keyword..."
            className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents found"
          description="Create your first document to store guidelines and meeting recaps."
          action={{
            label: "+ New Document",
            onClick: () => setIsModalOpen(true),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((doc) => (
            <div
              key={doc.id}
              className="p-5 rounded-xl bg-panel border border-border-subtle hover:border-accent/40 transition-all flex flex-col justify-between space-y-4 shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-panel-inset text-accent border border-border-subtle uppercase">
                    {doc.category}
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{doc.updatedAt}</span>
                  </div>
                </div>

                <h3 className="text-sm font-bold text-foreground leading-snug mb-1.5 hover:text-accent transition-colors cursor-pointer">
                  {doc.title}
                </h3>

                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {doc.excerpt}
                </p>
              </div>

              <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[10px] font-bold text-accent">
                    {doc.author.charAt(0)}
                  </div>
                  <span className="text-[11px]">{doc.author}</span>
                </div>
                <span className="text-accent text-[11px] font-semibold hover:underline cursor-pointer">
                  Read &rarr;
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Document"
      >
        <form onSubmit={handleCreateDoc} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Title
            </label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Design Partner API Guidelines"
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Category
            </label>
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Summary Excerpt
            </label>
            <textarea
              rows={3}
              value={newExcerpt}
              onChange={(e) => setNewExcerpt(e.target.value)}
              placeholder="Brief overview of content..."
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs focus:outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle hover:bg-panel-elevated text-xs font-medium text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs"
            >
              Create Document
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
