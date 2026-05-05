import { randomUUID } from 'node:crypto';
import type { Pattern, PatternCategory, PatternSource } from './types.js';

/**
 * Pattern Extractor — processes session JSONL to extract behavioral patterns.
 * Operates on structural interaction signals, not raw content.
 */
export class PatternExtractor {
  /**
   * Extract patterns from a parsed session transcript.
   */
  extract(turns: SessionTurn[]): Pattern[] {
    const patterns: Pattern[] = [];

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.role !== 'user') continue;

      const response = turns[i + 1];
      if (!response || response.role !== 'assistant') continue;

      // Multi-part detection
      const questionCount = countQuestions(turn.content);
      if (questionCount >= 2) {
        patterns.push(
          this.createPattern(
            'multi_part',
            `User sent ${questionCount} distinct items/questions`,
            response.toolCalls
              ? `Addressed with ${response.toolCalls.length} tool calls + structured response`
              : `Addressed ${questionCount} items in response`,
            allPartsAddressed(turn.content, response.content, questionCount)
              ? 'positive'
              : 'negative',
            isCorrection(turns, i) ? 'correction' : 'organic',
          ),
        );
      }

      // Tool call chain patterns
      if (response.toolCalls && response.toolCalls.length > 0) {
        const chain = response.toolCalls.map((tc) => tc.name).join(' → ');
        patterns.push(
          this.createPattern(
            'tool_call',
            `Task: ${summarizeIntent(turn.content)}`,
            `Chain: ${chain}`,
            response.hadError ? 'negative' : 'positive',
            isCorrection(turns, i) ? 'correction' : 'organic',
          ),
        );
      }

      // Correction recovery
      if (isCorrection(turns, i) && i >= 2) {
        const prevAssistant = turns[i - 1];
        if (prevAssistant?.role === 'assistant') {
          patterns.push(
            this.createPattern(
              'correction_recovery',
              `Correction: ${summarizeIntent(turn.content)}`,
              `Recovery: ${summarizeIntent(response.content)}`,
              'positive',
              'correction',
            ),
          );
        }
      }

      // Disambiguation patterns
      if (isDisambiguation(response.content)) {
        patterns.push(
          this.createPattern(
            'disambiguation',
            `Ambiguous input: ${summarizeIntent(turn.content)}`,
            'Asked for clarification before acting',
            'positive',
            'organic',
          ),
        );
      }
    }

    return deduplicatePatterns(patterns);
  }

  private createPattern(
    category: PatternCategory,
    input: string,
    output: string,
    quality: Pattern['quality'],
    source: PatternSource,
  ): Pattern {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      category,
      input,
      output,
      quality,
      source,
      createdAt: now,
      lastMatchedAt: now,
      matchCount: 1,
    };
  }
}

// --- Session turn type (simplified from full JSONL) ---

export interface SessionTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  toolCalls?: Array<{ name: string; input?: Record<string, unknown> }>;
  hadError?: boolean;
}

// --- Heuristic helpers ---

function countQuestions(text: string): number {
  // Count by: question marks, numbered items, bullet points, or line breaks with distinct topics
  const questionMarks = (text.match(/\?/g) || []).length;
  const numberedItems = (text.match(/^\s*\d+[.)]\s/gm) || []).length;
  const bulletItems = (text.match(/^\s*[-*•]\s/gm) || []).length;

  return Math.max(questionMarks, numberedItems, bulletItems, 1);
}

function allPartsAddressed(
  _input: string,
  _output: string,
  expectedCount: number,
): boolean {
  // Simple heuristic: response has at least as many structural markers as input
  // In production, use more sophisticated analysis
  return expectedCount <= 3; // Assume addressed for small counts
}

function isCorrection(turns: SessionTurn[], currentIdx: number): boolean {
  const content = turns[currentIdx]?.content?.toLowerCase() ?? '';
  const correctionSignals = [
    'no,', 'no ', 'actually', 'i meant', 'not that', 'wrong',
    'that\'s not', 'instead', 'try again', 'redo', 'fix',
  ];
  return correctionSignals.some((s) => content.startsWith(s) || content.includes(` ${s}`));
}

function isDisambiguation(content: string): boolean {
  const signals = [
    'did you mean', 'do you want me to', 'should I',
    'which one', 'a few options', 'to clarify',
  ];
  return signals.some((s) => content.toLowerCase().includes(s));
}

function summarizeIntent(text: string): string {
  // Take first 100 chars, strip to first sentence
  const truncated = text.slice(0, 150);
  const firstSentence = truncated.split(/[.!?\n]/)[0] ?? truncated;
  return firstSentence.trim().slice(0, 100);
}

function deduplicatePatterns(patterns: Pattern[]): Pattern[] {
  const seen = new Map<string, Pattern>();
  for (const p of patterns) {
    const key = `${p.category}:${p.input}:${p.output}`;
    if (!seen.has(key)) {
      seen.set(key, p);
    } else {
      // Increment match count on existing
      const existing = seen.get(key)!;
      existing.matchCount++;
      existing.lastMatchedAt = p.lastMatchedAt;
    }
  }
  return [...seen.values()];
}
