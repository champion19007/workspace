import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import type { AppPorts, AppConfig } from '@workspace/core';
import {
  verifyZoomWebhookSignature,
  buildZoomValidationResponse,
} from '@workspace/core';
import { processZoomWebhookEvent } from '@workspace/db';

export interface WebhookRouteOptions {
  sql: Sql;
  ports: AppPorts;
  config: AppConfig;
}

export const webhookRoutes: FastifyPluginAsync<WebhookRouteOptions> = async (app, options) => {
  const { sql, ports, config } = options;

  /**
   * Public POST /webhooks/zoom endpoint.
   * Authenticates provider requests independently of Workspace browser sessions.
   * Verifies x-zm-signature using timing-safe comparison and 5-minute past/future window.
   * Handles endpoint.url_validation challenge and persists authentic events in a single transaction.
   */
  app.post('/webhooks/zoom', async (request, reply) => {
    // 1. Retrieve raw body and signature headers
    const rawBody = (request as unknown as { rawBody?: string }).rawBody || JSON.stringify(request.body || {});
    const timestampHeader = request.headers['x-zm-request-timestamp'] as string | undefined;
    const signatureHeader = request.headers['x-zm-signature'] as string | undefined;

    // 2. Verify signature
    const verification = verifyZoomWebhookSignature({
      secretToken: config.ZOOM_WEBHOOK_SECRET_TOKEN,
      timestampHeader,
      signatureHeader,
      rawBody,
    });

    if (!verification.valid) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: verification.reason || 'Invalid Zoom webhook signature',
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (request.body || {}) as any;

    // 3. Handle Zoom URL validation challenge (endpoint.url_validation)
    if (body.event === 'endpoint.url_validation') {
      const plainToken = body.payload?.plainToken;
      if (!plainToken || typeof plainToken !== 'string') {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'Missing or invalid plainToken in validation payload',
        });
      }

      const challengeResponse = buildZoomValidationResponse(plainToken, config.ZOOM_WEBHOOK_SECRET_TOKEN);
      return reply.status(200).send(challengeResponse);
    }

    // 4. Handle business events (recording.completed, recording.transcript_completed, app_deauthorized)
    try {
      const result = await processZoomWebhookEvent(sql, ports.secretStore, {
        event: body.event,
        eventTs: typeof body.event_ts === 'number' ? body.event_ts : Date.now(),
        payload: body.payload,
      });

      return reply.status(200).send(result);
    } catch (err) {
      request.log.error({ err }, 'Failed to persist Zoom webhook event transactionally');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to persist webhook event durably',
      });
    }
  });
};
