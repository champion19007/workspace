import type { NextResponse } from 'next/server';
import { aiBudgetAllows, type AppPorts, type LLMCompletionRequest, type LLMCompletionResult } from '@workspace/core';
import { getAiMonthUsage, recordAiUsage } from '@workspace/db';
import { problemJson } from './problem';
import { rateLimited } from './rate-limit';
import { getServerContext } from './server-context';

/** A 503 for production servers without an AI key (the mock would answer nonsense); null when AI can run. */
export function aiUnavailable(ports: AppPorts, instance: string): NextResponse | null {
  if (process.env.NODE_ENV === 'production' && ports.llm.provider === 'mock') {
    return problemJson(
      503,
      'AI_NOT_CONFIGURED',
      "AI features aren't set up on this server yet. An administrator adds an Anthropic API key to turn them on.",
      instance
    );
  }
  return null;
}

/** True when answers come from the development stand-in rather than a real model. */
export const isDemoAi = (ports: AppPorts) => ports.llm.provider === 'mock';

/** A friendly 502 for a failed AI call; the error itself goes to the server log only. */
export function aiFailed(err: unknown, instance: string): NextResponse {
  console.error('AI request failed', { instance, message: (err as Error)?.message });
  return problemJson(502, 'AI_FAILED', "The AI couldn't answer this time. Please try again in a minute.", instance);
}

/** 30 AI answers an hour per person: plenty for real work, and a ceiling on what a runaway script can cost. */
export function aiRateLimited(userId: string, instance: string): Promise<NextResponse | null> {
  return rateLimited(
    [{ key: `ai:${userId}`, limit: 30, windowSeconds: 3600 }],
    instance,
    "You've used the AI a lot in the last hour. Please try again a little later."
  );
}

/** A 429 once the organization has used this month's AI budget; null while it may still use AI. */
export async function aiBudgetExceeded(orgId: string, instance: string): Promise<NextResponse | null> {
  const { budgetInr, usedInr } = await getAiMonthUsage(getServerContext().sql, orgId);
  if (aiBudgetAllows(usedInr, budgetInr)) return null;
  return problemJson(
    429,
    'AI_BUDGET_EXCEEDED',
    "Your organization has used this month's AI allowance. An Owner can raise it, or it resets on the 1st.",
    instance
  );
}

/**
 * Runs one AI call and writes it to the organization's usage ledger, so it counts against the monthly budget.
 * Development stand-in answers cost nothing and aren't recorded. A failed write to the ledger never fails the call.
 */
export async function completeAndRecord<T>(
  ports: AppPorts,
  orgId: string,
  req: LLMCompletionRequest<T>
): Promise<LLMCompletionResult<T>> {
  const record = async (entry: Partial<LLMCompletionResult<T>> & { status: 'succeeded' | 'failed'; error?: string }) => {
    if (isDemoAi(ports)) return;
    try {
      await recordAiUsage(getServerContext().sql, {
        orgId,
        operation: req.promptId,
        provider: ports.llm.provider,
        model: entry.model ?? 'unknown',
        promptId: req.promptId,
        promptVersion: req.promptVersion,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        costInr: entry.costInr ?? 0,
        durationMs: entry.durationMs ?? 0,
        status: entry.status,
        errorMessage: entry.error ?? null,
      });
    } catch (err) {
      console.error('AI usage not recorded', { promptId: req.promptId, message: (err as Error).message });
    }
  };
  try {
    const result = await ports.llm.complete(req);
    await record({ ...result, status: 'succeeded' });
    return result;
  } catch (err) {
    await record({ status: 'failed', error: (err as Error)?.message });
    throw err;
  }
}
