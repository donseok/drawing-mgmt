// OpenAPI schema registrations for core endpoints.
//
// Schemas are COPIES of the zod schemas defined in each route.ts.
// We duplicate rather than import to avoid coupling OpenAPI infra
// with route internals (and to keep route files untouched).

import { z } from 'zod';
import { registry, registerSchema } from './registry';

// ---------------------------------------------------------------------------
// Reusable component schemas
// ---------------------------------------------------------------------------

const ErrorResponse = registerSchema(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z
        .enum([
          'E_AUTH',
          'E_FORBIDDEN',
          'E_NOT_FOUND',
          'E_VALIDATION',
          'E_STATE_CONFLICT',
          'E_LOCKED',
          'E_RATE_LIMIT',
          'E_INTERNAL',
        ])
        .openapi({ description: 'Machine-readable error code' }),
      message: z.string().openapi({ description: 'Human-readable message (Korean)' }),
      details: z.any().optional().openapi({ description: 'Validation details if applicable' }),
    }),
  }),
);

const ObjectState = z.enum([
  'NEW',
  'CHECKED_IN',
  'CHECKED_OUT',
  'IN_APPROVAL',
  'APPROVED',
  'DELETED',
]);

// ---------------------------------------------------------------------------
// GET /api/v1/health
// ---------------------------------------------------------------------------

