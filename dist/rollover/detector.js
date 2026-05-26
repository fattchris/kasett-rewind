/**
 * rollover/detector.ts — Decide whether a session triggers the cold-start branch.
 *
 * Gates (all must be true for Tier 3 to fire):
 *   1. coldStart.enabled === true
 *   2. Current session is "cold": has 0 compaction summaries AND
 *      ≤ minTurns user/assistant turns
 *   3. A sibling session JSONL exists for the same topic
 *   4. Sibling mtime is within maxIdleHours of now
 *   5. Sibling has ≥ minTurns turns to actually summarize
 *   6. No prior `.rollover.failed.json` marker (don't retry storms)
 *   7. No active or consumed rollover sidecar already in place
 *
 * Pure function — no side effects, no file mutations. Returns a verdict
 * object that the caller wires into `before_prompt_build`.
 */
import { basename, dirname } from 'node:path';
import { stat } from 'node:fs/promises';
import { SessionReader } from '../storage/reader.js';
import { rolloverHasFailed, rolloverWasConsumed, rolloverPending, } from './sidecar.js';
export async function detectRolloverOpportunity(params) {
    const { config, currentSessionFile, topicId, findSibling } = params;
    if (!config.enabled) {
        return { fire: false, reason: 'disabled' };
    }
    // Marker checks: cheap, do them first.
    if (rolloverHasFailed(currentSessionFile)) {
        return { fire: false, reason: 'previously_failed' };
    }
    if (rolloverPending(currentSessionFile)) {
        return { fire: false, reason: 'sidecar_pending' };
    }
    if (rolloverWasConsumed(currentSessionFile)) {
        return { fire: false, reason: 'already_consumed' };
    }
    const reader = new SessionReader();
    // Gate 2a: current session must have 0 compaction summaries
    const currentSummaries = await reader.readLastNSummaries(currentSessionFile, 1);
    if (currentSummaries.length > 0) {
        return { fire: false, reason: 'current_has_summaries' };
    }
    // Gate 2b: current session must have ≤ minTurns turns
    // Read up to minTurns+1 — if more than minTurns, bail.
    const currentTurns = await reader.readRawTurns(currentSessionFile, config.minTurns + 1);
    if (currentTurns.length > config.minTurns) {
        return { fire: false, reason: 'current_too_warm' };
    }
    // Gate 3: find sibling
    const sessionsDir = dirname(currentSessionFile);
    const currentFilename = basename(currentSessionFile);
    const siblingFile = await findSibling(sessionsDir, currentFilename, topicId);
    if (!siblingFile) {
        return { fire: false, reason: 'no_sibling' };
    }
    // Gate 4: sibling mtime within maxIdleHours
    let siblingMtimeMs;
    try {
        const s = await stat(siblingFile);
        siblingMtimeMs = s.mtimeMs;
    }
    catch {
        return { fire: false, reason: 'sibling_stat_failed' };
    }
    const maxIdleMs = config.maxIdleHours * 3600 * 1000;
    if (Date.now() - siblingMtimeMs > maxIdleMs) {
        return { fire: false, reason: 'sibling_too_stale' };
    }
    // Gate 5: sibling must have enough content. Read all turns (capped) and
    // require ≥ minTurns. We don't aggressively cap here — the worker will cap
    // at maxSourceTurns when it actually summarizes.
    const siblingTurns = await reader.readRawTurns(siblingFile, 0);
    if (siblingTurns.length < config.minTurns) {
        return { fire: false, reason: 'sibling_too_thin' };
    }
    return {
        fire: true,
        siblingFile,
        siblingMtimeMs,
        siblingTurnCount: siblingTurns.length,
        currentTurnCount: currentTurns.length,
    };
}
//# sourceMappingURL=detector.js.map