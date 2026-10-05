'use client';

import React, { useState } from 'react';
import {
  Search,
  Plus,
  Filter,
  CheckSquare,
  Calendar,
  Check,
} from 'lucide-react';
import { TableShell, EmptyState } from '@/components/ui/table-shell';
import {
  StatusBadge,
  PriorityBadge,
  TaskStatus,
  TaskPriority,
} from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';

interface TaskItem {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string;
  dueDate: string;
}

const INITIAL_TASKS: TaskItem[] = [
  {
    id: 't-1',
    key: 'CORE-1',
    title: 'Enforce PostgreSQL RLS and compound foreign key tenant boundaries',
    status: 'completed',
    priority: 'urgent',
    assigneeName: 'Alex Mercer',
    dueDate: '2026-10-10',
  },
  {
    id: 't-2',
    key: 'CORE-2',
    title: 'Implement Supabase Auth PKCE callback and 30-day rolling session cookie',
    status: 'completed',
    priority: 'high',
    assigneeName: 'Priya Sharma',
    dueDate: '2026-10-12',
  },
  {
    id: 't-3',
    key: 'CORE-3',
    title: 'Build application shell with dark charcoal palette and dynamic accent color',
    status: 'in_progress',
    priority: 'high',
    assigneeName: 'Alex Mercer',
    dueDate: '2026-10-15',
  },
  {
    id: 't-4',
    key: 'CORE-4',
    title: 'Generate OpenAPI 3.1 contracts and RFC 9457 error handler',
    status: 'todo',
    priority: 'medium',
    assigneeName: 'Rohan Gupta',
    dueDate: '2026-10-20',
  },
  {
    id: 't-5',
    key: 'CORE-5',
    title: 'Implement ltree tree relocation with GiST indexing',
    status: 'todo',
    priority: 'medium',
    assigneeName: 'Priya Sharma',
    dueDate: '2026-10-25',
  },
];

export function TasksPageView() {
  const [tasks, setTasks] = useState<TaskItem[]>(INITIAL_TASKS);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // New task modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newAssignee, setNewAssignee] = useState('Alex Mercer');
  const [newDueDate, setNewDueDate] = useState('2026-10-30');

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.key.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const handleToggleComplete = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: t.status === 'completed' ? 'todo' : 'completed' }
          : t
      )
    );
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newTask: TaskItem = {
      id: `t-${Date.now()}`,
      key: `CORE-${tasks.length + 1}`,
      title: newTitle.trim(),
      status: 'todo',
      priority: newPriority,
      assigneeName: newAssignee,
      dueDate: newDueDate,
    };

    setTasks((prev) => [newTask, ...prev]);
    setNewTitle('');
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Project Tasks
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            System of record tasks managed under hierarchical node trees.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Task</span>
        </button>
      </div>

      {/* Toolbar Matching Screenshot 928 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 rounded-xl bg-panel border border-border-subtle">
        {/* Search Input */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks by title or key..."
            className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground hidden sm:inline" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg bg-panel-inset border border-border-subtle px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by priority"
            className="rounded-lg bg-panel-inset border border-border-subtle px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Tasks Table Shell Matching Screenshot 928 */}
      {filteredTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks found"
          description="Try adjusting your filters or search query, or create a new task for this project."
          action={{
            label: "+ Add Task",
            onClick: () => setIsModalOpen(true),
          }}
        />
      ) : (
        <TableShell>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-panel-inset border-b border-border-subtle text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                <th className="py-3 px-4 w-10">Done</th>
                <th className="py-3 px-4">Task Key & Title</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Assignee</th>
                <th className="py-3 px-4">Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  className="hover:bg-panel-elevated/40 transition-colors group"
                >
                  {/* Done Checkbox */}
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleToggleComplete(task.id)}
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

                  {/* Key & Title */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-panel-inset text-muted-foreground border border-border-subtle">
                        {task.key}
                      </span>
                      <span
                        className={`font-medium transition-all ${
                          task.status === 'completed'
                            ? 'line-through text-muted-foreground'
                            : 'text-foreground'
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-3 px-4">
                    <StatusBadge status={task.status} size="sm" />
                  </td>

                  {/* Priority */}
                  <td className="py-3 px-4">
                    <PriorityBadge priority={task.priority} size="sm" />
                  </td>

                  {/* Assignee */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <div className="w-5 h-5 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[10px] font-bold text-accent uppercase">
                        {task.assigneeName.charAt(0)}
                      </div>
                      <span className="truncate">{task.assigneeName}</span>
                    </div>
                  </td>

                  {/* Due Date */}
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

      {/* Add Task Modal Dialog */}
      <Dialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Task"
        description="Add a task to the current project system of record."
      >
        <form onSubmit={handleCreateTask} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Task Title
            </label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Implement Zoom webhook challenge response"
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

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Due Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs focus:outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle hover:bg-panel-elevated text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-opacity"
            >
              Create Task
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default function TasksPage() {
  return <TasksPageView />;
}
