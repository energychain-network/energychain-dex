/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['lightweight-charts', 'viem'],
  },
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
  async rewrites() {
    return [
      { source: '/api-proxy/:path*', destination: `${process.env.NEXT_PUBLIC_DEX_API_BASE || 'http://localhost:8081'}/api/v1/:path*` },
    ];
  },
};
export default nextConfig;
