'use client';

import React, { useState } from 'react';
import { Plus, CheckCircle2, Clock, Circle } from 'lucide-react';
import { PriorityBadge, TaskPriority } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';

interface BoardTask {
  id: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'completed';
  priority: TaskPriority;
  assigneeName: string;
  dueDate: string;
}

const INITIAL_BOARD_TASKS: BoardTask[] = [
  {
    id: 'b-1',
    key: 'CORE-4',
    title: 'Generate OpenAPI 3.1 contracts and RFC 9457 error handler',
    status: 'todo',
    priority: 'medium',
    assigneeName: 'Rohan Gupta',
    dueDate: '2026-10-20',
  },
  {
    id: 'b-2',
    key: 'CORE-5',
    title: 'Implement ltree tree relocation with GiST indexing',
    status: 'todo',
    priority: 'medium',
    assigneeName: 'Priya Sharma',
    dueDate: '2026-10-25',
  },
  {
    id: 'b-3',
    key: 'CORE-3',
    title: 'Build application shell with dark charcoal palette and dynamic accent color',
    status: 'in_progress',
    priority: 'high',
    assigneeName: 'Alex Mercer',
    dueDate: '2026-10-15',
  },
  {
    id: 'b-4',
    key: 'CORE-1',
    title: 'Enforce PostgreSQL RLS and compound foreign key tenant boundaries',
    status: 'completed',
    priority: 'urgent',
    assigneeName: 'Alex Mercer',
    dueDate: '2026-10-10',
  },
  {
    id: 'b-5',
    key: 'CORE-2',
    title: 'Implement Supabase Auth PKCE callback and 30-day rolling session cookie',
    status: 'completed',
    priority: 'high',
    assigneeName: 'Priya Sharma',
    dueDate: '2026-10-12',
  },
];

export default function KanbanBoardPage() {
  const [tasks, setTasks] = useState<BoardTask[]>(INITIAL_BOARD_TASKS);
  const [modalColumn, setModalColumn] = useState<'todo' | 'in_progress' | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newAssignee, setNewAssignee] = useState('Alex Mercer');

  const columns = [
    {
      id: 'todo' as const,
      title: 'To Do',
      dotClass: 'bg-accent shadow-[0_0_8px_var(--accent,#d86dfc)]',
      icon: <Circle className="w-3.5 h-3.5 text-accent" />,
      tasks: tasks.filter((t) => t.status === 'todo'),
    },
    {
      id: 'in_progress' as const,
      title: 'In Progress',
      dotClass: 'bg-amber-400 shadow-[0_0_8px_#fbbf24]',
      icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
      tasks: tasks.filter((t) => t.status === 'in_progress'),
    },
    {
      id: 'completed' as const,
      title: 'Completed',
      dotClass: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
      tasks: tasks.filter((t) => t.status === 'completed'),
    },
  ];

  const handleMoveStatus = (taskId: string, targetStatus: 'todo' | 'in_progress' | 'completed') => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t))
    );
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !modalColumn) return;

    const newTask: BoardTask = {
      id: `b-${Date.now()}`,
      key: `CORE-${tasks.length + 1}`,
      title: newTitle.trim(),
      status: modalColumn,
      priority: newPriority,
      assigneeName: newAssignee,
      dueDate: new Date().toISOString().split('T')[0],
    };

    setTasks((prev) => [newTask, ...prev]);
    setNewTitle('');
    setModalColumn(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Kanban Board
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visualize project workflow states and task progression.
          </p>
        </div>
      </div>

      {/* 3-Column Kanban Board Matching Screenshot 929 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {columns.map((col) => (
          <div
            key={col.id}
            className="flex flex-col rounded-2xl bg-panel border border-border-subtle p-4 min-h-[500px]"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full inline-block ${col.dotClass}`} />
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  {col.title}
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.2 rounded-full bg-panel-inset text-muted-foreground border border-border-subtle">
                  {col.tasks.length}
                </span>
              </div>

              {col.id !== 'completed' && (
                <button
                  onClick={() => setModalColumn(col.id)}
                  aria-label={`Add task to ${col.title}`}
                  className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Task Cards Container */}
            <div className="flex-1 space-y-3 overflow-y-auto">
              {col.tasks.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-center text-xs text-muted-foreground border border-dashed border-border-subtle rounded-xl">
                  No tasks in this column
                </div>
              ) : (
                col.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-3.5 rounded-xl bg-panel-elevated border border-border-subtle hover:border-accent/40 transition-all space-y-2.5 shadow-sm group"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-muted-foreground">
                        {task.key}
                      </span>
                      <PriorityBadge priority={task.priority} size="sm" />
                    </div>

                    <h4 className="text-xs font-semibold text-foreground group-hover:text-accent transition-colors leading-snug">
                      {task.title}
                    </h4>

                    <div className="pt-2 border-t border-border-subtle/60 flex items-center justify-between text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[9px] font-bold text-accent uppercase">
                          {task.assigneeName.charAt(0)}
                        </div>
                        <span className="truncate max-w-[100px]">{task.assigneeName}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px]">{task.dueDate}</span>
                        {/* Quick Status Shift */}
                        {col.id === 'todo' && (
                          <button
                            onClick={() => handleMoveStatus(task.id, 'in_progress')}
                            title="Start Progress"
                            className="text-[10px] text-amber-400 hover:underline"
                          >
                            &rarr;
                          </button>
                        )}
                        {col.id === 'in_progress' && (
                          <button
                            onClick={() => handleMoveStatus(task.id, 'completed')}
                            title="Complete"
                            className="text-[10px] text-emerald-400 hover:underline"
                          >
                            &rarr;
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Task to Column Dialog */}
      <Dialog
        isOpen={modalColumn !== null}
        onClose={() => setModalColumn(null)}
        title={`Add Task to ${modalColumn === 'todo' ? 'To Do' : 'In Progress'}`}
      >
        <form onSubmit={handleAddTask} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Title
            </label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Setup Redis cache for Fastify session auth"
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Priority
              </label>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs focus:outline-none"
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Assignee
              </label>
              <input
                type="text"
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalColumn(null)}
              className="px-4 py-2 rounded-xl border border-border-subtle hover:bg-panel-elevated text-xs font-medium text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs"
            >
              Add Card
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
