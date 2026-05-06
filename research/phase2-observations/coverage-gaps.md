
### 2026-05-05 — 6 session(s) fell through to vanilla

### 2026-05-06 — First live kasett compaction data reviewed

**Critical finding: Hot-swap stub never replaced.**

Both compactions kasett handled (topic-5392 Infra session and a subagent) produced `[KASETT_STUB]` entries that were never atomically rewritten with full summaries. The background LLM job appears to fail silently — stubs become permanent, leaving garbage thread labels as orientation context.

**Thread label quality problem.**

Thread labels extracted in both stub cases were raw tool output fragments rather than agent-synthesized descriptions:
- Session 1: `main: total 8 drwxr-xr-x` (ls output)
- Session 2: `main: Now let me find the config write section...` (truncated tool invocation)

The synthetic Phase 1 benchmarks didn't catch this because they used clean conversation fixtures. Real sessions have tool output mid-context at compaction time.

**Vanilla OC also had a catastrophic compaction on May 5.**

Compaction 4 on topic-20751 (15:09 UTC) produced raw binary/base64 content as the summary — complete context loss. Not a kasett failure but worth noting; kasett should be more robust than this, not equivalent or worse.

**Pattern:** Kasett's hot-swap design has a gap between theory and live behavior. The stub-return path works; the background-rewrite path has never been confirmed to complete successfully in production.
