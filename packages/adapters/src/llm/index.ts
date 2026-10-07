import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  type LLMPort,
  type LLMCompletionRequest,
  type LLMCompletionResult,
  type EmbedRequest,
  type EmbedResult,
  AdapterUnavailableError,
} from '@workspace/core';

/**
 * Generates deterministic 1024-dimension unit vectors for testing based on input text SHA-256.
 * Guarantees exactly 1024 dimensions, all finite floats, unit L2 norm, and non-zero values.
 */
export function generateDeterministic1024Vector(text: string): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector = new Array<number>(1024);
  let normSq = 0;

  for (let i = 0; i < 1024; i++) {
    const b1 = hash[(i * 2) % hash.length]!;
    const b2 = hash[(i * 2 + 1) % hash.length]!;
    const rawVal = ((b1 << 8) | b2) ^ ((i * 2654435761) & 0xffff);
    const floatVal = (rawVal / 32767.5) - 1.0;
    vector[i] = floatVal;
    normSq += floatVal * floatVal;
  }

  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < 1024; i++) {
    vector[i] = vector[i]! / norm;
  }

  return vector;
}

export class MockLlmAdapter implements LLMPort {
  public readonly provider = 'mock';

  constructor(
    private readonly mockHandler?: (req: LLMCompletionRequest<unknown>) => unknown,
    private readonly mockEmbeddingHandler?: (req: EmbedRequest) => number[][]
  ) {}

  async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
    let rawOutput: unknown;
    if (this.mockHandler) {
      rawOutput = this.mockHandler(req as LLMCompletionRequest<unknown>);
    } else {
      rawOutput = {};
    }

    const validatedData = req.schema.parse(rawOutput);

    return {
      data: validatedData,
      model: 'mock-model-v1',
      promptVersion: req.promptVersion,
      inputTokens: 100,
      outputTokens: 50,
      costInr: 0.12,
      durationMs: 45,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (this.mockEmbeddingHandler) {
      const embeddings = this.mockEmbeddingHandler(req);
      return {
        embeddings,
        model: 'mock-embed-v1',
        inputTokens: req.texts.reduce((acc: number, t: string) => acc + Math.max(1, Math.ceil(t.length / 4)), 0),
        costInr: 0.01,
      };
    }
    const embeddings = req.texts.map((t) => generateDeterministic1024Vector(t));
    return {
      embeddings,
      model: 'mock-embed-v1',
      inputTokens: req.texts.reduce((acc: number, t: string) => acc + Math.max(1, Math.ceil(t.length / 4)), 0),
      costInr: 0.01,
    };
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return { healthy: true, details: { provider: this.provider } };
  }
}

export interface AnthropicLlmConfig {
  apiKey?: string;
  fastModel?: string;
  strongModel?: string;
  timeoutMs?: number;
  voyageApiKey?: string;
  voyageModel?: string;
}

export const VOYAGE_PRICING_TABLE: Record<string, number> = {
  'voyage-3-lite': 0.07, // $0.07 per 1M tokens
  'voyage-3': 0.12,      // $0.12 per 1M tokens
};

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-3-7-sonnet-latest': { inputUsdPerMillion: 3.0, outputUsdPerMillion: 15.0 },
  'claude-3-5-sonnet-latest': { inputUsdPerMillion: 3.0, outputUsdPerMillion: 15.0 },
  'claude-3-5-sonnet-20241022': { inputUsdPerMillion: 3.0, outputUsdPerMillion: 15.0 },
  'claude-3-5-haiku-latest': { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4.0 },
  'claude-3-haiku-20240307': { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.25 },
};

export const DEFAULT_USD_TO_INR_RATE = 86.0;

export function calculateModelCostInr(
  model: string,
  inputTokens: number,
  outputTokens: number,
  usdToInrRate = DEFAULT_USD_TO_INR_RATE
): { costInr: number; estimated: boolean } {
  const pricing = MODEL_PRICING_TABLE[model] || {
    inputUsdPerMillion: model.includes('haiku') ? 0.8 : 3.0,
    outputUsdPerMillion: model.includes('haiku') ? 4.0 : 15.0,
  };
  const estimated = !MODEL_PRICING_TABLE[model];
  const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  const totalCostInr = (inputCostUsd + outputCostUsd) * usdToInrRate;
  // 6 decimal places to prevent zeroing small token calls
  const costInr = Math.round(totalCostInr * 1_000_000) / 1_000_000;
  return { costInr, estimated };
}

