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
  'RELEASED',
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
