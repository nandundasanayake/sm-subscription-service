/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/admin',
  // Export each page as <route>/index.html so a full page load of any route
  // (refresh, bookmark, the 401 redirect below) is served by the backend's
  // static mount — it serves directory indexes, not '/admin/login' -> login.html.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
