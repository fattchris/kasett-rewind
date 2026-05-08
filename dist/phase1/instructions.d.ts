import type { KasettConfig } from '../types.js';
/**
 * Error class for kasett-rewind operations.
 */
export declare class KasettError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Generates the `compaction.customInstructions` string for OpenClaw.
 * This string is injected into OC's existing summarization prompt to
 * enforce structured output with thread tracking.
 *
 * @param config - The kasett-rewind configuration
 * @returns The full instruction string for injection
 */
export declare function generateCustomInstructions(config: KasettConfig): string;
//# sourceMappingURL=instructions.d.ts.map