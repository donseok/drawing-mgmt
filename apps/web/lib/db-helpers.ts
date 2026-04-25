/**
 * DB-level helpers — pure or transactional. Importable from server code only.
 *
 * - evaluateNumberRule: render a NumberRule (with parts) into a concrete
 *   document number string per TRD §3.
 * - nextSequence: derive the next sequence number for a (folderCode, year)
 *   tuple. Phase-1 implementation uses MAX(seq)+1 inside a transaction.
 *
 * @see docs/TRD.md §3 (NumberRule, NumberRulePart, PartType)
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** PartType values mirror the Prisma enum. */
export type NumberRulePartType = 'FOLDER_CODE' | 'LITERAL' | 'SEQUENCE' | 'YEAR';

export interface NumberRulePartLike {
  type: NumberRulePartType;
  value: string | null;
  digits: number | null;
  initial: number | null;
  order: number;
}

export interface NumberRuleLike {
  id: string;
  name: string;
  parts: NumberRulePartLike[];
}

/** Context passed in by the caller — usually derived from the target Folder. */
export interface NumberRuleContext {
  folderCode: string;
  /** Override the year used by YEAR parts. Defaults to current year. */
  year?: number;
  /**
   * Override the sequence value used by SEQUENCE parts. If omitted,
   * `evaluateNumberRule` will call `nextSequence(folderCode, year)` to derive
   * the next value transactionally.
   */
  sequence?: number;
}

/**
 * Anything that exposes the Prisma transaction surface we need:
 *   - $queryRaw / $queryRawUnsafe (for FOR UPDATE escape hatch if ever wanted)
 *   - objectEntity.findMany (for the MAX(seq)+1 fallback)
 *
 * Accept either a full `PrismaClient` or a transactional client (`Prisma.TransactionClient`).
 */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/*  Number-rule rendering                                                     */
/* -------------------------------------------------------------------------- */

function pad(n: number, width: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function renderPart(
  part: NumberRulePartLike,
  ctx: Required<Pick<NumberRuleContext, 'folderCode' | 'year'>> & {
    sequence: number;
  },
): string {
  switch (part.type) {
    case 'FOLDER_CODE':
      return ctx.folderCode;
    case 'LITERAL':
      return part.value ?? '';
    case 'YEAR': {
      const digits = part.digits ?? 4;
      const yearStr = String(ctx.year);
      // YEAR(2) → take last 2 chars; YEAR(4) → full year.
      return digits >= 4 ? yearStr.padStart(4, '0') : yearStr.slice(-digits);
    }
    case 'SEQUENCE': {
      const digits = part.digits ?? 5;
      return pad(ctx.sequence, digits);
    }
    default: {
      const exhaustive: never = part.type;
      throw new Error(`Unknown PartType: ${String(exhaustive)}`);
    }
  }
}

/**
 * Render a NumberRule into a final number string (e.g. "CGL-MEC-2026-00001").
 *
 * If `ctx.sequence` is omitted **and** the rule contains a SEQUENCE part, the
 * caller MUST pass a Prisma client so the helper can derive the next sequence
 * value transactionally via `nextSequence`.
 *
 * For idempotent / preview rendering (e.g. UI previews), pass an explicit
 * `ctx.sequence` and `prisma` may be omitted.
 */
export async function evaluateNumberRule(
  rule: NumberRuleLike,
  ctx: NumberRuleContext,
  prisma?: PrismaLike,
): Promise<string> {
  const year = ctx.year ?? new Date().getFullYear();
  const parts = [...rule.parts].sort((a, b) => a.order - b.order);
  const hasSequence = parts.some((p) => p.type === 'SEQUENCE');

  let sequence = ctx.sequence ?? 0;
  if (hasSequence && ctx.sequence === undefined) {
    if (!prisma) {
      throw new Error(
        'evaluateNumberRule: rule contains SEQUENCE; prisma client required when ctx.sequence is omitted.',
      );
    }
    const initial =
      parts.find((p) => p.type === 'SEQUENCE')?.initial ?? 1;
    sequence = await nextSequence(prisma, ctx.folderCode, year, initial);
  }

  return parts
    .map((p) => renderPart(p, { folderCode: ctx.folderCode, year, sequence }))
    .join('');
}

/* -------------------------------------------------------------------------- */
/*  Sequence (per folderCode + year)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Return the next sequence integer for a given (folderCode, year) bucket.
 *
 * Implementation note (Phase 1 limitation):
 *   The schema does not include a dedicated sequence table, so we derive the
 *   next value by scanning ObjectEntity.number for the prefix
 *   `${folderCode}-${year}-` and taking max+1.
 *
 *   This is correct under low concurrency. To prevent two concurrent
 *   registrations from picking the same sequence, callers should run this
 *   inside a `prisma.$transaction` with Serializable isolation, OR adopt a
 *   real sequence table in Phase 2.
 *
 * @param prisma     Prisma client or transactional client.
 * @param folderCode Folder.folderCode (e.g. "CGL-MEC")
 * @param year       4-digit year used in the number
 * @param initial    Starting value if no rows exist yet (default 1)
 */
export async function nextSequence(
  prisma: PrismaLike,
  folderCode: string,
  year: number,
  initial = 1,
): Promise<number> {
  const prefix = `${folderCode}-${year}-`;

  // Pull just the candidates we need — a `LIKE` indexed scan on
  // ObjectEntity.number (we have an index on `number`).
  const rows = await prisma.objectEntity.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });

  let max = 0;
  for (const r of rows) {
    const tail = r.number.slice(prefix.length);
    // Only consider all-digit suffixes (defensive — number rules vary).
    if (!/^\d+$/.test(tail)) continue;
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return max === 0 ? Math.max(1, initial) : max + 1;
}
