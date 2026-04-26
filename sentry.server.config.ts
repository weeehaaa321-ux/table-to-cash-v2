import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  enabled: process.env.NODE_ENV === "production",

  // Performance: sample 20% of server transactions
  tracesSampleRate: 0.2,

  sendDefaultPii: false,
});
