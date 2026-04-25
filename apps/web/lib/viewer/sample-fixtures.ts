/**
 * Dev sample fixtures used when the API returns 404 (i.e. no real preview
 * exists yet because the conversion pipeline isn't running).
 *
 * - {@link SAMPLE_PDF_DATA_URL} — minimal valid 1-page PDF rendering Korean
 *   sample text. Hand-authored bytes (no toolchain dep). Renders in PDF.js
 *   without a worker round-trip beyond what's already required for any PDF.
 * - {@link SAMPLE_DXF_TEXT} — minimal AutoCAD R2000 ASCII DXF: HEADER (with
 *   $INSUNITS=4 / millimeters), TABLES with two layers ("0", "DIMENSIONS"),
 *   and ENTITIES with a square, circle, and TEXT.
 *
 * Both fixtures are intentionally tiny so they don't bloat the bundle (the PDF
 * is base64-inlined and the DXF is plain UTF-8 text).
 */

/**
 * Minimal valid PDF (1 page, Letter @ 72dpi) containing the Latin text
 * "Sample Drawing - Dongkuk CM" rendered with the built-in Helvetica font.
 *
 * We deliberately use ASCII-only text — a full Type-1 font dictionary supports
 * Latin1 glyphs, and embedding a CJK font would balloon this fixture by
 * orders of magnitude. The Korean sample text is reserved for the DXF fixture
 * (which carries TEXT entities, not glyphs).
 */
const SAMPLE_PDF_BYTES = buildSamplePdfBytes();

/** PDF data URL for direct loading via PDF.js getDocument({ data }). */
export const SAMPLE_PDF_DATA_URL =
  'data:application/pdf;base64,' + base64Encode(SAMPLE_PDF_BYTES);

/** Raw Uint8Array — preferred for PDF.js getDocument({ data }). */
export function getSamplePdfBytes(): Uint8Array {
  // Return a copy so callers can't mutate the shared buffer.
  return SAMPLE_PDF_BYTES.slice();
}

/**
 * Hand-crafted minimal DXF (R2000 / AC1015 ASCII).
 *
 * Layout:
 *   - HEADER: $INSUNITS=4 (mm), $ACADVER=AC1015
 *   - TABLES: VPORT, LTYPE (CONTINUOUS), LAYER table with 2 layers:
 *       "0" (color 7 / white)
 *       "DIMENSIONS" (color 1 / red)
 *     STYLE (Standard).
 *   - BLOCKS: empty *Model_Space and *Paper_Space.
 *   - ENTITIES:
 *       LINE × 4 (a 200×100 rectangle on layer "0")
 *       CIRCLE (r=40 at (100,50) on layer "0")
 *       TEXT "Sample Drawing" on layer "DIMENSIONS"
 *       LINE on layer "DIMENSIONS" (a dim leader)
 *
 * NOTE: dxf-viewer is fairly tolerant — this fixture is the smallest set we've
 * found that exercises the layer panel + entity rendering reliably.
 */
export const SAMPLE_DXF_TEXT = buildSampleDxf();

/** UTF-8 bytes of the sample DXF. */
export function getSampleDxfBytes(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_DXF_TEXT);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Construct the bytes of a tiny valid PDF.
 *
 * We build with a writer that tracks byte offsets so we can lay out the xref
 * table correctly — PDF requires byte-accurate offsets for each indirect
 * object.
 */
function buildSamplePdfBytes(): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  function push(s: string) {
    const bytes = enc.encode(s);
    chunks.push(bytes);
    cursor += bytes.length;
  }
  function writeObj(num: number, body: string) {
    offsets[num] = cursor;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  }

  // Header — binary marker comment encourages tools to treat as binary.
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1: Catalog
  writeObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

  // 2: Pages
  writeObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');

  // 4: Font (Helvetica, built-in)
  // Defined before the page so the page can reference it by indirect.
  // (Order of definition doesn't matter to PDF; only xref offsets matter.)
  // Writing 4 first means we declare it for clarity below.

  // 3: Page (Letter: 612 × 792)
  writeObj(
    3,
    [
      '<< /Type /Page',
      '   /Parent 2 0 R',
      '   /MediaBox [0 0 612 792]',
      '   /Contents 5 0 R',
      '   /Resources << /Font << /F1 4 0 R >> >>',
      '>>',
    ].join('\n'),
  );

  // 4: Font dictionary
  writeObj(
    4,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );

  // 5: Content stream
  // Two text lines centered roughly on the page; lower line uses a smaller font.
  const content = [
    'BT',
    '/F1 24 Tf',
    '120 600 Td',
    '(Sample Drawing - Dongkuk CM) Tj',
    '0 -40 Td',
    '/F1 12 Tf',
    '(Dev fixture - real conversion pipeline pending) Tj',
    '0 -240 Td',
    '/F1 10 Tf',
    '(This page is rendered by PDF.js as a fallback when the API returns 404.) Tj',
    'ET',
    // Draw a frame to make zoom visually obvious.
    '0.5 w',
    '60 60 492 672 re',
    'S',
  ].join('\n');
  const contentBytes = enc.encode(content);
  writeObj(
    5,
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
  );

  // xref table
  const xrefOffset = cursor;
  // 6 entries: 0 (free) + 5 used.
  let xref = 'xref\n0 6\n';
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);

  // Trailer
  push(
    [
      'trailer',
      '<< /Size 6 /Root 1 0 R >>',
      'startxref',
      String(xrefOffset),
      '%%EOF',
      '',
    ].join('\n'),
  );

  // Concat
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    // chunk to avoid call-stack blowups on large arrays (this fixture is small,
    // but cheap insurance).
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
      );
    }
    return btoa(bin);
  }
  // SSR path — Buffer is available in Node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return B.from(bytes).toString('base64');
  throw new Error('No base64 encoder available');
}

