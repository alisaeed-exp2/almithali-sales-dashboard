/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  // Locales are always prefixed (/en, /ar); the bare root opens English.
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};
export default nextConfig;
