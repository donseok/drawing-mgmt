/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
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
