import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [
      // Old GitHub Pages location of the studio.
      { source: '/negative-studio', destination: '/tools/negative-studio', permanent: true },
      { source: '/negative-studio/index.html', destination: '/tools/negative-studio', permanent: true },
      { source: '/tools', destination: '/tools/negative-studio', permanent: false },
    ];
  },
};

export default nextConfig;
