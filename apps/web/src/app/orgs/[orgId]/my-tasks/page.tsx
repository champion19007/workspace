'use client';

import React, { useState } from 'react';
import { Search, Calendar, Check, CheckSquare } from 'lucide-react';
import { TableShell, EmptyState } from '@/components/ui/table-shell';
import { StatusBadge, PriorityBadge, TaskStatus, TaskPriority } from '@/components/ui/badge';

interface MyTaskItem {
  id: string;
  key: string;
  projectKey: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  category: 'pending' | 'overdue' | 'due_today' | 'upcoming';
}

const SAMPLE_MY_TASKS: MyTaskItem[] = [
  {
    id: 'mt-1',
    key: 'CORE-3',
    projectKey: 'CORE',
    title: 'Build application shell with dark charcoal palette and dynamic accent color',
    status: 'in_progress',
    priority: 'high',
    dueDate: '2026-10-15',
    category: 'pending',
  },
  {
    id: 'mt-2',
    key: 'CORE-1',
    projectKey: 'CORE',
    title: 'Enforce PostgreSQL RLS and compound foreign key tenant boundaries',
    status: 'completed',
    priority: 'urgent',
    dueDate: '2026-10-10',
    category: 'pending',
  },
  {
    id: 'mt-3',
    key: 'API-1',
    projectKey: 'API',
    title: 'Prepare OpenAPI 3.1 documentation endpoints for Fastify',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-10-05',
    category: 'due_today',
  },
  {
    id: 'mt-4',
    key: 'TREE-2',
    projectKey: 'TREE',
    title: 'Implement atomic subtree relocation using ltree path operators',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-10-25',
    category: 'upcoming',
  },
];

type ChipFilter = 'all' | 'pending' | 'overdue' | 'due_today' | 'upcoming';

export default function MyTasksPage() {
  const [activeChip, setActiveChip] = useState<ChipFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState<MyTaskItem[]>(SAMPLE_MY_TASKS);

  const chips: { id: ChipFilter; label: string }[] = [
    { id: 'all', label: 'My Tasks' },
    { id: 'pending', label: 'Pending' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'due_today', label: 'Due Today' },
    { id: 'upcoming', label: 'Upcoming' },
  ];

  const filtered = tasks.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.key.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeChip === 'all') return true;
    if (activeChip === 'pending') return t.status !== 'completed';
    return t.category === activeChip;
  });

  const toggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: t.status === 'completed' ? 'todo' : 'completed' }
          : t
      )
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Matching Screenshot 938 */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
          My Tasks
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Action items and deliverables assigned to you across all projects.
        </p>
      </div>

      {/* Search & Filter Row with Chips Matching Screenshot 938 */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input */}
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-panel border border-border-subtle text-xs text-foreground">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter your assigned tasks..."
              className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
            />
          </div>
        </div>

        {/* Status Chips Row */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {chips.map((chip) => {
            const isSelected = activeChip === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => setActiveChip(chip.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'bg-panel border border-border-subtle text-muted-foreground hover:text-foreground hover:bg-panel-elevated'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table Shell / Tasks List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks match this filter"
          description="You are caught up on all tasks under this filter view."
        />
      ) : (
        <TableShell>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-panel-inset border-b border-border-subtle text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                <th className="py-3 px-4 w-10">Done</th>
                <th className="py-3 px-4">Task Key & Title</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {filtered.map((task) => (
                <tr
                  key={task.id}
                  className="hover:bg-panel-elevated/40 transition-colors"
                >
                  <td className="py-3 px-4">
                    <button
                      onClick={() => toggleTask(task.id)}
                      aria-label={`Toggle task ${task.key} completion`}
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        task.status === 'completed'
                          ? 'bg-accent border-accent text-accent-foreground'
                          : 'border-border-strong hover:border-accent text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </button>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-panel-inset text-muted-foreground border border-border-subtle">
                        {task.key}
                      </span>
                      <span
                        className={`font-medium ${
                          task.status === 'completed'
                            ? 'line-through text-muted-foreground'
                            : 'text-foreground'
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded bg-panel-inset border border-border-subtle text-accent">
                      {task.projectKey}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <StatusBadge status={task.status} size="sm" />
                  </td>

                  <td className="py-3 px-4">
                    <PriorityBadge priority={task.priority} size="sm" />
                  </td>

                  <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>{task.dueDate}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}
