/**
 * Phase F — sidecar path resolution tests.
 *
 * Production bug (2026-05-12): the sidecar landed at
 * `<session-key>.jsonl.kasett-meta.jsonl` (where the session-key is
 * `agent:main:telegram:group:-...:topic:12388`) instead of next to the
 * actual `<uuid>-topic-12388.jsonl` session file. Daily-review and the
 * global index then couldn't find it.
 */
export {};
//# sourceMappingURL=sidecar-path-resolution.test.d.ts.map