import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  // Performance: sample 20% of transactions
  tracesSampleRate: 0.2,

  // Session replay: capture 10% of sessions, 100% on error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration(),
  ],

  // Don't send PII
  sendDefaultPii: false,

  // Filter noisy errors
  ignoreErrors: [
    "ResizeObserver loop",
    "AbortError",
    "Load failed",
    "Failed to fetch",
    "NetworkError",
  ],
});
