// Sentry init for the Edge runtime (middleware, edge route handlers).
// Loaded by instrumentation.ts. Edge runtime has limited APIs so this
// is intentionally minimal: no PII scrubber needed (edge requests don't
// carry the same headers we'd want to redact).

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  });
}
