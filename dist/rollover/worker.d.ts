/**
 * rollover/worker.ts — Background full-summary worker for the cold-start path.
 *
 * Runs after the synchronous stub has already been injected for the current
 * turn. Reads the sibling session, calls the LLM to produce a rich rollover
 * summary, parses out [THREAD_META] if present, and overwrites the rollover
 * sidecar with the rich entry. The NEXT `before_prompt_build` call will pick
 * up the rich version.
 *
 * Failure handling:
 *   - LLM timeout / abort: leave stub in place, write `.rollover.failed.json`
 *     marker so we don't retry storms.
 *   - LLM returns empty: same as timeout.
 *   - Write succeeds: replaces the stub atomically. Detector path on the next
 *     turn reads it; before_prompt_build consumes (renames to .consumed).
 *
 * No locks needed — only this worker writes the rollover sidecar, and the
 * sidecar's atomic rename is the synchronization point.
 */
import { type RolloverSidecarEntry } from './sidecar.js';
import { callLLMForCompaction, messagesToText } from '../index.js';
export interface RolloverWorkerParams {
    /** The current session's JSONL path (where the sidecar will be written) */
    currentSessionFile: string;
    /** The sibling session JSONL we're summarizing */
    siblingFile: string;
    /** Sibling file mtime (epoch ms) at the time the work was scheduled */
    siblingMtimeMs: number;
    /** Maximum number of turns from the sibling to feed the LLM */
    maxSourceTurns: number;
    /** Max time (ms) before giving up. Cancels the LLM call. */
    timeoutMs: number;
    /** Model override (passes through to callLLMForCompaction) */
    compactionModel?: string;
    /** Max output tokens for the LLM call */
    maxTokens: number;
    /** Logger — uses the OC plugin logger surface */
    logger: {
        debug(msg: string): void;
        warn(msg: string): void;
        info(msg: string): void;
    };
    /**
     * Optional: override the LLM function. Tests inject a stub here so we don't
     * make real API calls. When undefined, uses the real callLLMForCompaction.
     */
    callLLM?: typeof callLLMForCompaction;
    /** Optional: AbortSignal for external cancellation. */
    signal?: AbortSignal;
}
export interface RolloverWorkerResult {
    success: boolean;
    reason?: string;
    /** The entry that was written on success */
    entry?: RolloverSidecarEntry;
}
export declare function runRolloverWorker(params: RolloverWorkerParams): Promise<RolloverWorkerResult>;
/**
 * Export for tests so they can verify the steering prompt shape.
 */
export declare const _ROLLOVER_STEERING_PROMPT = "## Rollover Summary Instructions\n\nYou are generating a one-shot \"rollover\" summary for an AI agent that has\njust started a brand-new session for a topic where prior work exists.\n\nYour job: write a clear, dense summary of the prior session's conversation\nso the agent picks up where it left off. The agent will see this once at\nthe start of its first turn and then operate from it.\n\n### Output format\n\n```\n[ROLLOVER_CONTEXT]\n[THREAD_META] main: <one-line description of the dominant thread> | sub: <sub1>; <sub2>; <sub3>\n\n## Where things stand\n<2-4 paragraphs of dense prose covering: what the user was doing, what\ndecisions were made, what was completed, what is still open, what is\nblocked or waiting on external input>\n\n## Open threads / next likely moves\n- <bullet>\n- <bullet>\n- <bullet>\n\n## Key facts / state the agent should remember\n- <bullet>\n- <bullet>\n[/ROLLOVER_CONTEXT]\n```\n\n### Rules\n\n- Write the summary as if briefing a colleague who is replacing you. Be\n  specific. Name files, decisions, people, blockers.\n- The [THREAD_META] line is mandatory. Pick the single dominant theme of\n  the prior session as 'main'. Pick up to three secondary themes as\n  'sub' (semicolon-separated). If fewer than three secondaries exist,\n  pad with 'idle'.\n- Do not invent facts. If something is uncertain in the prior turns, mark\n  it explicitly: e.g. \"unclear whether X was decided\".\n- Skip pure greetings, system noise, and tool chatter. Focus on substance.\n- Keep total length under 1500 words. Brevity over completeness.\n";
export { messagesToText };
//# sourceMappingURL=worker.d.ts.map