// DWG 변환 워커 entry — TRD §4 (변환 파이프라인) 스텁
// 실제 ODA File Converter 어댑터·BullMQ Worker는 1주차 W1.3에서 구현
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import {
  CONVERSION_QUEUE_NAME,
  ConversionJobPayloadSchema,
  type ConversionJobPayload,
  type ConversionResult,
} from '@drawing-mgmt/shared/conversion';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

async function processJob(job: Job<ConversionJobPayload>): Promise<ConversionResult> {
  const payload = ConversionJobPayloadSchema.parse(job.data);
  log.info({ jobId: payload.jobId, attachmentId: payload.attachmentId }, 'conversion start');
  // TODO(W1.3): ODA File Converter CLI 호출 (execa)
  //   1. DWG → DXF (R2018 ASCII)
  //   2. DWG → PDF (monochrome / color)
  //   3. PDF 1p → PNG 256x256 (sharp + ghostscript)
  //   4. 결과물을 FILE_STORAGE_ROOT/yyyy/mm/uuid.{ext} 로 저장
  //   5. ConversionResult 반환 (Web에서 Attachment 업데이트)
  await new Promise((r) => setTimeout(r, 200)); // 스텁 지연
  log.warn({ jobId: payload.jobId }, 'conversion stub — 실제 구현은 W1.3에서');
  return {
    jobId: payload.jobId,
    attachmentId: payload.attachmentId,
    status: 'DONE',
    pdfPath: payload.storagePath.replace(/\.dwg$/i, '.pdf'),
    dxfPath: payload.storagePath.replace(/\.dwg$/i, '.dxf'),
    thumbnailPath: payload.storagePath.replace(/\.dwg$/i, '.png'),
    durationMs: 200,
  };
}

const worker = new Worker<ConversionJobPayload, ConversionResult>(CONVERSION_QUEUE_NAME, processJob, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
});

worker.on('completed', (job, result) => {
  log.info({ jobId: result.jobId, durationMs: result.durationMs }, 'conversion done');
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

log.info({ queue: CONVERSION_QUEUE_NAME, redis: REDIS_URL }, 'worker started');
