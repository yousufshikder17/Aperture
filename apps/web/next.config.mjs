/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@aperture/shared"],
  webpack(config) {
    // Shared packages use NodeNext .js specifiers over TypeScript source.
    // The builder is the first browser consumer of their runtime schemas.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
