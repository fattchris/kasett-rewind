/**
 * Temporal decay weighting for compaction summaries.
 *
 * Weights govern how much each previous compaction summary influences
 * the new summary. Higher weight = more influence. Lower weight = older
 * context that should only be retained if still relevant.
 *
 * Example: weights [1.0, 0.6, 0.3] applied to the last 3 summaries means:
 *   - Most recent summary: 100% influence (reference heavily)
 *   - Previous summary: 60% influence (retain still-relevant threads)
 *   - Oldest summary: 30% influence (background context only)
 */
/**
 * Pair previous compaction summaries with their temporal decay weights.
 *
 * @param summaries - Previous summaries, most recent FIRST
 * @param weights - Weight per slot, most recent first (e.g. [1.0, 0.6, 0.3])
 * @returns Array of WeightedSummary objects, most recent first
 */
export function weightSummaries(summaries, weights) {
    if (summaries.length === 0)
        return [];
    return summaries.slice(0, weights.length).map((summary, i) => {
        const weight = weights[i] ?? 0;
        const label = i === 0
            ? `Previous summary (weight ${weight} — most recent)`
            : `Earlier summary (weight ${weight}${i === summaries.length - 1 && summaries.length > 1 ? ' — oldest context' : ''})`;
        return { summary, weight, label };
    });
}
import { matchAllThreads } from './identity.js';
/**
 * Classify sub-threads across a window of v2 metas using exact id matching.
 *
 * @param metas - Most-recent-first array of v2 metas (length 2-N)
 * @returns Per-thread classification
 */
export function classifyThreadsV2(metas) {
    if (metas.length === 0)
        return [];
    // Build per-thread appearance map
    const appearancesById = new Map();
    for (let i = 0; i < metas.length; i++) {
        for (const sub of metas[i].sub) {
            const existing = appearancesById.get(sub.id);
            if (existing) {
                existing.appearances += 1;
            }
            else {
                appearancesById.set(sub.id, {
                    label: sub.label,
                    appearances: 1,
                    firstSlot: i,
                    latestStatus: sub.status,
                });
            }
        }
    }
    const threshold = Math.max(2, Math.ceil(metas.length / 2));
    const result = [];
    for (const [id, info] of appearancesById) {
        let classification;
        const inMostRecent = metas[0].sub.some((s) => s.id === id);
        if (info.appearances >= threshold && inMostRecent) {
            classification = 'core';
        }
        else if (info.firstSlot === 0 && info.appearances === 1) {
            classification = 'fresh';
        }
        else {
            classification = 'fading';
        }
        result.push({
            id,
            label: info.label,
            classification,
            appearances: info.appearances,
            latestStatus: info.latestStatus,
        });
    }
    return result;
}
/**
 * Classify sub-threads via substring matching on labels (v1 fallback path).
 *
 * Match rule: two labels A and B count as the same thread iff one contains
 * the other as a substring AND the shared length is ≥ 50% of the shorter.
 * This is the fuzzy heuristic from the strategic analysis — brittle, but
 * the best we can do without `id`s.
 *
 * @param metasAsLabels - Most-recent-first array of sub-thread label arrays
 * @returns Per-thread classification (id is the canonical label from the
 *          most recent appearance)
 */
export function classifyThreadsV1Fallback(metasAsLabels) {
    if (metasAsLabels.length === 0)
        return [];
    const norm = (s) => s.trim().toLowerCase();
    const isMatch = (a, b) => {
        const A = norm(a);
        const B = norm(b);
        if (!A || !B)
            return false;
        if (A === B)
            return true;
        const shorter = A.length < B.length ? A : B;
        const longer = A.length < B.length ? B : A;
        if (!longer.includes(shorter))
            return false;
        return shorter.length >= Math.ceil(longer.length / 2);
    };
    // Walk most-recent first, assigning each thread to a canonical id (the
    // label as first seen). Any subsequent label that matches is folded in.
    const canonical = [];
    for (let i = 0; i < metasAsLabels.length; i++) {
        for (const label of metasAsLabels[i]) {
            const trimmed = label.trim();
            if (!trimmed || trimmed.toLowerCase() === 'idle')
                continue;
            const existing = canonical.find((c) => isMatch(c.id, trimmed));
            if (existing) {
                existing.appearances += 1;
            }
            else {
                canonical.push({ id: trimmed, appearances: 1, firstSlot: i });
            }
        }
    }
    const threshold = Math.max(2, Math.ceil(metasAsLabels.length / 2));
    return canonical.map((c) => {
        let classification;
        const inMostRecent = metasAsLabels[0].some((l) => isMatch(c.id, l));
        if (c.appearances >= threshold && inMostRecent) {
            classification = 'core';
        }
        else if (c.firstSlot === 0 && c.appearances === 1) {
            classification = 'fresh';
        }
        else {
            classification = 'fading';
        }
        return {
            id: c.id,
            label: c.id,
            classification,
            appearances: c.appearances,
        };
    });
}
/**
 * Classify key state across a window of v3 metas using exact (kind, value)
 * matching.
 *
 * @param metas — Most-recent-first array of v3 metas (length 2-N). Entries
 *                 without `key_state` are treated as having no key state.
 * @returns Per-value classification
 */
