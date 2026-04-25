import { z } from 'zod';

// ConversionJob 큐 페이로드 (apps/web → apps/worker)
export const ConversionJobPayloadSchema = z.object({
  jobId: z.string(),
  attachmentId: z.string(),
  storagePath: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  outputs: z.array(z.enum(['pdf', 'pdf-color', 'dxf', 'svg', 'thumbnail'])).default(['pdf', 'dxf', 'thumbnail']),
});

export type ConversionJobPayload = z.infer<typeof ConversionJobPayloadSchema>;

export const ConversionResultSchema = z.object({
  jobId: z.string(),
  attachmentId: z.string(),
  status: z.enum(['DONE', 'FAILED']),
  pdfPath: z.string().optional(),
  dxfPath: z.string().optional(),
  svgPath: z.string().optional(),
  thumbnailPath: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type ConversionResult = z.infer<typeof ConversionResultSchema>;

export const CONVERSION_QUEUE_NAME = 'dwg-conversion';
