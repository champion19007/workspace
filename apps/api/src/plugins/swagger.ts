import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

const swaggerPluginInner: FastifyPluginAsync = async (app) => {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Workspace v1 API',
        description:
          'REST API for Workspace v1 modular monolith with strict tenant isolation, RFC 9457 errors, and ETag optimistic concurrency.',
        version: '1.0.0',
      },
      servers: [
        {
          url: '/api/v1',
          description: 'API v1 Base URL',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          internalBffAuth: {
            type: 'apiKey',
            name: 'x-workspace-signature',
            in: 'header',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
    staticCSP: true,
  });
};

export const swaggerPlugin = fp(swaggerPluginInner, {
  name: 'swagger-plugin',
});
