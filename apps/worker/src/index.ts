// DWG conversion worker entry.
//
// Pulls ConversionJob payloads off BullMQ, runs ODA File Converter to produce
// DXF (and other targets when implemented), stores results under
// FILE_STORAGE_ROOT/<attachmentId>/, and reports paths back via the result.
//
// PDF generation: NOT YET IMPLEMENTED. ODA File Converter only does DWG↔DXF.
// PDF requires a separate tool (e.g. LibreCAD/QCad CLI, AutoCAD, or rendering
// the DXF via a SVG → PDF pipeline). Tracked as a follow-up.

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CONVERSION_QUEUE_NAME,
  ConversionJobPayloadSchema,
  type ConversionJobPayload,
  type ConversionResult,
} from '@drawing-mgmt/shared/conversion';
import { dwgToDxf } from './oda.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ODA_CONVERTER_PATH =
  process.env.ODA_CONVERTER_PATH ??
  'C:/Program Files/ODA/ODAFileConverter 27.1.0/ODAFileConverter.exe';
const FILE_STORAGE_ROOT = path.resolve(
  process.env.FILE_STORAGE_ROOT ?? './.data/files',
);

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

async function processJob(job: Job<ConversionJobPayload>): Promise<ConversionResult> {
  const startedAt = Date.now();
  const payload = ConversionJobPayloadSchema.parse(job.data);
  log.info({ jobId: payload.jobId, attachmentId: payload.attachmentId }, 'conversion start');

  const sourcePath = path.resolve(payload.storagePath);
  await fs.access(sourcePath);

  const outDir = path.join(FILE_STORAGE_ROOT, payload.attachmentId);
  await fs.mkdir(outDir, { recursive: true });

  let dxfOutPath: string | undefined;
  if (payload.outputs.includes('dxf')) {
    const { dxfPath, cleanup } = await dwgToDxf(sourcePath, {
      converterPath: ODA_CONVERTER_PATH,
    });
    try {
      const target = path.join(outDir, 'preview.dxf');
      await fs.copyFile(dxfPath, target);
      dxfOutPath = target;
    } finally {
      await cleanup();
    }
  }

  const result: ConversionResult = {
    jobId: payload.jobId,
    attachmentId: payload.attachmentId,
    status: 'DONE',
    dxfPath: dxfOutPath,
    durationMs: Date.now() - startedAt,
  };
  log.info({ ...result }, 'conversion done');
  return result;
}

const worker = new Worker<ConversionJobPayload, ConversionResult>(CONVERSION_QUEUE_NAME, processJob, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
});

worker.on('completed', (job, result) => {
  log.info({ jobId: result.jobId, durationMs: result.durationMs }, 'job completed');
});
worker.on('failed', (job, err) => {
  log.error({ jobId: job?.data?.jobId, err: err.message }, 'conversion failed');
});

const shutdown = async (sig: string) => {
  log.info({ sig }, 'worker shutting down');
  await worker.close();
  await connection.quit();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info({ queue: CONVERSION_QUEUE_NAME, redis: REDIS_URL, oda: ODA_CONVERTER_PATH }, 'worker started');
