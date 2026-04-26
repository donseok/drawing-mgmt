// GET /api/openapi.json — serves the OpenAPI 3.0 specification.
// No auth required so Swagger UI and external tools can fetch it.

import { NextResponse } from 'next/server';
import { generateOpenAPIDocument } from '@/lib/openapi/generator';

// Dynamic so the spec can evolve without a rebuild.
// Generation is pure computation — no DB/auth overhead.
export const dynamic = 'force-dynamic';

export async function GET() {
  const doc = generateOpenAPIDocument();
  return NextResponse.json(doc);
}
