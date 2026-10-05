import {
  type LLMPort,
  type LLMCompletionRequest,
  type LLMCompletionResult,
  type EmbedRequest,
  type EmbedResult,
  AdapterUnavailableError,
} from '@workspace/core';

export class MockLlmAdapter implements LLMPort {
  public readonly provider = 'mock';

  constructor(private readonly mockHandler?: (req: LLMCompletionRequest<unknown>) => unknown) {}

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
    const embeddings = req.texts.map(() => new Array(1024).fill(0.01));
    return {
      embeddings,
      model: 'mock-embed-v1',
      inputTokens: req.texts.reduce((acc: number, t: string) => acc + t.length / 4, 0),
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
}

export class AnthropicLlmAdapter implements LLMPort {
  public readonly provider = 'anthropic';

  constructor(private readonly config: AnthropicLlmConfig) {
    if (!config.apiKey) {
      throw new AdapterUnavailableError(
        'LLM',
        'anthropic',
        'Missing ANTHROPIC_API_KEY environment variable.'
      );
    }
  }

  async complete<T>(_req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
    throw new AdapterUnavailableError(
      'LLM',
      'anthropic',
      'Anthropic API client not wired. Provide valid live credentials in Stage 14/15.'
    );
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new AdapterUnavailableError(
      'LLM',
      'anthropic',
      'Embeddings not directly supported by Anthropic API; use Voyage or Bedrock Titan.'
    );
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'Anthropic client uninitialized',
        configured: Boolean(this.config.apiKey),
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
