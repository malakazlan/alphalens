// Sentry init for the Node.js server runtime (Next.js API routes,
// server actions, server components). Loaded by instrumentation.ts.
//
// Silent no-op when NEXT_PUBLIC_SENTRY_DSN is unset.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    beforeSend: scrubPii,
  });
}

function scrubPii(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  try {
    const sensitive = new Set([
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
    ]);
    const headers = event.request?.headers as
      | Record<string, string>
      | Array<[string, string]>
      | undefined;

    if (Array.isArray(headers)) {
      for (const item of headers) {
        if (
          Array.isArray(item) &&
          item.length === 2 &&
          sensitive.has(String(item[0]).toLowerCase())
        ) {
          item[1] = "[REDACTED]";
        }
      }
    } else if (headers && typeof headers === "object") {
      for (const key of Object.keys(headers)) {
        if (sensitive.has(key.toLowerCase())) {
          (headers as Record<string, string>)[key] = "[REDACTED]";
        }
      }
    }

    if (event.request) {
      delete (event.request as Record<string, unknown>).cookies;
    }
  } catch {}
  return event;
}
