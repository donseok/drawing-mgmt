// CLI smoke tests — exercises argv parsing + the main() dispatcher
// against a tmp report directory. Verifies that:
//   * `dry-run` writes a migration JSON
//   * `verify` writes a verify JSON
//   * `full` is gated until the schema delta lands
//   * `MIGRATION_DRY_RUN=1` coerces full → dry-run

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from '../src/cli.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-cli-'));
  process.env.MIGRATION_REPORT_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.MIGRATION_REPORT_DIR;
  delete process.env.MIGRATION_DRY_RUN;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('defaults to help when no command is provided', () => {
    expect(parseArgs(['node', 'cli.ts']).command).toBe('help');
  });
  it('parses --sample', () => {
    expect(
      parseArgs(['node', 'cli.ts', 'dry-run', '--sample', '7']).sample,
    ).toBe(7);
  });
  it('parses --resume', () => {
    expect(
      parseArgs(['node', 'cli.ts', 'full', '--resume']).resume,
    ).toBe(true);
  });
});

describe('main', () => {
  // Silence stdout/stderr during the tests so the report-dump JSON
  // doesn't drown the test runner output.
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-run writes a migration-*.json report', async () => {
    const code = await main(['node', 'cli.ts', 'dry-run']);
    expect(code).toBe(0);
    const files = fs.readdirSync(tmpDir);
    expect(files.some((f) => f.startsWith('migration-'))).toBe(true);
  });

  it('verify writes a verify-*.json report', async () => {
    const code = await main(['node', 'cli.ts', 'verify', '--sample', '5']);
    expect(code).toBe(0);
    const files = fs.readdirSync(tmpDir);
    expect(files.some((f) => f.startsWith('verify-'))).toBe(true);
  });

  it('full is gated to exit code 2 (schema delta pending)', async () => {
    const code = await main(['node', 'cli.ts', 'full']);
    expect(code).toBe(2);
  });

  it('MIGRATION_DRY_RUN=1 coerces full → dry-run (exit 0)', async () => {
    process.env.MIGRATION_DRY_RUN = '1';
    const code = await main(['node', 'cli.ts', 'full']);
    expect(code).toBe(0);
  });

  it('rehearsal runs both dry-run + verify', async () => {
    const code = await main(['node', 'cli.ts', 'rehearsal']);
    expect(code).toBe(0);
    const files = fs.readdirSync(tmpDir);
    expect(files.some((f) => f.startsWith('migration-'))).toBe(true);
    expect(files.some((f) => f.startsWith('verify-'))).toBe(true);
  });
});
