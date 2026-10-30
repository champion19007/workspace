import { describe, it, expect } from 'vitest';
import {
  generateInitialRank,
  generateRankBetween,
  compareRanks,
  getKolkataTodayDateString,
  addCalendarDays,
  type TaskDTO,
  type TaskStatus,
  type MyTasksCountsDTO,
} from '@workspace/core';

describe('Web Task Views Journey — Board Moves, Ordering & My Tasks Filtering', () => {
  const baseTask1: TaskDTO = {
    id: '019318ef-0000-7000-8000-000000000001',
    orgId: '019318ef-0000-7000-8000-000000000002',
    projectId: '019318ef-0000-7000-8000-000000000003',
    parentTaskId: null,
    key: 'CORE-1',
    title: 'Setup Database',
    description: null,
    status: 'todo',
    priority: 'high',
    assigneeId: 'user-1',
    assignee: { id: 'user-1', name: 'Dev One', email: 'dev1@example.com', avatarUrl: null },
    startDate: null,
    dueDate: '2026-10-01', // Overdue relative to 2026-10-06
    rank: 'a0',
    version: 1,
    source: 'manual',
    sourceRef: null,
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    labels: [],
    subtaskCount: 0,
  };

  const baseTask2: TaskDTO = {
    ...baseTask1,
    id: '019318ef-0000-7000-8000-000000000002',
    key: 'CORE-2',
    title: 'Build API Gateway',
    status: 'todo',
    rank: 'a1',
    version: 1,
    dueDate: '2026-10-06', // Due today
  };

  const baseTask3: TaskDTO = {
    ...baseTask1,
    id: '019318ef-0000-7000-8000-000000000003',
    key: 'CORE-3',
    title: 'Deploy to Staging',
    status: 'in_progress',
    rank: 'a0',
    version: 1,
    dueDate: '2026-10-15', // Upcoming
  };

  const baseTask4: TaskDTO = {
    ...baseTask1,
    id: '019318ef-0000-7000-8000-000000000004',
    key: 'CORE-4',
    title: 'Write Documentation',
    status: 'done',
    rank: 'a0',
    version: 1,
    dueDate: '2026-10-01',
  };

  describe('1. Board View Drag-and-Drop & Optimistic Rollback', () => {
    it('simulates optimistic card move across columns with rollback when server returns 412 Precondition Failed', () => {
      // Local board state with 2 tasks in todo, 1 in in_progress
      let localTasks = [baseTask1, baseTask2, baseTask3];

      // User drags baseTask1 from 'todo' to 'in_progress' after baseTask3
      const previousState = [...localTasks];

      // Optimistic update
      const optimisticNewRank = generateRankBetween(baseTask3.rank, null);
      localTasks = localTasks.map((t) =>
        t.id === baseTask1.id
          ? { ...t, status: 'in_progress' as TaskStatus, rank: optimisticNewRank }
          : t
      );

      // Verify optimistic state shows baseTask1 in in_progress
      expect(localTasks.find((t) => t.id === baseTask1.id)?.status).toBe('in_progress');

      // Server rejects with HTTP 412 (another tab concurrently modified baseTask1)
      const serverResponse = {
        status: 412,
        error: 'PRECONDITION_FAILED',
        message: 'Task was modified by another user.',
      };

      if (serverResponse.status === 412) {
        // Rollback to previous state
        localTasks = previousState;
      }

      // Verify state was accurately rolled back
      expect(localTasks.find((t) => t.id === baseTask1.id)?.status).toBe('todo');
      expect(localTasks.find((t) => t.id === baseTask1.id)?.rank).toBe('a0');
    });

    it('orders tasks in column strictly according to Base-62 fractional ranks', () => {
      const rank0 = generateInitialRank(); // 'a0'
      const rankEnd = generateRankBetween(rank0, null); // 'a1'
      const rankMid = generateRankBetween(rank0, rankEnd); // 'a0V'

      const tasks = [
        { id: '1', rank: rankEnd },
        { id: '2', rank: rank0 },
        { id: '3', rank: rankMid },
      ];

      // Sort by rank using compareRanks
      tasks.sort((a, b) => compareRanks(a.rank, b.rank));

      expect(tasks[0].id).toBe('2'); // 'a0'
      expect(tasks[1].id).toBe('3'); // 'a0V'
      expect(tasks[2].id).toBe('1'); // 'a1'
    });
  });

  describe('2. My Tasks Category Filtering & Count Logic', () => {
    it('correctly categorizes tasks into pending, overdue, dueToday, and upcoming in Asia/Kolkata timezone', () => {
      // Due dates relative to today (Asia/Kolkata) so the categories do not drift with the run date.
      const todayKolkata = getKolkataTodayDateString();
      const task1 = { ...baseTask1, dueDate: addCalendarDays(todayKolkata, -5) };
      const task2 = { ...baseTask2, dueDate: todayKolkata };
      const task3 = { ...baseTask3, dueDate: addCalendarDays(todayKolkata, 9) };
      const task4 = { ...baseTask4, dueDate: addCalendarDays(todayKolkata, -5) };
      const allTasks = [task1, task2, task3, task4];

      // Compute counts matching the server & UI algorithm
      const counts: MyTasksCountsDTO = {
        all: allTasks.length,
        pending: allTasks.filter((t) => t.status !== 'done').length,
        overdue: allTasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < todayKolkata).length,
        dueToday: allTasks.filter((t) => t.status !== 'done' && t.dueDate === todayKolkata).length,
        upcoming: allTasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate > todayKolkata).length,
      };

      expect(counts.all).toBe(4);
      expect(counts.pending).toBe(3); // baseTask1, task2, baseTask3 (baseTask4 is done)
      expect(counts.overdue).toBe(1); // task1 is 5 days past due (overdue)
      expect(counts.dueToday).toBe(1); // task2 is due today in Kolkata
      expect(counts.upcoming).toBe(1); // task3 is due in 9 days (upcoming)

      // Completed tasks must never be counted in overdue even if past due date
      expect(task4.dueDate < todayKolkata).toBe(true);
      expect(task4.status).toBe('done');
      const overdueTasks = allTasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < todayKolkata);
      expect(overdueTasks.some((t) => t.id === task4.id)).toBe(false);
    });
  });
});
