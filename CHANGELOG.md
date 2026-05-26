# Changelog

## [0.3.0] — 2026-05-26

### Added — Cold-start / session-rollover bridge

When a brand-new OC session is created for a `sessionKey` that has prior
session JSONLs on disk but no compaction summaries to inherit from (e.g.
a topic was active for fewer than the compaction threshold of turns, then
sat idle, then OC made a fresh sessionId on reawaken), kasett now produces
a one-shot rollover summary from the prior session's raw turns instead of
letting the new session cold-start with zero context.

This closes the gap observed in production on 2026-05-24 where topic-35868
had ~8 hours of light activity (compactionCount=0), 41h idle, then a fresh
session came up empty even though kasett-rewind's hot-swap fix (9313a34)
was already running.

**How it works** — A new "Tier 3" path in `before_prompt_build`:

1. **Detector** (`src/rollover/detector.ts`) — fires only when the current
   session has 0 compactions AND ≤ minTurns user/assistant turns AND a
   sibling session exists with raw turns AND mtime within maxIdleHours.
2. **Stub** (`src/rollover/stub.ts`) — synchronous, no LLM. Quotes the
   last user + last assistant turn from the sibling and tells the agent a
   richer summary is loading. Returns in milliseconds. Injected via
   `prependContext` on the first turn.
3. **Worker** (`src/rollover/worker.ts`) — background. Runs the full LLM
   summarization against the sibling's tail (capped at maxSourceTurns).
   Overwrites the sidecar with a rich rollover entry that includes a
   `[THREAD_META]` line.
4. **Sidecar** (`src/rollover/sidecar.ts`) — `<session>.rollover.json`
   holds the entry between turns. The next `before_prompt_build` reads
   the rich version, injects it, and renames the file to
   `.rollover.consumed.json`. One-shot, no re-injection cost on later turns.

**Failure handling** — LLM timeout, empty response, or throw → writes
`.rollover.failed.json` to prevent retry storms. Stub remains in place.

**Config** — New `coldStart` block in plugin config. Defaults are
production-ready:

```json
{
  "coldStart": {
    "enabled": true,
    "minTurns": 2,
    "maxIdleHours": 168,
    "hotSwap": true,
    "hotSwapTimeoutMs": 30000,
    "maxSourceTurns": 200
  }
}
```

Set `enabled: false` to disable the entire Tier 3 path. Reversible by
config only — no on-disk schema changes.

**New exported symbols** (for plugin composition / debugging):

- `callLLMForCompaction` — promoted to public export. Reused by the
  rollover worker for the LLM call (single source of truth per Rule 4).
- `messagesToText`, `extractTextContent` — promoted to public exports.
  Reused by `rollover/stub.ts` and `rollover/worker.ts`.

**Tests** — 26 new tests across detector, stub, sidecar, worker, and the
new `SessionReader.readRawTurns` method. All 513 tests pass.

**Spec** — `research/specs/session-rollover-bridge.md` is the authoring
spec. Read it before extending.

## [0.2.2] — 2026-05-08

### Fixed

**Portable build script** (Issue 1 — critical for clean installs on non-dev machines)

The `build`, `dev`, and `lint` scripts in `package.json` contained a hardcoded absolute path
(`/usr/lib/node_modules/@tobilu/qmd/node_modules/typescript/bin/tsc`) that only existed on the
original author's machine. Clean installs on other machines (reported by Zero on macOS) silently
failed because the path does not exist.

**What changed:**

- `package.json` — All three scripts now use `npx tsc` which resolves TypeScript from the local
  `devDependencies` on every machine, regardless of global install state:
  - `build`: `npx tsc && cp -r src/tests/fixtures dist/tests/`
  - `dev`: `npx tsc --watch`
  - `lint`: `npx tsc --noEmit`

**Clarified `OPENROUTER_API_KEY` must be a raw provider key** (Issue 3 — OC 5.x compatibility)

Zero reported confusion on OC 5.x where agents use internal model references
(`openrouter-<agent>/model`). Kasett calls the LLM **directly** using the raw API key —
it does not go through OC's model router. Using an OC model alias causes silent fallback
to OC's built-in summarizer (thread tracking disabled, no obvious error).

**What changed:**

- `README.md` — "Load the Tape" section now has an explicit ⚠️ OC 5.x callout explaining:
  - The key must be a raw provider key (`sk-or-v1-...` or `sk-ant-...`)
  - OC internal model aliases will NOT work
  - Key goes in `openclaw.json` → `env` block (not in plugin or agent config)
  - Correct vs. incorrect example block added

**Verified provider activation docs** (Issue 2 — documentation audit)

Confirmed 0.2.1 fix is present: `agents.defaults.compaction.provider` activation step
is clearly called out in README installation flow and generate-config CLI output.
No changes needed — documenting as verified.

**Build verified on clean install** (Issue 4 — type errors under clean install)

`tsconfig.json` already has `"skipLibCheck": true` and `@types/node` is in `devDependencies`.
Type errors reported by Zero were caused by the hardcoded build script (Issue 1) skipping
local `devDependencies`. After fixing to `npx tsc`, a clean-install build succeeds with zero
type errors. No `tsconfig.json` changes were needed.

---

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
