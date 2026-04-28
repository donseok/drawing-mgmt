#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const destDir = resolve(root, 'public/pdfjs');
const dest = resolve(destDir, 'pdf.worker.min.mjs');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[pdfjs] copied worker → ${dest}`);
