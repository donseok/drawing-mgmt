// OpenAPI document generator.
// Importing './schemas' has the side-effect of registering all paths + schemas.

import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry';
import './schemas'; // side-effect: registers paths

export function generateOpenAPIDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: '동국씨엠 도면관리시스템 API',
      version: '1.0.0',
      description: 'Drawing Management System REST API — 도면/자료 등록, 결재, 뷰어 등.',
    },
    servers: [{ url: '/', description: 'Current server' }],
    security: [{ bearerAuth: [] }],
  });
}