export class AnthropicLlmAdapter implements LLMPort {
  public readonly provider = 'anthropic';
  private client: Anthropic | null = null;
  private readonly fastModel: string;
  private readonly strongModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: AnthropicLlmConfig) {
    if (!config.apiKey) {
      throw new AdapterUnavailableError(
        'LLM',
        'anthropic',
        'Missing ANTHROPIC_API_KEY environment variable.'
      );
    }
    this.fastModel = config.fastModel || 'claude-3-5-haiku-latest';
    this.strongModel = config.strongModel || 'claude-3-7-sonnet-latest';
    this.timeoutMs = config.timeoutMs || 30_000;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.config.apiKey,
        timeout: this.timeoutMs,
      });
    }
    return this.client;
  }

  async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
    const client = this.getClient();
    const model = req.tier === 'fast' ? this.fastModel : this.strongModel;
    const startTime = performance.now();

    const systemPrompt = [
      req.systemPrefix || 'You are an AI assistant in Workspace v1.',
      'Return ONLY a valid, parseable JSON object matching the requested schema. Do not wrap in markdown fences or explain your answer.',
      req.orgGlossary ? `Organization Glossary: ${JSON.stringify(req.orgGlossary)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastError: Error | null = null;

    const userContent =
      typeof req.input === 'string'
        ? req.input
        : `Execute task "${req.promptId}" (v${req.promptVersion}).\nInput:\n${JSON.stringify(req.input, null, 2)}`;

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: userContent,
      },
    ];

    // Bounded repair loop: strictly 1 initial attempt + 1 repair retry (max 2 attempts)
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: 4096,
          temperature: req.temperature ?? 0.0,
          system: systemPrompt,
          messages,
        });
      } catch (err) {
        throw new Error(
          `Anthropic API request failed on attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;

      // Handle provider refusal
      if (response.stop_reason === 'refusal') {
        throw new Error(`Anthropic provider refused prompt request for task ${req.promptId}`);
      }

      // Handle truncated output
      if (response.stop_reason === 'max_tokens') {
        throw new Error(`Anthropic provider output was truncated due to max_tokens limit`);
      }

      const textBlock = response.content.find((c) => c.type === 'text');
      const responseText = textBlock ? textBlock.text.trim() : '';

      if (!responseText) {
        throw new Error(`Anthropic provider returned empty content for task ${req.promptId}`);
      }

      try {
        // Strip markdown backticks if present
        let cleanJson = responseText;
        if (cleanJson.startsWith('```json')) {
          cleanJson = cleanJson.slice(7).replace(/```$/, '').trim();
        } else if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.slice(3).replace(/```$/, '').trim();
        }

        const parsed = JSON.parse(cleanJson);
        const validated = req.schema.parse(parsed);

        const durationMs = Math.round(performance.now() - startTime);
        const { costInr } = calculateModelCostInr(model, totalInputTokens, totalOutputTokens);

        return {
          data: validated,
          model,
          promptVersion: req.promptVersion,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costInr,
          durationMs,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          messages.push({
            role: 'assistant',
            content: responseText,
          });
          messages.push({
            role: 'user',
            content: `Your previous output could not be parsed or failed schema validation: ${lastError.message}. Please fix the JSON and return ONLY the corrected valid JSON object.`,
          });
        }
      }
    }

    throw new Error(
      `Anthropic structured output completion failed after ${maxAttempts} attempts: ${lastError?.message}`
    );
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const voyageKey = this.config.voyageApiKey || process.env['VOYAGE_API_KEY'];
    if (!voyageKey) {
      throw new AdapterUnavailableError(
        'LLM',
        'voyage',
        'Missing VOYAGE_API_KEY. Configure Voyage AI credentials to generate 1024-dimension embeddings.'
      );
    }

    if (req.texts.length === 0) {
      return {
        embeddings: [],
        model: this.config.voyageModel || 'voyage-3-lite',
        inputTokens: 0,
        costInr: 0,
      };
    }

    const model = this.config.voyageModel || 'voyage-3-lite';
    const batchSize = 128; // Voyage batch limit
    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    for (let i = 0; i < req.texts.length; i += batchSize) {
      const batch = req.texts.slice(i, i + batchSize);
      let attempts = 0;
      let batchSuccess = false;
      let lastErr: Error | null = null;

      while (attempts < 3 && !batchSuccess) {
        attempts++;
        try {
          const res = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${voyageKey}`,
            },
            body: JSON.stringify({
              input: batch,
              model,
            }),
            signal: AbortSignal.timeout(this.timeoutMs),
          });

          if (res.status === 429) {
            // Rate limit backoff
            const delay = Math.pow(2, attempts) * 500;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Voyage API returned HTTP ${res.status}: ${errBody}`);
          }

          const data = (await res.json()) as {
            data: Array<{ embedding: number[]; index: number }>;
            usage?: { total_tokens?: number };
          };

          if (!data || !Array.isArray(data.data)) {
            throw new Error('Malformed response from Voyage AI API: missing data array');
          }

          // Sort by index to preserve input ordering
          const sorted = [...data.data].sort((a, b) => a.index - b.index);
          for (const item of sorted) {
            const vec = item.embedding;
            if (!Array.isArray(vec) || vec.length !== 1024) {
              throw new Error(
                `Voyage embedding dimension mismatch: expected 1024, received ${vec?.length ?? 'none'}`
              );
            }
            // Validate all numbers are finite and not all zeros
            const allFinite = vec.every((v) => Number.isFinite(v));
            if (!allFinite) {
              throw new Error('Voyage embedding contains non-finite float values');
            }
            const hasNonZero = vec.some((v) => v !== 0);
            if (!hasNonZero) {
              throw new Error('Voyage embedding is all zeros');
            }
            allEmbeddings.push(vec);
          }

          totalTokens += data.usage?.total_tokens ?? batch.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);
          batchSuccess = true;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          if (attempts >= 3) break;
          await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
        }
      }

      if (!batchSuccess) {
        throw new Error(`Failed to generate embeddings from Voyage AI: ${lastErr?.message}`);
      }
    }

    const pricePerMillionUsd = VOYAGE_PRICING_TABLE[model] || 0.07;
    const costUsd = (totalTokens / 1_000_000) * pricePerMillionUsd;
    const costInr = Math.round(costUsd * DEFAULT_USD_TO_INR_RATE * 1_000_000) / 1_000_000;

    return {
      embeddings: allEmbeddings,
      model,
      inputTokens: totalTokens,
      costInr,
    };
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    const voyageConfigured = Boolean(this.config.voyageApiKey || process.env['VOYAGE_API_KEY']);
    return {
      healthy: Boolean(this.config.apiKey),
      details: {
        provider: this.provider,
        fastModel: this.fastModel,
        strongModel: this.strongModel,
        configured: Boolean(this.config.apiKey),
        voyageConfigured,
      },
    };
  }
}

export interface BedrockLlmConfig {
  region?: string;
  indiaInferenceProfileArn?: string;
}

export class BedrockLlmAdapter implements LLMPort {
  public readonly provider = 'bedrock';

  constructor(private readonly config: BedrockLlmConfig) {
    if (!config.region || !config.indiaInferenceProfileArn) {
      throw new AdapterUnavailableError(
        'LLM',
        'bedrock',
        'Missing AWS_REGION or BEDROCK_INDIA_INFERENCE_PROFILE_ARN.'
      );
    }
  }

  async complete<T>(_req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
    throw new AdapterUnavailableError(
      'LLM',
      'bedrock',
      'Bedrock Runtime client not wired. Provide active AWS IAM credentials and endpoints.'
    );
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new AdapterUnavailableError('LLM', 'bedrock', 'Bedrock Titan Embeddings client uninitialized.');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'Bedrock client uninitialized',
        configured: Boolean(this.config.region),
      },
    };
  }
}
