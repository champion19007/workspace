import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  parseStrongETag,
  parseETag,
  formatETag,
  isWeakETag,
  PreconditionRequiredError,
  PreconditionFailedError,
} from '@workspace/core';

declare module 'fastify' {
  interface FastifyInstance {
    verifyIfMatch: (request: FastifyRequest, currentVersion: number, currentEntity?: unknown) => number;
  }
}

const concurrencyPluginInner: FastifyPluginAsync = async (app) => {
  app.decorate(
    'verifyIfMatch',
    (request: FastifyRequest, currentVersion: number, currentEntity?: unknown): number => {
      const ifMatchHeader = request.headers['if-match'];
      if (!ifMatchHeader || typeof ifMatchHeader !== 'string') {
        throw new PreconditionRequiredError(
          'If-Match header is required for update operations to ensure optimistic concurrency control'
        );
      }

      // RFC 9110: If-Match uses strong comparison; weak validators MUST NOT match
      if (isWeakETag(ifMatchHeader)) {
        throw new PreconditionFailedError(
          `Weak entity tags (${ifMatchHeader}) do not satisfy strong comparison for If-Match. Strong ETag required (e.g. "v${currentVersion}").`,
          currentEntity
        );
      }

      const expectedVersion = parseStrongETag(ifMatchHeader);
      if (expectedVersion === null) {
        throw new PreconditionFailedError(
          `Invalid strong If-Match header value "${ifMatchHeader}". Expected format: "v<version>".`,
          currentEntity
        );
      }

      if (expectedVersion !== currentVersion) {
        throw new PreconditionFailedError(
          `Version conflict: entity has been updated to version ${currentVersion} (requested version ${expectedVersion})`,
          currentEntity
        );
      }

      return expectedVersion;
    }
  );
};

export const concurrencyPlugin = fp(concurrencyPluginInner, {
  name: 'concurrency-plugin',
});

export { formatETag, parseETag };
