// Placeholder root page so the framework boots before any slice is migrated.
// Will be replaced when the marketing or guest entry slice is migrated.
export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Table to Cash · v2</h1>
      <p style={{ color: "#666", marginTop: "0.5rem" }}>
        Architectural rebuild in progress. See <code>docs/MIGRATION-TRACKER.md</code>.
      </p>
    </main>
  );
}
