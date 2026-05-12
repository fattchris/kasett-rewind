/**
 * Lenient-truncate behavior for V2/V3 validators.
 *
 * Established 2026-05-12 after Phase 2 benchmark surfaced a production bug:
 * `validateThreadMetaV3` was rejecting entire LLM outputs when the Sonnet
 * 4.5 LLM correctly identified 6-10 concurrent threads on complex sessions
 * and emitted a `sub[]` array longer than the schema cap of 5. The
 * structured payload was lost and the agent fell back to prose-only.
 *
 * The fix:
 *   - `validateThreadMetaV3` defaults to LENIENT \u2014 oversized arrays are
 *     truncated to cap, and a `_truncated_<field>: true` flag is set so
 *     downstream code can log/alert without losing the structured content.
 *   - `validateThreadMetaV3Strict` preserves the prior strict behavior for
 *     callers that want to know about overflow loudly.
 *   - `validateThreadMetaV2` defaults to STRICT (backward compat with the
 *     existing schema.test.ts suite). `validateThreadMetaV2Lenient` and
 *     `validateThreadMetaV2(raw, { mode: 'lenient' })` opt into truncation.
 *
 * Type errors (wrong type, missing required, invalid status enum) remain
 * hard failures in BOTH modes \u2014 lenient is about caps, not safety.
 */
export {};
//# sourceMappingURL=schema-truncate.test.d.ts.map