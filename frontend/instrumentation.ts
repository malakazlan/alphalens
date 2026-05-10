// Next.js 14 instrumentation hook — runs once at server / edge startup.
// Loads the right Sentry config based on which runtime is booting.
// Client config is auto-loaded by @sentry/nextjs's webpack plugin.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