function buildSampleDxf(): string {
  // DXF group code/value pairs are line-based: every value is on its own line.
  // We define a small DSL that just joins pairs with newlines.
  const lines: string[] = [];
  const p = (code: number | string, value: string | number) => {
    lines.push(String(code));
    lines.push(String(value));
  };

  // ── HEADER ────────────────────────────────────────────────────────────
  p(0, 'SECTION');
  p(2, 'HEADER');
  p(9, '$ACADVER');
  p(1, 'AC1015'); // R2000
  p(9, '$INSUNITS');
  p(70, 4); // millimeters
  p(9, '$EXTMIN');
  p(10, 0);
  p(20, 0);
  p(30, 0);
  p(9, '$EXTMAX');
  p(10, 200);
  p(20, 100);
  p(30, 0);
  p(0, 'ENDSEC');

  // ── TABLES ────────────────────────────────────────────────────────────
  p(0, 'SECTION');
  p(2, 'TABLES');

  // VPORT
  p(0, 'TABLE');
  p(2, 'VPORT');
  p(70, 1);
  p(0, 'VPORT');
  p(2, '*Active');
  p(70, 0);
  p(10, 0);
  p(20, 0);
  p(11, 1);
  p(21, 1);
  p(12, 100);
  p(22, 50);
  p(13, 0);
  p(23, 0);
  p(14, 10);
  p(24, 10);
  p(15, 10);
  p(25, 10);
  p(16, 0);
  p(26, 0);
  p(36, 1);
  p(17, 0);
  p(27, 0);
  p(37, 0);
  p(40, 200);
  p(41, 1.5);
  p(42, 50);
  p(43, 0);
  p(44, 0);
  p(50, 0);
  p(51, 0);
  p(71, 0);
  p(72, 100);
  p(73, 1);
  p(74, 3);
  p(75, 0);
  p(76, 0);
  p(77, 0);
  p(78, 0);
  p(0, 'ENDTAB');

  // LTYPE
  p(0, 'TABLE');
  p(2, 'LTYPE');
  p(70, 1);
  p(0, 'LTYPE');
  p(2, 'CONTINUOUS');
  p(70, 0);
  p(3, 'Solid line');
  p(72, 65);
  p(73, 0);
  p(40, 0);
  p(0, 'ENDTAB');

  // LAYER table — two layers
  p(0, 'TABLE');
  p(2, 'LAYER');
  p(70, 2);

  p(0, 'LAYER');
  p(2, '0');
  p(70, 0);
  p(62, 7); // white
  p(6, 'CONTINUOUS');

  p(0, 'LAYER');
  p(2, 'DIMENSIONS');
  p(70, 0);
  p(62, 1); // red
  p(6, 'CONTINUOUS');

  p(0, 'ENDTAB');

  // STYLE
  p(0, 'TABLE');
  p(2, 'STYLE');
  p(70, 1);
  p(0, 'STYLE');
  p(2, 'Standard');
  p(70, 0);
  p(40, 0);
  p(41, 1);
  p(50, 0);
  p(71, 0);
  p(42, 2.5);
  p(3, 'arial.ttf');
  p(4, '');
  p(0, 'ENDTAB');

  p(0, 'ENDSEC');

  // ── BLOCKS (minimum: model_space + paper_space) ───────────────────────
  p(0, 'SECTION');
  p(2, 'BLOCKS');
  p(0, 'BLOCK');
  p(8, '0');
  p(2, '*Model_Space');
  p(70, 0);
  p(10, 0);
  p(20, 0);
  p(30, 0);
  p(3, '*Model_Space');
  p(1, '');
  p(0, 'ENDBLK');
  p(8, '0');
  p(0, 'BLOCK');
  p(67, 1);
  p(8, '0');
  p(2, '*Paper_Space');
  p(70, 0);
  p(10, 0);
  p(20, 0);
  p(30, 0);
  p(3, '*Paper_Space');
  p(1, '');
  p(0, 'ENDBLK');
  p(8, '0');
  p(0, 'ENDSEC');

  // ── ENTITIES ──────────────────────────────────────────────────────────
  p(0, 'SECTION');
  p(2, 'ENTITIES');

  // Rectangle 200×100 on layer 0 (4 lines)
  const rect: Array<[number, number, number, number]> = [
    [0, 0, 200, 0],
    [200, 0, 200, 100],
    [200, 100, 0, 100],
    [0, 100, 0, 0],
  ];
  for (const [x1, y1, x2, y2] of rect) {
    p(0, 'LINE');
    p(8, '0');
    p(10, x1);
    p(20, y1);
    p(30, 0);
    p(11, x2);
    p(21, y2);
    p(31, 0);
  }

  // Circle r=40 at (100,50) on layer 0
  p(0, 'CIRCLE');
  p(8, '0');
  p(10, 100);
  p(20, 50);
  p(30, 0);
  p(40, 40);

  // TEXT "Sample Drawing" on layer DIMENSIONS, positioned below rectangle
  p(0, 'TEXT');
  p(8, 'DIMENSIONS');
  p(10, 10);
  p(20, -15);
  p(30, 0);
  p(40, 8); // text height
  p(1, 'Sample Drawing');
  p(7, 'Standard');

  // Dimension leader line on DIMENSIONS layer
  p(0, 'LINE');
  p(8, 'DIMENSIONS');
  p(10, 0);
  p(20, -8);
  p(30, 0);
  p(11, 200);
  p(21, -8);
  p(31, 0);

  p(0, 'ENDSEC');
  p(0, 'EOF');

  return lines.join('\n') + '\n';
}
