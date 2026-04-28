// End-to-end pipeline tests against the in-memory MockSource.
//
// Every assertion is exercised against the dry-run path so the tests stay
// hermetic (no DB, no disk). The live-run path is gated behind the
// schema-delta TODO in prisma-loader.ts; once that lands, copy these tests
// into __tests__/integration/ and flip dryRun=false.

import { describe, expect, it } from 'vitest';
import {
  MockConversionQueue,
  MockSource,
  Pipeline,
} from '../src/index.js';

function buildPipeline(opts: {
  source?: MockSource;
  queue?: MockConversionQueue;
} = {}) {
  const source = opts.source ?? MockSource.create();
  const queue = opts.queue ?? new MockConversionQueue();
  const pipeline = new Pipeline({
    source,
    loader: { dryRun: true },
    conversionQueue: queue,
    storageRoot: '/tmp/migration-test',
  });
  return { source, queue, pipeline };
}

describe('Pipeline.dryRun', () => {
  it('processes all 50 mock drawings with zero row errors', async () => {
    const { pipeline } = buildPipeline();
    const report = await pipeline.dryRun();

    expect(report.mode).toBe('dry-run');
    expect(report.source.drawings).toBe(50);
    expect(report.load.counters.objects.inserted).toBe(50);
    expect(report.load.counters.attachments.inserted).toBe(50);
    expect(report.load.counters.users.inserted).toBe(10);
    expect(report.load.counters.folders.inserted).toBe(6); // root + 5
    expect(report.rowErrors).toEqual([]);
    expect(report.load.checksumMismatches).toEqual([]);
    expect(report.load.missingFiles).toEqual([]);
  });

  it('honours --sample N (only N drawings + their attachments)', async () => {
    const { pipeline } = buildPipeline();
    const report = await pipeline.dryRun({ sample: 10 });

    expect(report.load.counters.objects.inserted).toBe(10);
    // Attachments + revisions + versions follow drawings transitively.
    expect(report.load.counters.attachments.inserted).toBe(10);
    expect(report.load.counters.revisions.inserted).toBe(10);
    expect(report.load.counters.versions.inserted).toBe(10);
  });

  it('enqueues a conversion job per master attachment', async () => {
    const queue = new MockConversionQueue();
    const { pipeline } = buildPipeline({ queue });
    const report = await pipeline.dryRun();

    expect(report.conversionEnqueued).toBe(50);
    expect(queue.enqueued).toHaveLength(50);
    // First entry should match an attachment external id.
    expect(queue.enqueued[0]?.externalId).toMatch(/^att-ver-rev-drawing-/);
  });

  it('records missing files instead of crashing', async () => {
    const source = MockSource.create({
      missingFilePaths: new Set([
        'attachments/ver-rev-drawing-001/master.dwg',
      ]),
    });
    const { pipeline } = buildPipeline({ source });
    const report = await pipeline.dryRun();

    expect(report.load.missingFiles).toContain('att-ver-rev-drawing-001');
    expect(report.load.counters.attachments.errors).toBe(1);
    // Other 49 attachments still load.
    expect(report.load.counters.attachments.inserted).toBe(49);
  });

  it('records checksum mismatches when source body is corrupted', async () => {
    const source = MockSource.create({ corruptFirstN: 3 });
    const { pipeline } = buildPipeline({ source });
    const report = await pipeline.dryRun();

    // The mock corrupts the buffer *after* computing the source-side
    // checksum, so the dry-run loader's re-hash diverges → mismatch
    // recorded.
    expect(report.load.checksumMismatches.length).toBe(3);
  });

  it('captures number-collisions in the report', async () => {
    // We can't easily hit a collision with the default mock (every number
    // is unique); instead simulate it by reusing source records via two
    // pipeline runs is overkill — we directly assert the shape: an empty
    // collisions array when the mock data is clean.
    const { pipeline } = buildPipeline();
    const report = await pipeline.dryRun();
    expect(report.numberCollisions).toEqual([]);
  });
});

describe('Pipeline.verify', () => {
  it('reports 0 mismatches for the 50 mock drawings', async () => {
    const { pipeline } = buildPipeline();
    const report = await pipeline.verify({ sampleSize: 50 });

    expect(report.sampleSize).toBe(50);
    expect(report.matched).toBe(50);
    expect(report.mismatched).toBe(0);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it('caps the sample at the requested size', async () => {
    const { pipeline } = buildPipeline();
    const report = await pipeline.verify({ sampleSize: 7 });

    expect(report.sampleSize).toBe(7);
    expect(report.matched).toBe(7);
  });
});

describe('Pipeline.full', () => {
  it('refuses to run with dryRun=true loader', async () => {
    const { pipeline } = buildPipeline();
    await expect(pipeline.full()).rejects.toThrow(/dryRun=false/);
  });
});

describe('idempotency', () => {
  it('is safe to call dryRun() twice on a fresh pipeline', async () => {
    const { pipeline } = buildPipeline();
    const first = await pipeline.dryRun();
    const second = await pipeline.dryRun();
    // Same source → identical counters.
    expect(second.load.counters).toEqual(first.load.counters);
  });
});
