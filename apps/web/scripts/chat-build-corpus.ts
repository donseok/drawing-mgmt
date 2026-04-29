// R36 — Chatbot RAG corpus builder.
//
// Reads docs/{PRD,TRD,WBS,DESIGN}.md, splits each into heading-sized chunks
// via lib/chat/corpus.splitMarkdown, and upserts them as ManualChunk rows.
//
// When CHAT_EMBEDDING_BASE_URL is set we also call the embedder for each
// chunk and write the resulting vector via raw SQL (Prisma 5 has no native
// `vector` operator support). When the env is unset, rows are still upserted
// without embeddings — search will return nothing and the orchestrator
// falls back to rule mode automatically. This lets ops run the script in
// dev/CI without a live embedding gateway.
//
// Usage:
//   pnpm -F web chat:index
//
// Idempotent: re-running replaces all rows for the listed sources.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { splitMarkdown } from '../lib/chat/corpus';
import { embed, getEmbedderConfig } from '../lib/chat/embedder';

interface CorpusFile {
  source: 'prd' | 'trd' | 'wbs' | 'design';
  title: string;
  relPath: string;
}

const FILES: CorpusFile[] = [
  { source: 'prd', title: 'PRD', relPath: 'docs/PRD.md' },
  { source: 'trd', title: 'TRD', relPath: 'docs/TRD.md' },
  { source: 'wbs', title: 'WBS', relPath: 'docs/WBS.md' },
  { source: 'design', title: 'DESIGN', relPath: 'docs/DESIGN.md' },
];

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const cfg = getEmbedderConfig();
  if (cfg) {
    console.log(`[chat:index] embedding endpoint: ${cfg.baseUrl} (model=${cfg.model})`);
  } else {
    console.log('[chat:index] CHAT_EMBEDDING_BASE_URL not set — skipping vector pass');
  }

  let total = 0;
  let embedded = 0;

  for (const file of FILES) {
    const abs = path.resolve(repoRoot, file.relPath);
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf-8');
    } catch (err) {
      console.warn(`[chat:index] skip ${file.relPath}: ${(err as Error).message}`);
      continue;
    }
    const chunks = splitMarkdown(raw, file.title);
    console.log(`[chat:index] ${file.relPath} → ${chunks.length} chunks`);

    // Wipe out existing rows for this source so re-runs don't pile up
    // duplicates. Embeddings are dropped along with the row.
    await prisma.manualChunk.deleteMany({ where: { source: file.source } });

    for (const ch of chunks) {
      const created = await prisma.manualChunk.create({
        data: {
          source: file.source,
          title: ch.title,
          content: ch.content,
        },
        select: { id: true },
      });
      total += 1;

      if (cfg) {
        const vec = await embed(ch.content, cfg);
        if (vec) {
          // Prisma can't UPDATE the `vector` column directly. We inline the
          // bracket literal — values come from our own embedder so there's
          // no SQL-injection vector here.
          const literal = `[${vec.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "ManualChunk" SET embedding = $1::vector WHERE id = $2`,
            literal,
            created.id,
          );
          embedded += 1;
        } else {
          console.warn(`[chat:index] embed failed for chunk ${created.id} (${ch.title})`);
        }
      }
    }
  }

  console.log(`[chat:index] done — ${total} chunks total, ${embedded} embedded`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[chat:index] fatal', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
