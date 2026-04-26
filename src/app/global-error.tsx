"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App crash:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ background: "#fff", borderRadius: "16px", border: "2px solid #fecaca", padding: "32px", maxWidth: "400px", width: "100%", textAlign: "center" }}>
            <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <span style={{ fontSize: "24px" }}>⚠</span>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a", marginBottom: "8px" }}>Something went wrong</h2>
            <p style={{ fontSize: "14px", color: "#64748b", marginBottom: "24px" }}>
              Your data is safe. This is a display issue only.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={reset}
                style={{ padding: "12px 24px", borderRadius: "12px", background: "#7c3aed", color: "#fff", fontSize: "14px", fontWeight: 700, border: "none", cursor: "pointer" }}
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{ padding: "12px 24px", borderRadius: "12px", background: "#e2e8f0", color: "#334155", fontSize: "14px", fontWeight: 700, border: "none", cursor: "pointer" }}
              >
                Hard Reload
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
