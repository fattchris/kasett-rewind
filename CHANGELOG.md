# Changelog

## [0.2.1] — 2026-05-08

### Fixed

**Documentation: provider activation slot clarified** (critical — caused gateway respawn loops)

The README and `generate-config` CLI previously omitted the second required step to activate
kasett as the compaction provider. Enabling the plugin in `plugins.entries` loads the code, but
OpenClaw does **not** route compaction through it unless you also set the provider slot in
`agents.defaults.compaction`.

The missing step caused at least one agent (Zero) to mis-configure their gateway by setting
`agents.list[].compaction` — which is not a valid schema slot — resulting in OC rejecting the
entire config and the gateway entering a respawn loop.

**What changed:**

- `README.md` — Installation section now has an explicit "activate the provider" step with both
  CLI and JSON examples, plus a ⚠️ callout warning not to use `agents.list[].compaction`
- `src/cli/generate-config.ts` — CLI output now shows two labeled sections:
  - Step 1: the `plugins.entries.kasett-rewind` block (unchanged)
  - Step 2: the `agents.defaults.compaction` block to activate the provider, with the ⚠️ warning

**If you're running 0.2.0:** Pull and rebuild, then run `kasett-rewind generate-config` to see
the correct two-step output. If you haven't set `agents.defaults.compaction.provider` yet,
the plugin is loaded but not active — OC is still using its built-in summarizer.

```bash
# Verify / activate
openclaw config set agents.defaults.compaction.provider "kasett-rewind"
openclaw config set agents.defaults.compaction.mode "safeguard"
openclaw gateway restart
```

---

## [0.2.0] — 2026-05-07

- Full CompactionProvider implementation (Phase 2)
- HotSwap zero-delay stub with background worker
- Rolling window with configurable weights
- Thread evolution validation
- Structured thread snapshot format

## [0.1.0] — 2026-04-xx

- Initial release: hook-based instruction injection (Phase 1)
- Thread tracking and validation (warnings only)
- Zero-dependency implementation
