import Fastify from 'fastify';
import { POLICY } from '../config.js';
import { recommendCircles, UserNotFoundError } from '../service.js';

/**
 * Builds the HTTP app. The repository is injected so tests can run against an in-memory DB.
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 */
export function buildApp(repo, { logger = false } = {}) {
  // removeAdditional:false => unknown query params are rejected (400) rather than silently
  // stripped, so a typo like ?limt=3 fails loudly instead of returning the wrong thing.
  const app = Fastify({ logger, ajv: { customOptions: { removeAdditional: false } } });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/users/:userId/recommendations', {
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'integer', minimum: 1 } },
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: POLICY.defaults.maxLimit, default: POLICY.defaults.limit },
          debug: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request) => {
    const { userId } = request.params;
    const { limit, debug } = request.query;
    return recommendCircles(repo, userId, { limit, debug });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof UserNotFoundError) {
      return reply.code(404).send({ error: 'not_found', message: error.message });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'bad_request', message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  return app;
}
