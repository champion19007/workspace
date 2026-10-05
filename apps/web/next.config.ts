import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@workspace/core', '@workspace/adapters', '@workspace/db', 'postgres'],
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
};

export default nextConfig;
