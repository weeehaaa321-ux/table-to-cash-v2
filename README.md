# Table to Cash · v2

A clean-architecture rebuild of [`table-to-cash`](../table-to-cash) — same product behavior, restructured codebase.

## What this is

This repo is a **parallel rebuild**, not a fork. The original repo at `E:\table-to-cash` stays untouched and remains the source of truth for production until every slice has been migrated, verified, and cut over here. No code in the original repo will be modified by this work.

## Status

**Phase 0 — Inventory & Scaffolding** *(current)*

- [x] Source repo mapped (see `docs/INVENTORY.md`)
- [x] Target architecture defined (see `docs/ARCHITECTURE.md`)
- [x] Migration tracker initialized (see `docs/MIGRATION-TRACKER.md`)
- [ ] Framework config files mirrored from source
- [ ] Characterization tests captured for first slice
- [ ] First vertical slice migrated and verified

## How to read these docs (in order)

1. **`docs/INVENTORY.md`** — what's in the source repo. The map.
2. **`docs/ARCHITECTURE.md`** — what the target structure is and the rules each layer follows.
3. **`docs/MIGRATION-TRACKER.md`** — the per-feature checklist. Nothing claims "done" until a row is marked verified.

## Migration philosophy

- **Vertical slices, not big-bang.** One feature at a time, end-to-end (domain → application → infrastructure → presentation).
- **Identical behavior or it's broken.** Characterization tests lock in current behavior — including bugs — so any change is detected.
- **Restructure ≠ optimize.** Two separate phases per slice. Restructure to identical behavior, merge. Then optimize, verify identical behavior + perf gain, merge.
- **Preview-deploy every slice.** Never main without a preview env smoke test.
- **No mixed-state in production.** Each slice is either "in source repo" or "in v2 repo" — never both serving the same traffic.

## When this repo replaces the source repo

When `MIGRATION-TRACKER.md` shows every row as ✅ verified AND a parallel-run period of 2+ weeks shows zero behavior delta, this repo's `main` becomes the production deploy. The source repo gets archived, not deleted.
