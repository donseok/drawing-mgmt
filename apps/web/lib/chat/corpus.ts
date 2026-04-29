// R36 — Markdown → chunk splitter for the RAG corpus.
//
// Splits a markdown document by ATX headings (`# foo`, `## bar`) and groups
// each heading + its body until the next heading. Long sections are further
// sliced so each chunk stays roughly under `MAX_CHARS_PER_CHUNK` (~2KB,
// approximately 500 OpenAI tokens for Korean text).
//
// Used by:
//   - `apps/web/scripts/chat-build-corpus.ts` — bulk index the docs/* files.
//   - (future) admin UI for re-indexing arbitrary uploaded notes.
//
// Output is a flat list of `{ title, content }`. Title carries the heading
// stack for breadcrumbs ("PRD > 4. 권한 모델 > 폴더 권한 비트").

export interface RawChunk {
  /** Hierarchical heading path joined with " > ". */
  title: string;
  /** Body text (heading line excluded). */
  content: string;
}

const MAX_CHARS_PER_CHUNK = 2_000;
const MIN_CHARS_PER_CHUNK = 80;

interface HeadingFrame {
  level: number;
  text: string;
}

/**
 * Split markdown into chunks. Empty and code-fenced lines are preserved in
 * `content` verbatim — the embedder/LLM see the same text the human reads.
 */
export function splitMarkdown(markdown: string, sourceTitle?: string): RawChunk[] {
  const lines = markdown.split(/\r?\n/);
  const chunks: RawChunk[] = [];
  const stack: HeadingFrame[] = sourceTitle
    ? [{ level: 0, text: sourceTitle }]
    : [];
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join('\n').trim();
    currentBody = [];
    if (!body) return;
    const titlePath = stack.map((s) => s.text).filter(Boolean).join(' > ');
    pushSliced(chunks, titlePath || sourceTitle || 'document', body);
  };

  let inCodeFence = false;

  for (const line of lines) {
    // Track ``` fences so headings inside code blocks don't break sections.
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      currentBody.push(line);
      continue;
    }
    const headingMatch = !inCodeFence ? /^(#{1,6})\s+(.*)$/.exec(line) : null;
    if (headingMatch) {
      flush();
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!.trim();
      // Pop frames at >= level so the heading stack reflects nesting.
      while (stack.length && stack[stack.length - 1]!.level >= level) {
        stack.pop();
      }
      stack.push({ level, text });
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return chunks.filter((c) => c.content.length >= MIN_CHARS_PER_CHUNK);
}

function pushSliced(out: RawChunk[], title: string, body: string): void {
  if (body.length <= MAX_CHARS_PER_CHUNK) {
    out.push({ title, content: body });
    return;
  }
  // Slice on paragraph boundaries when possible to keep semantic coherence.
  const paragraphs = body.split(/\n{2,}/);
  let buf: string[] = [];
  let len = 0;
  for (const p of paragraphs) {
    const next = len + p.length + 2;
    if (next > MAX_CHARS_PER_CHUNK && buf.length) {
      out.push({ title, content: buf.join('\n\n') });
      buf = [p];
      len = p.length;
    } else {
      buf.push(p);
      len = next;
    }
  }
  if (buf.length) {
    // Tail might still exceed the cap if a single paragraph is huge — split
    // by hard char boundary as a last resort.
    const tail = buf.join('\n\n');
    if (tail.length > MAX_CHARS_PER_CHUNK) {
      for (let i = 0; i < tail.length; i += MAX_CHARS_PER_CHUNK) {
        out.push({ title, content: tail.slice(i, i + MAX_CHARS_PER_CHUNK) });
      }
    } else {
      out.push({ title, content: tail });
    }
  }
}
