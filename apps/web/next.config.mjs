import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // R32 X-1.a — emit a self-contained `.next/standalone` server so the
  // production Docker image can ship Node + standalone output only,
  // without node_modules or the rest of the monorepo.
  // See: https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: 'standalone',
  // Tell Next where the monorepo root is so file tracing follows pnpm
  // workspace symlinks (apps/web → packages/shared, etc).
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
    serverComponentsExternalPackages: [
      '@prisma/client',
      'bcryptjs',
      'sharp',
      'pdfjs-dist',
      'bullmq',
      'ioredis',
    ],
  },
  webpack: (config) => {
    // pdf.js + dxf-viewer use canvas in Node, but we render only on client
    config.resolve.alias.canvas = false;
    return config;
  },
};
export default nextConfig;
