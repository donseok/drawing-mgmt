// R-PDF-MERGE — sanity checks on the shared payload + result schemas. The
// route + worker share these via @drawing-mgmt/shared/conversion, so any
// drift surfaces here at build/test time rather than at runtime.

import { describe, it, expect } from 'vitest';
import {
  PDF_MERGE_QUEUE_NAME,
  PdfMergeJobPayloadSchema,
  PdfMergeFailureSchema,
  PdfMergeResultSchema,
} from '@drawing-mgmt/shared/conversion';

describe('R-PDF-MERGE shared schemas', () => {
  it('queue name matches the contract', () => {
    expect(PDF_MERGE_QUEUE_NAME).toBe('pdf-merge');
  });

  describe('PdfMergeJobPayloadSchema', () => {
    it('accepts a minimal valid payload', () => {
      const ok = PdfMergeJobPayloadSchema.parse({
        aggregateJobId: 'cl_job_1',
        attachmentIds: ['att_1'],
        ctb: 'mono',
        pageSize: 'A4',
      });
      expect(ok.aggregateJobId).toBe('cl_job_1');
      expect(ok.attachmentIds).toEqual(['att_1']);
    });

    it('rejects empty attachmentIds', () => {
      const result = PdfMergeJobPayloadSchema.safeParse({
        aggregateJobId: 'cl_job_1',
        attachmentIds: [],
        ctb: 'mono',
        pageSize: 'A4',
      });
      expect(result.success).toBe(false);
    });

    it('rejects >50 attachmentIds', () => {
      const result = PdfMergeJobPayloadSchema.safeParse({
        aggregateJobId: 'cl_job_1',
        attachmentIds: Array.from({ length: 51 }, (_, i) => `att_${i}`),
        ctb: 'mono',
        pageSize: 'A4',
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown ctb / pageSize', () => {
      expect(
        PdfMergeJobPayloadSchema.safeParse({
          aggregateJobId: 'cl_job_1',
          attachmentIds: ['att_1'],
          ctb: 'rainbow',
          pageSize: 'A4',
        }).success,
      ).toBe(false);
      expect(
        PdfMergeJobPayloadSchema.safeParse({
          aggregateJobId: 'cl_job_1',
          attachmentIds: ['att_1'],
          ctb: 'mono',
          pageSize: 'B5',
        }).success,
      ).toBe(false);
    });
  });

  describe('PdfMergeFailureSchema', () => {
    it('round-trips objectId + reason', () => {
      const f = PdfMergeFailureSchema.parse({
        objectId: 'obj_x',
        reason: '감염 의심 첨부입니다.',
      });
      expect(f.objectId).toBe('obj_x');
      expect(f.reason).toMatch(/감염/);
    });
  });

  describe('PdfMergeResultSchema', () => {
    it('accepts a partial-success result', () => {
      const r = PdfMergeResultSchema.parse({
        jobId: 'cl_job_1',
        totalCount: 3,
        successCount: 2,
        failureCount: 1,
        failures: [{ objectId: 'obj_x', reason: 'DXF 캐시 없음' }],
        pdfPath: 'cl_job_1/merged.pdf',
        durationMs: 12345,
      });
      expect(r.successCount).toBe(2);
      expect(r.failures).toHaveLength(1);
    });

    it('accepts an all-fail result with no pdfPath', () => {
      const r = PdfMergeResultSchema.parse({
        jobId: 'cl_job_1',
        totalCount: 1,
        successCount: 0,
        failureCount: 1,
        failures: [{ objectId: 'obj_x', reason: 'oops' }],
      });
      expect(r.pdfPath).toBeUndefined();
    });
  });
});
