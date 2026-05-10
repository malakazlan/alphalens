// Sentry init for the browser bundle (Next.js 14+ convention: this exact
// filename is auto-loaded by @sentry/nextjs).
//
// Silent no-op when NEXT_PUBLIC_SENTRY_DSN is unset (local dev).

import * as Sentry from "@sentry/nextjs";

// Capture client-side navigation transitions in the App Router.
// Required export per @sentry/nextjs build-time check.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // Conservative trace sampling — frontend traffic is high volume.
    // Bumping later requires checking Sentry quota usage.
    tracesSampleRate: 0.05,

    // No session replay — PII risk + bundle size. Revisit only if we
    // hit a class of bug that requires it.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Don't auto-attach user IPs / emails / cookies. We rely on
    // Supabase user_id (UUID) for correlation, set explicitly elsewhere.
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

    // Scrub request headers in either array-pair or object form.
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

    // Sentry may capture cookies as a separate field — drop entirely.
    if (event.request) {
      delete (event.request as Record<string, unknown>).cookies;
    }
  } catch {
    // Never let scrubbing failure block the send.
  }
  return event;
}
