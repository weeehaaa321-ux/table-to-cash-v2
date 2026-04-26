"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page crash:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-dvh bg-sand-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border-2 border-status-bad-200 p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-status-bad-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⚠</span>
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">Something went wrong</h2>
        <p className="text-sm text-text-secondary mb-6">
          Your data is safe — this is a display issue only.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-xl bg-status-wait-600 text-white text-sm font-bold active:scale-95 transition-transform"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-xl bg-sand-200 text-text-secondary text-sm font-bold active:scale-95 transition-transform"
          >
            Hard Reload
          </button>
        </div>
      </div>
    </div>
  );
}
