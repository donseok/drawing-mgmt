// R36 — pgvector cosine similarity retriever.
//
// Queries `ManualChunk` rows whose `embedding vector(1536)` column is closest
// to the supplied query embedding using the `<=>` cosine-distance operator
// (smaller = closer). Cosine similarity = `1 - distance` and gates the
// rag-vs-rule decision (contract §3.1: top-1 ≥ CHAT_RAG_SIMILARITY_MIN → RAG).
//
// We use `prisma.$queryRawUnsafe` because:
//   - Prisma 5 has no native `vector` operator support (issue #18484), so the
//     vector literal must be inlined as a string cast (`'[0.1,0.2,...]'::vector`).
//   - Tagged-template `$queryRaw` would still work, but the vector literal is
//     a single fixed string we sanitize ourselves (every component is a
//     number from `embed()` output) — no user input crosses this boundary.
//
// Rows without an embedding (build-corpus script ran in stub mode without
// CHAT_EMBEDDING_*) are filtered via `WHERE embedding IS NOT NULL`.

import { prisma } from '@/lib/prisma';

export interface RetrievedChunk {
  chunkId: string;
  source: string;
  title: string;
  content: string;
  similarity: number; // 0..1, cosine
}

const DEFAULT_TOP_N = 4;

export function getSimilarityThreshold(): number {
  const raw = process.env.CHAT_RAG_SIMILARITY_MIN;
  if (!raw) return 0.55;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.55;
  return n;
}

/**
 * Fetch the top-N most similar manual chunks. Returns `[]` if pgvector isn't
 * available or there are no chunks with embeddings — caller should treat
 * empty array as "no RAG context, fall back to rule mode".
 */
export async function retrieveChunks(
  queryEmbedding: number[],
  topN = DEFAULT_TOP_N,
): Promise<RetrievedChunk[]> {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];
  // Reject obviously malformed vectors before hitting Postgres.
  if (!queryEmbedding.every((n) => typeof n === 'number' && Number.isFinite(n))) return [];

  const literal = `[${queryEmbedding.join(',')}]`;
  const limit = Math.max(1, Math.min(20, Math.floor(topN)));

  try {
    // The `<=>` operator returns cosine *distance*; similarity = 1 - dist.
    // We name columns explicitly so a future schema rename (e.g. `embedding`
    // → `embed_vec`) shows up as a clear compile error rather than silent
    // missing-row behavior.
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id            AS "chunkId",
              source        AS "source",
              title         AS "title",
              content       AS "content",
              1 - (embedding <=> $1::vector) AS "similarity"
         FROM "ManualChunk"
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT ${limit}`,
      literal,
    )) as RetrievedChunk[];

    // Coerce `similarity` to plain JS number (Prisma can hand back string for
    // numeric/decimal in some drivers; pg_vector returns float8 so this is
    // usually a no-op but cheap insurance).
    return rows.map((r) => ({
      chunkId: r.chunkId,
      source: r.source,
      title: r.title,
      content: r.content,
      similarity: typeof r.similarity === 'number' ? r.similarity : Number(r.similarity),
    }));
  } catch (err) {
    console.warn('[chat/retriever] pgvector query failed', (err as Error)?.message ?? err);
    return [];
  }
}

/** Convenience: top-1 chunk above the threshold, or null. */
export function pickTopAboveThreshold(
  chunks: RetrievedChunk[],
  threshold = getSimilarityThreshold(),
): RetrievedChunk | null {
  const top = chunks[0];
  if (!top) return null;
  return top.similarity >= threshold ? top : null;
}
