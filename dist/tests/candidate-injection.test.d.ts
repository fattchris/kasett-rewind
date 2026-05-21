/**
 * Fix 1 — Candidate injection into key_state generation prompt.
 *
 * Verifies:
 *   1. Detector candidates are rendered into the steering prompt.
 *   2. The instruction language is directive ("MUST include"), not advisory.
 *   3. The cap is 50 (not 30 or unlimited).
 *   4. The count of candidates sent is shown in the section heading.
 *   5. Values that were already shown in the old advisory section are still shown.
 */
export {};
//# sourceMappingURL=candidate-injection.test.d.ts.map