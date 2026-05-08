/** @type {import('next').NextConfig} */

// Content-Security-Policy — defense-in-depth against XSS.
//
// Notes:
//   - 'unsafe-inline' on script-src is unavoidable while Next.js inlines
//     hydration scripts. It dilutes XSS prevention but the policy still
//     blocks loading scripts from untrusted origins.
//   - 'unsafe-eval' is required by Next.js dev tooling and PDF.js.
//   - cdnjs.cloudflare.com is whitelisted for the PDF.js loader. Once we
//     self-host PDF.js this can be dropped.
//   - 'unsafe-inline' on style-src is required because we inline-style most
//     components. Switching to nonces is a follow-up.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options",         value: "DENY" },
  { key: "X-Content-Type-Options",  value: "nosniff" },
  { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",      value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },

  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8001";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
