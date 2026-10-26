import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export', trailingSlash: true, poweredByHeader: false,
  images: { unoptimized: true }, agentRules: false,
};
export default config;
