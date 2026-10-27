import type { NextResponse } from 'next/server';
import type { AppPorts } from '@workspace/core';
import { problemJson } from './problem';

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