export function classifyKeyState(metas) {
    if (metas.length === 0)
        return [];
    const appearances = new Map();
    for (let i = 0; i < metas.length; i++) {
        const ks = metas[i].key_state ?? [];
        for (const e of ks) {
            const key = `${e.kind}\x00${e.value}`;
            const existing = appearances.get(key);
            if (existing) {
                existing.appearances += 1;
                // Keep the most-recent label (slot 0 is most recent so first-seen wins)
                if (existing.label === undefined && e.label)
                    existing.label = e.label;
            }
            else {
                appearances.set(key, {
                    kind: e.kind,
                    value: e.value,
                    ...(e.label ? { label: e.label } : {}),
                    appearances: 1,
                    firstSlot: i,
                });
            }
        }
    }
    const threshold = Math.max(2, Math.ceil(metas.length / 2));
    const result = [];
    const mostRecent = metas[0].key_state ?? [];
    const inMostRecent = (kind, value) => mostRecent.some((e) => e.kind === kind && e.value === value);
    for (const info of appearances.values()) {
        let classification;
        if (info.appearances >= threshold &&
            inMostRecent(info.kind, info.value)) {
            classification = 'core';
        }
        else if (info.firstSlot === 0 && info.appearances === 1) {
            classification = 'fresh';
        }
        else {
            classification = 'fading';
        }
        result.push({
            kind: info.kind,
            value: info.value,
            ...(info.label ? { label: info.label } : {}),
            classification,
            appearances: info.appearances,
        });
    }
    return result;
}
/**
 * Convenience: from an array of classified key state, return only the
 * entries to actively encourage carry-forward ("core" + still-relevant
 * "fresh"). Used by the steering builder when picking what to surface
 * as `previousKeyState` hints.
 */
export function pickContinuityKeyState(classified) {
    return classified
        .filter((c) => c.classification === 'core' || c.classification === 'fresh')
        .map((c) => {
        const out = { kind: c.kind, value: c.value };
        if (c.label)
            out.label = c.label;
        return out;
    });
}
/**
 * Multi-tier-matched continuity classification across a window of v2 metas.
 *
 * Walks the window oldest-first, building a canonical ID timeline:
 *   - At each step, match the meta's threads against the previous step
 *     using identity.matchAllThreads.
 *   - Carry forward the canonical ID (oldest known ID for the chain).
 *   - When the matcher reports `merged`, attach mergedFrom on the canonical.
 *
 * Then collapse to a per-canonical record and apply the same core/fresh/
 * fading thresholds as classifyThreadsV2, with two extra rules:
 *   - If the most recent meta's thread renamed from an earlier label →
 *     classification = 'renamed' (instead of 'core' / 'fresh' — rename is
 *     more informative)
 *   - If the most recent meta's thread is the merge target of ≥2 previous
 *     canonicals → classification = 'merged'
 *
 * @param metas - Most-recent-first array of v2 metas.
 */
