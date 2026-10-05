'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { Search, Plus, FolderGit2 } from 'lucide-react';
import { ProjectCard, ProjectCardData } from '@/components/ui/project-card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/table-shell';

export default function ProjectsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [projects, setProjects] = useState<ProjectCardData[]>([
    {
      id: 'p-core',
      name: 'Platform Core & Multi-Tenancy',
      key: 'CORE',
      description: 'PostgreSQL RLS, database migrations, UUIDv7 keys, and tenant isolation.',
      leadName: 'Alex Mercer',
      taskCount: 5,
      completedCount: 2,
      orgId,
    },
    {
      id: 'p-api',
      name: 'Fastify API & Webhook Intake',
      key: 'API',
      description: 'Fastify REST gateway, Zoom webhook challenge response, and outbox relay.',
      leadName: 'Priya Sharma',
      taskCount: 8,
      completedCount: 3,
      orgId,
    },
    {
      id: 'p-tree',
      name: 'Organizational Tree & ltree',
      key: 'TREE',
      description: 'Hierarchical team nodes, project leaves, and atomic subtree relocation.',
      leadName: 'Rohan Gupta',
      taskCount: 4,
      completedCount: 1,
      orgId,
    },
    {
      id: 'p-ai',
      name: 'Extraction & Approvals Pipeline',
      key: 'AI',
      description: 'Meeting notes extraction, evidence grounding, and human-in-the-loop task approval.',
      leadName: 'Alex Mercer',
      taskCount: 10,
      completedCount: 0,
      orgId,
    },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newKey.trim()) return;

    const newProj: ProjectCardData = {
      id: `p-${Date.now()}`,
      name: newName.trim(),
      key: newKey.trim().toUpperCase(),
      description: newDesc.trim(),
      leadName: 'Alex Mercer',
      taskCount: 0,
      completedCount: 0,
      orgId,
    };

    setProjects((prev) => [newProj, ...prev]);
    setNewName('');
    setNewKey('');
    setNewDesc('');
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Matching Screenshot 941 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Projects Directory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Projects represent leaves in the organization tree that own tasks, notes, and documents.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {/* Toolbar Matching Screenshot 941 */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-panel border border-border-subtle">
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects by title, key, or scope..."
            className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
          />
        </div>
      </div>

      {/* Projects Grid Matching Screenshot 941 */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects found"
          description="Create your first project leaf to organize tasks, documents, and meeting action items."
          action={{
            label: "+ New Project",
            onClick: () => setIsModalOpen(true),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((proj) => (
            <ProjectCard key={proj.id} project={proj} />
          ))}
        </div>
      )}

      {/* New Project Dialog */}
      <Dialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Project"
        description="Projects own tasks and are assigned to teams within the organization tree."
      >
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Design Partner Integration"
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Project Key (Prefix for Tasks)
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g. DPI"
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              rows={3}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief summary of the project scope..."
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
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
              Create Project
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
