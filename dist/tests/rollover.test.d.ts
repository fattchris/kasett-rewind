/**
 * Tests for the cold-start session-rollover bridge.
 *
 * Covers:
 *   1. Detector: cold session + sibling with raw turns → fire
 *   2. Detector: cold session + sibling with compactions only → fire is still
 *      true at the detector layer (caller decides whether Tier 2 already
 *      handled it). The detector only checks raw-turn count.
 *   3. Detector: current session too warm → skip
 *   4. Detector: sibling too old → skip
 *   5. Detector: sibling too thin → skip
 *   6. Detector: no sibling → skip
 *   7. Detector: disabled via config → skip
 *   8. Detector: previously failed marker present → skip
 *   9. Detector: pending sidecar present → skip
 *  10. Detector: consumed marker present → skip
 *  11. Stub builder: produces valid entry with last user + last assistant
 *  12. Stub builder: handles empty turns gracefully
 *  13. Sidecar: write + read roundtrip
 *  14. Sidecar: consume renames atomically; second consume is no-op
 *  15. Sidecar: corrupt file returns null on read
 *  16. Worker: empty sibling → marks failed
 *  17. Worker: LLM returns null → marks failed
 *  18. Worker: LLM returns valid summary → writes rich sidecar (non-stub)
 *  19. Worker: timeout aborts and marks failed
 *  20. Reader: readRawTurns returns only user/assistant turns, in order
 *  21. Reader: readRawTurns respects maxTurns cap (tail)
 */
export {};
//# sourceMappingURL=rollover.test.d.ts.map