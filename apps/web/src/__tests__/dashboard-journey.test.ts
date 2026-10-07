import { describe, it, expect } from 'vitest';
import {
  computeHealthStatus,
  computeCompletionPercentage,
  addCalendarDays,
  NodeRollupSchema,
  ProjectDashboardSchema,
  LeadershipSummarySchema,
  type NodeRollupDTO,
  type ProjectDashboardDTO,
  type LeadershipSummaryDTO,
} from '@workspace/core';

describe('Web Dashboard Journey — Health Calculations, Rollups & Contract Schemas', () => {
  describe('1. Deterministic Health Thresholds (No-LLM Guarantee)', () => {
    it('evaluates health statuses deterministically across all boundary conditions', () => {
      // Condition 1: No active work -> 'no_tasks'
      expect(
        computeHealthStatus({
          totalTasks: 0,
          totalSubtasks: 0,
          overdueCount: 0,
          dueSoonCount: 0,
        })
      ).toBe('no_tasks');

      // Condition 2: Any overdue work -> 'at_risk' (even with 100 on-track tasks)
      expect(
        computeHealthStatus({
          totalTasks: 10,
          totalSubtasks: 5,
          overdueCount: 1,
          dueSoonCount: 3,
        })
      ).toBe('at_risk');

      // Condition 3: No overdue, but due soon items present -> 'needs_attention'
      expect(
        computeHealthStatus({
          totalTasks: 8,
          totalSubtasks: 2,
          overdueCount: 0,
          dueSoonCount: 2,
        })
      ).toBe('needs_attention');

      // Condition 4: No overdue, no due soon -> 'on_track'
      expect(
        computeHealthStatus({
          totalTasks: 12,
          totalSubtasks: 4,
          overdueCount: 0,
          dueSoonCount: 0,
        })
      ).toBe('on_track');
    });

    it('computes completion percentage strictly from top-level tasks with zero-denominator safety', () => {
      // Zero denominator safety
      expect(computeCompletionPercentage(0, 0)).toBe(0);

      // Typical fractions
      expect(computeCompletionPercentage(2, 4)).toBe(50);
      expect(computeCompletionPercentage(1, 3)).toBe(33);
      expect(computeCompletionPercentage(2, 3)).toBe(67);
      expect(computeCompletionPercentage(10, 10)).toBe(100);

      // Clamping safety
      expect(computeCompletionPercentage(-1, 5)).toBe(0);
      expect(computeCompletionPercentage(10, 5)).toBe(100);
    });

    it('adds calendar days accurately across leap years and month boundaries', () => {
      expect(addCalendarDays('2026-10-06', 7)).toBe('2026-10-13');
      expect(addCalendarDays('2026-10-30', 2)).toBe('2026-11-01');
      expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01'); // Non-leap year 2026
    });
  });

  describe('2. Project Dashboard Contract Validation (Screenshot 927 Schema)', () => {
    it('validates compliant project dashboard payload with summary hero, completion ring, metric strip, and activity feed', () => {
      const mockRollup: NodeRollupDTO = {
        health: 'on_track',
        completionPercentage: 75,
        tasks: {
          total: 12,
          open: 3,
          inProgress: 2,
          completed: 9,
          blocked: 1,
        },
        subtasks: {
          total: 6,
          open: 1,
          completed: 5,
        },
        overdueCount: 0,
        dueSoonCount: 2,
        unassignedCount: 1,
        provenance: {
          computedAt: new Date().toISOString(),
          rulesVersion: '1.0.0',
          dateContext: '2026-10-06',
          generation: 1,
        },
      };

      const rollupValidation = NodeRollupSchema.safeParse(mockRollup);
      expect(rollupValidation.success).toBe(true);

      const mockDashboard: ProjectDashboardDTO = {
        project: {
          id: '019318ef-0000-7000-8000-000000000001',
          name: 'Core Platform v1',
          description: 'Multi-tenant foundation, task views, and health analytics.',
          keyPrefix: 'CORE',
          visibility: 'public',
          teamId: '019318ef-0000-7000-8000-000000000002',
          teamName: 'Engineering',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        rollup: mockRollup,
        recentActivity: [
          {
            id: '019318ef-0000-7000-8000-000000000003',
            verb: 'task_completed',
            targetType: 'task',
            targetId: '019318ef-0000-7000-8000-000000000004',
            targetKey: 'CORE-12',
            targetTitle: 'Deploy worker relay',
            actor: {
              id: '019318ef-0000-7000-8000-000000000005',
              name: 'Alice Dev',
              email: 'alice@example.com',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const dashboardValidation = ProjectDashboardSchema.safeParse(mockDashboard);
      expect(dashboardValidation.success).toBe(true);
    });
  });

  describe('3. Leadership Summary Contract Validation (Screenshots 935-937 Schema)', () => {
    it('validates compliant leadership summary payload with KPI strip, projects table, and at-risk tasks', () => {
      const mockLeadership: LeadershipSummaryDTO = {
        summary: {
          totalProjects: 5,
          totalTasks: 42,
          totalOverdue: 2,
          totalUnassigned: 4,
          atRiskProjects: 1,
          averageCompletionPercentage: 68,
        },
        projects: [
          {
            id: '019318ef-0000-7000-8000-000000000001',
            name: 'Web Client',
            keyPrefix: 'WEB',
            visibility: 'public',
            teamId: '019318ef-0000-7000-8000-000000000002',
            teamName: 'Frontend Team',
            rollup: {
              health: 'at_risk',
              completionPercentage: 50,
              tasks: { total: 10, open: 5, inProgress: 3, completed: 5, blocked: 0 },
              subtasks: { total: 4, open: 2, completed: 2 },
              overdueCount: 2,
              dueSoonCount: 1,
              unassignedCount: 1,
              provenance: {
                computedAt: new Date().toISOString(),
                rulesVersion: '1.0.0',
                dateContext: '2026-10-06',
                generation: 1,
              },
            },
          },
        ],
        atRiskTasks: [
          {
            id: '019318ef-0000-7000-8000-000000000006',
            key: 'WEB-14',
            title: 'Fix accessibility contrast',
            projectId: '019318ef-0000-7000-8000-000000000001',
            projectName: 'Web Client',
            status: 'todo',
            priority: 'urgent',
            dueDate: '2026-10-04',
            assignee: {
              id: '019318ef-0000-7000-8000-000000000005',
              name: 'Alice Dev',
              email: 'alice@example.com',
            },
            isOverdue: true,
            isBlocked: false,
          },
        ],
      };

      const leadershipValidation = LeadershipSummarySchema.safeParse(mockLeadership);
      expect(leadershipValidation.success).toBe(true);
    });
  });
});