const HealthResponse = registerSchema(
  'HealthResponse',
  z.object({
    status: z.enum(['ok', 'degraded', 'down']),
    db: z.enum(['ok', 'down']),
    redis: z.enum(['ok', 'down', 'na']),
    llm: z.enum(['ok', 'down', 'disabled']),
    mode: z.enum(['rag', 'rule']),
    timestamp: z.string().openapi({ example: '2026-04-26T12:00:00.000Z' }),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  tags: ['System'],
  summary: 'Health check',
  description: 'Composite health check for DB, Redis, and LLM. No auth required.',
  responses: {
    200: {
      description: 'System healthy',
      content: { 'application/json': { schema: HealthResponse } },
    },
    503: {
      description: 'System down (DB unreachable)',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/me
// ---------------------------------------------------------------------------

const UserProfile = registerSchema(
  'UserProfile',
  z.object({
    id: z.string(),
    username: z.string(),
    fullName: z.string(),
    email: z.string().nullable(),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'USER', 'VIEWER']),
    securityLevel: z.number().int().min(1).max(5),
    organizationId: z.string().nullable(),
    organization: z
      .object({
        id: z.string(),
        name: z.string(),
        parentId: z.string().nullable(),
      })
      .nullable(),
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/me',
  tags: ['Auth'],
  summary: 'Current user profile',
  description:
    'Returns the authenticated user profile with organization and group memberships. Password hash is never exposed.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z.object({ data: UserProfile }),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/objects  — list with cursor pagination
// ---------------------------------------------------------------------------

const ObjectSummary = registerSchema(
  'ObjectSummary',
  z.object({
    id: z.string(),
    number: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    folderId: z.string(),
    classId: z.string(),
    classCode: z.string(),
    className: z.string(),
    securityLevel: z.number().int().min(1).max(5),
    state: ObjectState,
    ownerId: z.string(),
    ownerName: z.string(),
    currentRevision: z.number().int(),
    currentVersion: z.string(),
    lockedById: z.string().nullable(),
    masterAttachmentId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/objects',
  tags: ['Objects'],
  summary: 'List / search objects',
  description:
    'Cursor-paginated object list. Supports full-text search (pg_trgm), folder filter (with descendant inclusion), state filter, date range, and more.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      folderId: z.string().optional().openapi({ description: 'Filter by folder (includes descendants)' }),
      q: z.string().optional().openapi({ description: 'Full-text search query (pg_trgm similarity)' }),
      classCode: z.string().optional().openapi({ description: 'Filter by class code' }),
      state: ObjectState.optional().openapi({ description: 'Filter by object state' }),
      dateRange: z.string().optional().openapi({
        description: 'Date range: "2026", "2026-04", or "2026-01..2026-06"',
      }),
      ownerId: z.string().optional().openapi({ description: 'Filter by owner ID' }),
      lockedOnly: z.string().optional().openapi({ description: '"true" to show only locked objects' }),
      mineOnly: z.string().optional().openapi({ description: '"true" to show only own objects' }),
      includeTrash: z.string().optional().openapi({ description: '"true" to show deleted objects' }),
      securityLevelMin: z.string().optional().openapi({ description: 'Min security level (1-5)' }),
      securityLevelMax: z.string().optional().openapi({ description: 'Max security level (1-5)' }),
      sortBy: z
        .enum(['registeredAt', 'number', 'name', 'revision', 'state'])
        .optional()
        .openapi({ description: 'Sort field' }),
      sortDir: z.enum(['asc', 'desc']).optional().openapi({ description: 'Sort direction' }),
      cursor: z.string().optional().openapi({ description: 'Cursor (last item ID) for pagination' }),
      limit: z.string().optional().openapi({ description: 'Page size (1-100, default 50)' }),
    }),
  },
  responses: {
    200: {
      description: 'Paginated object list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ObjectSummary),
            meta: z.object({
              nextCursor: z.string().nullable(),
              hasMore: z.boolean(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// POST /api/v1/objects  — create
// ---------------------------------------------------------------------------

const CreateObjectRequest = registerSchema(
  'CreateObjectRequest',
  z.object({
    folderId: z.string().min(1).openapi({ description: 'Target folder ID' }),
    classId: z.string().min(1).openapi({ description: 'Object class ID' }),
    name: z.string().min(1).max(200).openapi({ description: 'Object name' }),
    description: z.string().max(2000).optional().openapi({ description: 'Optional description' }),
    securityLevel: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(5)
      .openapi({ description: 'Security level (1=highest, 5=lowest). Default 5.' }),
    number: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .openapi({ description: 'Manual drawing number. Auto-generated if omitted.' }),
    attributes: z
      .array(
        z.object({
          attributeId: z.string().min(1),
          value: z.string().max(1000),
        }),
      )
      .optional()
      .openapi({ description: 'Initial attribute values' }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/objects',
  tags: ['Objects'],
  summary: 'Create object',
  description:
    'Create a new ObjectEntity (state=NEW, currentRevision=0). Drawing number is auto-generated from numbering rules if not provided.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: CreateObjectRequest },
      },
    },
  },
  responses: {
    201: {
      description: 'Object created',
      content: {
        'application/json': {
          schema: z.object({ data: ObjectSummary }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'No EDIT permission on folder',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/objects/:id  — detail
// ---------------------------------------------------------------------------

const ObjectDetail = registerSchema(
  'ObjectDetail',
  z.object({
    id: z.string(),
    number: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    folderId: z.string(),
    classId: z.string(),
    securityLevel: z.number().int(),
    state: ObjectState,
    ownerId: z.string(),
    currentRevision: z.number().int(),
    currentVersion: z.string(),
    lockedById: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    folder: z.object({
      id: z.string(),
      name: z.string(),
      folderCode: z.string(),
    }),
    class: z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
    }),
    owner: z.object({
      id: z.string(),
      username: z.string(),
      fullName: z.string(),
      organizationId: z.string().nullable(),
    }),
    lockedBy: z
      .object({
        id: z.string(),
        username: z.string(),
        fullName: z.string(),
      })
      .nullable(),
    attributes: z.array(
      z.object({
        id: z.string(),
        value: z.string(),
        attribute: z.object({
          id: z.string(),
          code: z.string(),
          label: z.string(),
          dataType: z.string(),
          required: z.boolean(),
          comboItems: z.any().nullable(),
          sortOrder: z.number().int(),
        }),
      }),
    ),
    revisions: z.array(
      z.object({
        id: z.string(),
        rev: z.number().int(),
        createdAt: z.string(),
        versions: z.array(
          z.object({
            id: z.string(),
            ver: z.number().int(),
            createdAt: z.string(),
            attachments: z.array(
              z.object({
                id: z.string(),
                filename: z.string(),
                mimeType: z.string(),
                size: z.string().openapi({ description: 'File size in bytes (BigInt as string)' }),
                isMaster: z.boolean(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/objects/{id}',
  tags: ['Objects'],
  summary: 'Object detail',
  description:
    'Full object detail with folder, class, owner, attributes, revisions, versions, and attachments.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Object ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Object detail',
      content: {
        'application/json': {
          schema: z.object({ data: ObjectDetail }),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'No VIEW permission',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'Object not found',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/folders  — folder tree
// ---------------------------------------------------------------------------

const FolderNode: z.ZodType = z.lazy(() =>
  z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    folderCode: z.string(),
    defaultClassId: z.string().nullable(),
    sortOrder: z.number().int(),
    objectCount: z.number().int(),
    children: z.array(FolderNode),
  }),
);
registerSchema('FolderNode', FolderNode);

registry.registerPath({
  method: 'get',
  path: '/api/v1/folders',
  tags: ['Folders'],
  summary: 'Folder tree',
  description:
    'Returns the full folder tree filtered by VIEW_FOLDER permission. Ancestors of visible folders are auto-included.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Folder tree',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(FolderNode),
          }),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// POST /api/v1/folders  — create folder
// ---------------------------------------------------------------------------

const CreateFolderRequest = registerSchema(
  'CreateFolderRequest',
  z.object({
    name: z.string().min(1).max(100).openapi({ description: 'Folder name' }),
    folderCode: z
      .string()
      .min(1)
      .max(32)
      .openapi({ description: 'Unique uppercase folder code (A-Z, 0-9, _, -)' }),
    parentId: z.string().nullable().optional().openapi({ description: 'Parent folder ID (null for root)' }),
    defaultClassId: z.string().nullable().optional().openapi({ description: 'Default class for new objects in this folder' }),
    sortOrder: z.number().int().min(0).max(9999).optional().openapi({ description: 'Sort order (0-9999)' }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/folders',
  tags: ['Folders'],
  summary: 'Create folder',
  description: 'Create a new folder. Requires ADMIN or SUPER_ADMIN role.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: CreateFolderRequest },
      },
    },
  },
  responses: {
    201: {
      description: 'Folder created',
      content: {
        'application/json': {
          schema: z.object({
            data: z.object({
              id: z.string(),
              name: z.string(),
              folderCode: z.string(),
              parentId: z.string().nullable(),
              defaultClassId: z.string().nullable(),
              sortOrder: z.number().int(),
              createdAt: z.string(),
              updatedAt: z.string(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Validation error or duplicate folderCode',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Not admin',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/classes  — class list
// ---------------------------------------------------------------------------

const ObjectClassWithAttributes = registerSchema(
  'ObjectClassWithAttributes',
  z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    objectCount: z.number().int(),
    attributes: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        label: z.string(),
        dataType: z.string(),
        required: z.boolean(),
        sortOrder: z.number().int(),
      }),
    ),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/classes',
  tags: ['Admin'],
  summary: 'List object classes',
  description: 'Returns all object classes with their attributes. Requires ADMIN or SUPER_ADMIN role.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Class list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ObjectClassWithAttributes),
          }),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Not admin',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/classes  — create class
// ---------------------------------------------------------------------------

const CreateClassRequest = registerSchema(
  'CreateClassRequest',
  z.object({
    code: z
      .string()
      .min(1)
      .max(32)
      .openapi({ description: 'Unique uppercase class code (A-Z, 0-9, _, -)' }),
    name: z.string().min(1).max(100).openapi({ description: 'Class display name' }),
    description: z.string().max(500).optional().openapi({ description: 'Optional description' }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/classes',
  tags: ['Admin'],
  summary: 'Create object class',
  description: 'Create a new ObjectClass. Requires ADMIN or SUPER_ADMIN role.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: CreateClassRequest },
      },
    },
  },
  responses: {
    201: {
      description: 'Class created',
      content: {
        'application/json': {
          schema: z.object({
            data: z.object({
              id: z.string(),
              code: z.string(),
              name: z.string(),
              description: z.string().nullable(),
              createdAt: z.string(),
              updatedAt: z.string(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Validation error or duplicate code',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Not admin',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// R-AUDIT-TREND — pnpm audit snapshot trend
// ---------------------------------------------------------------------------

const SecurityAuditTrendSnapshot = registerSchema(
  'SecurityAuditTrendSnapshot',
  z.object({
    id: z.string(),
    takenAt: z.string().openapi({ description: 'ISO 8601 timestamp' }),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    source: z.string().openapi({ description: "'cron' | 'manual'" }),
    durationMs: z.number().int().nullable().openapi({
      description: 'pnpm audit subprocess duration in milliseconds',
    }),
  }),
);

const SecurityAuditTrendResponse = registerSchema(
  'SecurityAuditTrendResponse',
  z.object({
    data: z.object({
      days: z.number().int().min(1).max(365),
      source: z.enum(['cron', 'manual']),
      snapshots: z.array(SecurityAuditTrendSnapshot),
    }),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/security/audit/trend',
  tags: ['Admin'],
  summary: 'Security audit snapshot trend',
  description:
    'Time-series of `pnpm audit` snapshots (R-AUDIT-TREND, FIND-016 mitigation). ' +
    'Returns rows sorted by `takenAt` ASC for chart-friendly consumption. ' +
    'Default source=cron filters out admin manual reruns. Requires ADMIN or SUPER_ADMIN.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      days: z.coerce
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .openapi({ description: 'Window in days (default 30, max 365)' }),
      source: z
        .enum(['cron', 'manual'])
        .optional()
        .openapi({ description: 'Filter by snapshot source (default cron)' }),
    }),
  },
  responses: {
    200: {
      description: 'Snapshot trend',
      content: { 'application/json': { schema: SecurityAuditTrendResponse } },
    },
    400: {
      description: 'Validation error (days out of range)',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Not admin',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

const SecurityAuditSnapshotEnqueueResponse = registerSchema(
  'SecurityAuditSnapshotEnqueueResponse',
  z.object({
    data: z.object({
      queued: z.literal(true),
      jobId: z.string(),
    }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/security/audit/snapshot',
  tags: ['Admin'],
  summary: 'Trigger ad-hoc pnpm audit snapshot',
  description:
    'Push a manual snapshot job onto the BullMQ `security-audit` queue (R-AUDIT-TREND). ' +
    'The worker runs `pnpm audit --json` asynchronously and writes a `SecurityAuditSnapshot` row ' +
    'tagged source=manual. Requires SUPER_ADMIN (manual snapshots cost a subprocess + a DB row).',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({}).openapi({
            description: 'Empty body. Reserved for future options (e.g. force).',
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Job queued',
      content: {
        'application/json': { schema: SecurityAuditSnapshotEnqueueResponse },
      },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Not SUPER_ADMIN',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    503: {
      description: 'Failed to enqueue (Redis unreachable)',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// R-PDF-MERGE — bulk PDF merge (P-2 As-Is parity)
// ---------------------------------------------------------------------------

const BulkPdfMergeRequest = registerSchema(
  'BulkPdfMergeRequest',
  z.object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(50)
      .openapi({ description: '병합할 자료 id 1..50건' }),
    ctb: z
      .enum(['mono', 'color-a3'])
      .optional()
      .openapi({ description: '플롯 스타일 (default mono)' }),
    pageSize: z
      .enum(['A4', 'A3'])
      .optional()
      .openapi({ description: '출력 용지 크기 (default A4)' }),
  }),
);

const BulkPdfMergeFailureRow = registerSchema(
  'BulkPdfMergeFailureRow',
  z.object({
    id: z.string(),
    code: z
      .enum([
        'E_NOT_FOUND',
        'E_FORBIDDEN',
        'E_INFECTED',
        'E_UNSUPPORTED',
        'E_DXF_CACHE_MISSING',
      ])
      .openapi({ description: '사전 검증 실패 사유' }),
    message: z.string().openapi({ description: '한글 표시용 메시지' }),
  }),
);

const BulkPdfMergeResponse = registerSchema(
  'BulkPdfMergeResponse',
  z.object({
    data: z.object({
      jobId: z.string().openapi({ description: 'ConversionJob row id' }),
      status: z.literal('QUEUED'),
      objectCount: z.number().int().nonnegative(),
    }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/objects/bulk-pdf-merge',
  tags: ['Objects'],
  summary: '다중 자료 PDF 병합',
  description:
    'R-PDF-MERGE — 검색 결과에서 1..50건 선택 후 단일 PDF로 병합. ' +
    '권한/감염/mimeType 사전 검증을 통과하면 ConversionJob 행과 BullMQ ' +
    '`pdf-merge` 잡이 등록되고, FE는 `/api/v1/print-jobs/{jobId}/status`로 ' +
    '폴링 후 `/api/v1/print-jobs/{jobId}/merged.pdf`에서 합본을 다운로드한다. ' +
    '한 row라도 사전 검증을 통과 못하면 모든 실패를 details.failures[]로 한 번에 반환.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: BulkPdfMergeRequest },
      },
    },
  },
  responses: {
    200: {
      description: '병합 작업 등록 성공',
      content: { 'application/json': { schema: BulkPdfMergeResponse } },
    },
    400: {
      description: '검증 실패 (failures 배열 포함)',
      content: {
        'application/json': {
          schema: z.object({
            error: z.object({
              code: z.literal('E_VALIDATION'),
              message: z.string(),
              details: z.object({
                failures: z.array(BulkPdfMergeFailureRow),
              }),
            }),
          }),
        },
      },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: '레이트 리밋 초과',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: {
      description: '큐 푸시 실패',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/print-jobs/{jobId}/merged.pdf',
  tags: ['Objects'],
  summary: '병합 PDF 다운로드',
  description:
    'R-PDF-MERGE — `metadata.kind=PDF_MERGE`이면서 `status=DONE`인 ' +
    'ConversionJob의 합본 PDF를 스트리밍 다운로드. requestedBy 또는 ' +
    'admin/super_admin만 접근 가능. Content-Disposition은 ' +
    '`drawings-YYYY-MM-DD.pdf`.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      jobId: z.string().openapi({ description: 'ConversionJob row id' }),
    }),
  },
  responses: {
    200: {
      description: 'PDF 바이트 스트림',
      content: {
        'application/pdf': { schema: z.string().openapi({ format: 'binary' }) },
      },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: '본인 또는 admin만 접근 가능',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: '잡 없음 / 아직 준비 안 됨 / 전체 실패',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ---------------------------------------------------------------------------
// R-MARKUP / V-6 — measurement markups (save / share / list / load)
// ---------------------------------------------------------------------------
//
// The shapes here mirror `packages/shared/src/markup.ts` exactly. We
// re-declare them in zod-for-openapi rather than importing so the
// route's runtime path stays decoupled from doc generation (same
// convention as the rest of this file).

const MarkupMode = z.enum(['pdf', 'dxf']);
const MarkupSpace = z.enum(['pdf-page', 'dxf-world']);
const MarkupKind = z.enum(['distance', 'polyline', 'area']);

const MarkupWorldPoint = registerSchema(
  'MarkupWorldPoint',
  z.object({
    x: z.number(),
    y: z.number(),
    space: MarkupSpace,
    page: z.number().int().positive().optional(),
  }),
);

const MarkupMeasurement = registerSchema(
  'MarkupMeasurement',
  z.object({
    id: z.string().min(1).max(64),
    kind: MarkupKind,
    points: z.array(MarkupWorldPoint).min(2).max(200),
    value: z.number(),
    perimeter: z.number().optional(),
    unitLabel: z.string().min(1).max(16),
    createdAt: z.number().int(),
  }),
);

const MarkupPayload = registerSchema(
  'MarkupPayload',
  z.object({
    schemaVersion: z.literal(1),
    mode: MarkupMode,
    unitLabel: z.string().min(1).max(16),
    measurements: z.array(MarkupMeasurement).max(500),
  }),
);

const MarkupRow = registerSchema(
  'MarkupRow',
  z.object({
    id: z.string(),
    attachmentId: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    name: z.string().min(1).max(200),
    isShared: z.boolean(),
    measurementCount: z.number().int().nonnegative(),
    mode: MarkupMode,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

const MarkupDetail = registerSchema(
  'MarkupDetail',
  MarkupRow.extend({ payload: MarkupPayload }),
);

const MarkupListResponse = registerSchema(
  'MarkupListResponse',
  z.object({
    data: z.object({
      attachmentId: z.string(),
      mine: z.array(MarkupRow),
      shared: z.array(MarkupRow),
    }),
  }),
);

const MarkupCreateRequest = registerSchema(
  'MarkupCreateRequest',
  z.object({
    name: z.string().min(1).max(200),
    isShared: z.boolean().default(false),
    payload: MarkupPayload,
  }),
);

const MarkupUpdateRequest = registerSchema(
  'MarkupUpdateRequest',
  z
    .object({
      name: z.string().min(1).max(200).optional(),
      isShared: z.boolean().optional(),
      payload: MarkupPayload.optional(),
    })
    .openapi({
      description:
        '모든 필드 옵션이지만 최소 1개 제공 필수 (name / isShared / payload)',
    }),
);

const MarkupDetailResponse = registerSchema(
  'MarkupDetailResponse',
  z.object({ data: MarkupDetail }),
);

const MarkupDeleteResponse = registerSchema(
  'MarkupDeleteResponse',
  z.object({ data: z.object({ deleted: z.literal(true) }) }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/attachments/{id}/markups',
  tags: ['Markup'],
  summary: '저장된 마크업 목록',
  description:
    'R-MARKUP / V-6 — 첨부에 저장된 측정 마크업 목록. 본인 소유 + 공유된 ' +
    'row를 `mine` / `shared` 두 배열로 분리해 반환. payload는 list 응답에 ' +
    '포함하지 않고 measurementCount/mode 같은 메타만 노출. 첨부 VIEW 권한 ' +
    '필요, INFECTED 첨부는 차단.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Attachment id' }),
    }),
  },
  responses: {
    200: {
      description: '목록 응답',
      content: { 'application/json': { schema: MarkupListResponse } },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'VIEW 권한 없음 또는 INFECTED 차단',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: '첨부 없음',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/attachments/{id}/markups',
  tags: ['Markup'],
  summary: '마크업 저장',
  description:
    'R-MARKUP / V-6 — 측정 세트를 저장. 본인 소유로 생성되며 isShared 토글로 ' +
    '공유 여부를 정함. payload는 schemaVersion=1 + mode + unitLabel + ' +
    'measurements[]. 측정 수 ≤500 / 점 수 ≤200 / 직렬화 후 ≤256KB. ' +
    '첨부 VIEW 권한 필요, INFECTED 차단, CSRF/Rate Limit 적용.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Attachment id' }),
    }),
    body: {
      content: {
        'application/json': { schema: MarkupCreateRequest },
      },
    },
  },
  responses: {
    200: {
      description: '저장된 마크업 (payload 포함)',
      content: { 'application/json': { schema: MarkupDetailResponse } },
    },
    400: {
      description: '검증 실패 (이름 빈 값, 측정 수/크기 초과 등)',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'VIEW 권한 없음 또는 INFECTED 차단',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: '첨부 없음',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: '레이트 리밋 초과',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/markups/{markupId}',
  tags: ['Markup'],
  summary: '마크업 상세 (payload 포함)',
  description:
    'R-MARKUP / V-6 — 단일 마크업 상세 조회. 리스트 응답은 row만 노출하고 ' +
    'payload는 본 엔드포인트로 lazy fetch. 가시성: 본인 OR isShared ' +
    'OR admin. 첨부 VIEW 권한 + INFECTED 가드 동일 적용.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      markupId: z.string().openapi({ description: 'Markup id' }),
    }),
  },
  responses: {
    200: {
      description: '마크업 상세 (payload 포함)',
      content: { 'application/json': { schema: MarkupDetailResponse } },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: '비공개 마크업이며 본인 또는 admin이 아님 / INFECTED',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: '마크업 없음',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/markups/{markupId}',
  tags: ['Markup'],
  summary: '마크업 갱신',
  description:
    'R-MARKUP / V-6 — name / isShared / payload 일부 또는 전부를 갱신. ' +
    '본인 또는 admin/super_admin만 가능. 모든 필드 옵션이지만 최소 1개 ' +
    '필수. payload 갱신 시 zod 캡 + 256KB 가드 동일 적용.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      markupId: z.string().openapi({ description: 'Markup id' }),
    }),
    body: {
      content: {
        'application/json': { schema: MarkupUpdateRequest },
      },
    },
  },
  responses: {
    200: {
      description: '갱신된 마크업 (payload 포함)',
      content: { 'application/json': { schema: MarkupDetailResponse } },
    },
    400: {
      description: '검증 실패 / 빈 body',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: '본인 또는 admin만 가능 / VIEW 권한 없음 / INFECTED',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: '마크업 없음',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: '레이트 리밋 초과',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/markups/{markupId}',
  tags: ['Markup'],
  summary: '마크업 삭제',
  description:
    'R-MARKUP / V-6 — 마크업 1건 삭제. 본인 또는 admin/super_admin만 가능.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      markupId: z.string().openapi({ description: 'Markup id' }),
    }),
  },
  responses: {
    200: {
      description: '삭제 완료',
      content: { 'application/json': { schema: MarkupDeleteResponse } },
    },
    401: {
      description: '인증 필요',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: '본인 또는 admin만 가능',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: '마크업 없음',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: '레이트 리밋 초과',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
