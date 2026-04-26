// OpenAPI registry — central registration point for all API schemas & paths.
// Uses @asteasolutions/zod-to-openapi v7 (compatible with zod 3.x).

import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Must be called once before any .openapi() calls on zod schemas.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Register the bearer auth security scheme used by most endpoints.
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'Session cookie (next-auth)',
  description:
    'Authentication is handled by next-auth session cookies. ' +
    'The "Authorize" button here is cosmetic — in practice, ' +
    'you authenticate via the web UI login page.',
});

/** Helper: register a named schema for $ref reuse in the spec. */
export function registerSchema<T extends z.ZodType>(name: string, schema: T) {
  return registry.register(name, schema);
}
