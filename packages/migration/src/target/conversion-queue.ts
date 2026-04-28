// BullMQ conversion queue adapter.
//
// The pipeline enqueues a conversion job per master attachment so the
// thumbnail / DXF preview pipeline runs after the rows are inserted. The
// real `apps/web/lib/conversion-queue.ts` already exposes an `enqueue`
// helper backed by BullMQ; we deliberately don't import it here to keep
// `packages/migration` decoupled from the web app's runtime (no Redis
// client in the migration's deps, no Next.js side effects).
//
// Two implementations:
//   - `MockConversionQueue` — collects ids in an array, used by tests +
//     dry-run.
//   - `LiveConversionQueue` — TODO. When ops greenlights live runs, wire
//     this to the same Redis instance the web app talks to (env:
//     `REDIS_URL`) using BullMQ. Either:
//       (a) import the helper from `@drawing-mgmt/web/lib/conversion-queue`
//           if we expose it as a workspace-package export, or
//       (b) duplicate the minimal `new Queue('conversion').add(...)` here
//           with `bullmq` + `ioredis` deps added to this package.
//     Option (a) is cleaner; deferred until real-run round.

export interface ConversionEnqueueRequest {
  /** Attachment external id (TeamPlus side) — useful for reporting. */
  externalId: string;
  /** drawing-mgmt Attachment.id (after load). */
  attachmentId: string;
  filename: string;
  mimeType: string;
}

export interface ConversionQueueAdapter {
  enqueue(req: ConversionEnqueueRequest): Promise<void>;
  /** Drain — returns total enqueued count. Used by reports. */
  size(): number;
}

export class MockConversionQueue implements ConversionQueueAdapter {
  readonly enqueued: ConversionEnqueueRequest[] = [];

  async enqueue(req: ConversionEnqueueRequest): Promise<void> {
    this.enqueued.push(req);
  }

  size(): number {
    return this.enqueued.length;
  }
}
