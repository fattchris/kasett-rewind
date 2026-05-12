/**
 * Phase G — Lifecycle event re-surfacing.
 *
 * Tests that the wiring from sidecar → reader → steering prompt is intact:
 * lifecycle events (renames/merges/splits) detected at compaction N-1 and
 * stored on the sidecar are re-read at compaction N and surfaced in the
 * steering prompt as continuity hints.
 *
 * This proves the production path that `buildCompactionContext` exercises:
 *   1. Worker writes sidecar entry with `lifecycle_events: [...]` at C{N-1}.
 *   2. At C{N}, `SessionReader.readLatestLifecycleEvents(sessionFile)` returns them.
 *   3. They're passed to `buildSteeringPrompt({ recentLifecycle })`.
 *   4. The resulting prompt instructs the LLM to keep IDs stable across the rename.
 *
 * `buildCompactionContext` itself is not directly invoked here (it requires
 * a full PluginAPI mock). The pure-function half of its work \u2014 lifecycle
 * loading and steering \u2014 is what these tests cover; the wiring code in
 * `buildCompactionContext` is a 3-line `try/await/pass-through` whose
 * correctness is enforced by the type system.
 */
export {};
//# sourceMappingURL=index-lifecycle-resurface.test.d.ts.map