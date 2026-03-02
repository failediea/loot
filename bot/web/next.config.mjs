/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@cartridge/controller-wasm"],
  },
};

export default nextConfig;