export function classifyThreadsWithIdentity(metas, options = {}) {
    if (metas.length === 0)
        return [];
    // Walk OLDEST first so canonical IDs anchor on oldest occurrence.
    const oldestFirst = [...metas].reverse();
    const trackers = new Map();
    // Map from "id-as-seen-at-slot-i" to canonicalId, so subsequent slots
    // can fold matches into the same canonical.
    const idToCanonical = new Map();
    // Slot 0 (oldest): seed canonicals from the first meta.
    const firstSubs = oldestFirst[0]?.sub ?? [];
    for (const s of firstSubs) {
        trackers.set(s.id, {
            canonicalId: s.id,
            label: s.label,
            appearances: 1,
            lastSlot: 0,
            firstSlot: 0,
            latestStatus: s.status,
        });
        idToCanonical.set(s.id, s.id);
    }
    for (let slot = 1; slot < oldestFirst.length; slot++) {
        const prev = oldestFirst[slot - 1];
        const cur = oldestFirst[slot];
        const matches = matchAllThreads(cur.sub, prev.sub, options);
        // For each current thread, find its canonical via the matcher.
        // Track multi-merge: collect previous canonicals matching into this
        // current via the lifecycle.detectLifecycleEvents merged heuristic.
        for (const c of cur.sub) {
            const m = matches.get(c.id) ?? { strategy: 'none', confidence: 0 };
            let canonicalId;
            let renamedFrom;
            const mergedFrom = [];
            if (m.strategy !== 'none' && m.matched_to) {
                canonicalId = idToCanonical.get(m.matched_to);
                if (m.evolved) {
                    const prevSub = prev.sub.find((p) => p.id === m.matched_to);
                    if (prevSub)
                        renamedFrom = prevSub.label;
                }
            }
            // Merge heuristic: any other previous threads whose label is a
            // substring of c.label (or vice versa, ≥4 chars) and whose canonical
            // hasn't yet been forwarded to a current in THIS slot.
            const cLabel = c.label.trim().toLowerCase();
            for (const p of prev.sub) {
                if (m.matched_to && p.id === m.matched_to)
                    continue;
                const pLabel = p.label.trim().toLowerCase();
                if (!pLabel || pLabel === cLabel)
                    continue;
                const shorter = cLabel.length < pLabel.length ? cLabel : pLabel;
                const longer = cLabel.length < pLabel.length ? pLabel : cLabel;
                if (longer.includes(shorter) && shorter.length >= 4) {
                    const otherCanonical = idToCanonical.get(p.id);
                    if (otherCanonical && (!canonicalId || otherCanonical !== canonicalId)) {
                        mergedFrom.push(otherCanonical);
                    }
                }
            }
            if (!canonicalId) {
                // Genuinely new
                canonicalId = c.id;
                trackers.set(canonicalId, {
                    canonicalId,
                    label: c.label,
                    appearances: 1,
                    lastSlot: slot,
                    firstSlot: slot,
                    latestStatus: c.status,
                });
            }
            else {
                const t = trackers.get(canonicalId);
                if (t) {
                    t.appearances += 1;
                    t.lastSlot = slot;
                    t.label = c.label; // newest label wins (display-only)
                    t.latestStatus = c.status;
                    if (renamedFrom)
                        t.renamedFrom = renamedFrom;
                    t.latestIdentity = m;
                }
            }
            // If we detected merges, fold the trackers
            if (mergedFrom.length > 0) {
                const t = trackers.get(canonicalId);
                if (t) {
                    t.mergedFrom = Array.from(new Set([...(t.mergedFrom ?? []), ...mergedFrom]));
                }
            }
            idToCanonical.set(c.id, canonicalId);
        }
    }
    // Build result. classify against newest slot = oldestFirst.length - 1.
    const newestSlot = oldestFirst.length - 1;
    const threshold = options.coreThreshold ?? Math.max(2, Math.ceil(metas.length / 2));
    const result = [];
    for (const t of trackers.values()) {
        let classification;
        const inMostRecent = t.lastSlot === newestSlot;
        if (t.mergedFrom && t.mergedFrom.length > 0 && inMostRecent) {
            classification = 'merged';
        }
        else if (t.renamedFrom && inMostRecent) {
            classification = 'renamed';
        }
        else if (t.appearances >= threshold && inMostRecent) {
            classification = 'core';
        }
        else if (t.firstSlot === newestSlot && t.appearances === 1) {
            classification = 'fresh';
        }
        else {
            classification = 'fading';
        }
        const out = {
            id: t.canonicalId,
            label: t.label,
            classification,
            appearances: t.appearances,
            latestStatus: t.latestStatus,
        };
        if (t.latestIdentity)
            out.identity = t.latestIdentity;
        if (t.mergedFrom && t.mergedFrom.length > 0)
            out.mergedFrom = t.mergedFrom;
        if (t.renamedFrom)
            out.renamedFrom = t.renamedFrom;
        result.push(out);
    }
    return result;
}
//# sourceMappingURL=weight.js.map