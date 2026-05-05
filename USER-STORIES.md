# User Stories — kasett-rewind

## Personas

| Persona | Description |
|---------|-------------|
| **Operator** | Person running an OC agent (personal or for clients). Configures the agent, monitors quality. |
| **End User** | Person interacting with the agent daily. May or may not be the operator. |
| **Agent** | The AI agent itself — the entity that benefits from better memory. |
| **Platform** | Molt AI as a service provider deploying agents at scale. |

---

## Epic 1: Rolling Compaction (Runtime Memory)

### E1.1 — Context Survival

> **As an end user**, I want my agent to remember what we were working on 3 hours ago (even after context was compressed), so that I don't have to re-explain the same context every time the conversation gets long.

**Acceptance criteria:**
- After 2+ compactions, agent can reference work from the first compaction period
- Agent names the task/thread accurately without user prompting
- No "I don't have context on that" for work done in the same session

---

### E1.2 — Thread Accountability

> **As an end user**, I want my agent to never silently forget an active task, so that things I asked it to do don't disappear into the void.

**Acceptance criteria:**
- Every active thread from compaction N appears in compaction N+1 with explicit status
- If a thread is dropped, it's marked completed/blocked/deprioritized — never just gone
- Agent can list "what's still open" at any point and it's accurate

---

### E1.3 — Trajectory Awareness

> **As an end user**, I want my agent to know the direction we're heading (not just where we are), so that it can anticipate next steps and avoid repeating failed approaches.

**Acceptance criteria:**
- Agent doesn't suggest approaches it already tried and that failed
- Agent can articulate "we started at X, moved through Y, and are now at Z"
- Thread history shows completed work, not just current state

---

### E1.4 — Operator Configuration

> **As an operator**, I want to configure how deep the memory window goes (how many compaction summaries are retained), so I can tune the tradeoff between memory depth and available context for new work.

**Acceptance criteria:**
- `windowSize` config: 1 (current behavior) to 5
- `windowBudgetSplit` config: proportional allocation across summaries + recent turns
- Default (windowSize=2, split=[0.3, 0.3, 0.4]) works well out of the box
- windowSize=1 replicates current OC behavior exactly (backward compat)

---

### E1.5 — Zero-Config Phase 1

> **As an operator**, I want to get 80% of the benefit with zero OC code changes, so I can deploy today without waiting for upstream.

**Acceptance criteria:**
- Phase 1 mode uses only `compaction.customInstructions` (existing OC hook)
- Structured thread tracking works via prompt engineering alone
- Plugin provides a CLI command to generate the customInstructions string
- Measurable improvement in thread retention vs. default compaction

---

### E1.6 — Key State Survival

> **As an end user**, I want specific values (URLs, config paths, version numbers, IDs) to survive compaction, so the agent doesn't forget the exact resource we're working with.

**Acceptance criteria:**
- Compaction template has a mandatory "Key State" section
- Specific values called out in conversation are captured as key-value pairs
- Agent can recall exact values (not approximations) after compaction

---

## Epic 2: ALLM (Long-Term Behavioral Learning)

### E2.1 — Learning From Corrections

> **As an end user**, I want my agent to permanently learn from my corrections (not just for this session), so that when I say "no, do it THIS way" it sticks across sessions forever.

**Acceptance criteria:**
- Corrections are extracted as high-priority patterns
- After training cycle, the same mistake doesn't recur
- Correction patterns have 30-day minimum retention (can't be pruned too early)

---

### E2.2 — Evolving With Me

> **As an end user**, I want my agent to adapt as my needs change (not stay stuck on what I needed 3 months ago), so that the agent stays relevant as my workflow evolves.

**Acceptance criteria:**
- Patterns from abandoned workflows decay and eventually prune
- Patterns from current workflows strengthen and persist
- Measurable: after workflow shift, agent adapts within 2 weeks (not stuck on old patterns)

---

### E2.3 — No Regression

> **As an end user**, I want confidence that my agent won't get WORSE after a training update, so I can trust that updates are safe.

**Acceptance criteria:**
- Every training cycle evaluates against held-out test set
- Automatic rollback if new adapter underperforms previous
- User is never exposed to a degraded adapter

---

### E2.4 — Privacy-Preserving

> **As an end user**, I want my training data to capture HOW my agent should behave (not WHAT we talked about), so that my conversations aren't stored as training examples.

**Acceptance criteria:**
- Patterns are structural ("answered all 3 questions", "used numbered lists")
- Raw conversation content is NOT in the training dataset
- Operator can verify by inspecting the pattern store (human-readable structural descriptions)

---

### E2.5 — Operator Visibility

> **As an operator**, I want to see what my agent has learned and what's being pruned, so I can audit the training pipeline and intervene if needed.

**Acceptance criteria:**
- CLI/dashboard showing: pattern count, lifecycle distribution, recent prunes
- Vitality scores for all active patterns
- Diff results from last training cycle (what was added/pruned/evolved)
- Core personality set is visible and editable

---

### E2.6 — Safe Defaults

> **As an operator**, I want the system to be conservative by default (never prune too aggressively, always have rollback), so I can't accidentally destroy my agent's learned behavior.

**Acceptance criteria:**
- Minimum dataset size enforced (default 50 patterns)
- Pruned patterns archived, not deleted
- Core personality set is never-prune by default
- First-time setup wizard identifies initial core patterns

---

## Epic 3: Combined System (Closed Loop)

### E3.1 — Automatic Pipeline

> **As an operator**, I want the system to run automatically without manual intervention, from compaction through extraction through training, so I can set it and forget it.

**Acceptance criteria:**
- Dropped compaction summaries automatically feed pattern extraction
- Training triggers fire automatically (time/volume/drift/quality)
- Deployed adapters are loaded without manual restart
- Operator gets notification on training cycle completion (summary of changes)

---

### E3.2 — Drift Detection

> **As an operator**, I want to be alerted when my user's behavior shifts significantly, so I can verify the agent is adapting appropriately.

**Acceptance criteria:**
- Thread evolution across compactions monitored for shift signals
- When main thread changes dramatically (new primary focus), operator is notified
- Out-of-cycle retrain triggered on significant drift
- Dashboard shows drift timeline

---

### E3.3 — Observable Memory Hierarchy

> **As an operator**, I want to understand what my agent "knows" at each memory level (immediate, short-term, medium-term, long-term), so I can diagnose memory-related issues.

**Acceptance criteria:**
- CLI command: `kasett status` shows current state at each level
- Immediate: current context usage %
- Short-term: compaction window contents (thread summaries)
- Medium-term: active pattern count + lifecycle distribution
- Long-term: adapter version, last trained, pattern count at training time

---

### E3.4 — Recovery From Bad State

> **As an operator**, I want to be able to roll back any layer of memory independently, so that if something goes wrong I can fix it without losing everything.

**Acceptance criteria:**
- Compaction window can be manually reset (clear summaries, start fresh)
- Pattern store can be rolled back to previous training cycle's state
- Adapter can be rolled back to previous version
- Archived patterns can be recovered and re-ingested

---

## Epic 4: Platform (Multi-Agent at Scale)

### E4.1 — Per-Agent Isolation

> **As a platform operator**, I want each agent's memory pipeline to be fully isolated, so one agent's training data never bleeds into another's.

**Acceptance criteria:**
- Pattern stores are per-agent (separate directories/databases)
- Training runs are per-agent
- No shared state between agents' ALLM pipelines
- Configurable per-agent hyperparameters

---

### E4.2 — Fleet Metrics

> **As a platform operator**, I want aggregate metrics across all agents (correction rates, adaptation lag, pruning efficiency), so I can assess system health at scale.

**Acceptance criteria:**
- Centralized metrics collection from individual agent pipelines
- Dashboard: fleet correction rate trend, training frequency, pruning ratios
- Alert on: agent with rising correction rate, agent with stale training, agent with no patterns

---

### E4.3 — Hyperparameter Defaults

> **As a platform operator**, I want validated default hyperparameters that work for most users, so I don't need to tune per-agent for the first deployment.

**Acceptance criteria:**
- Defaults (α=0.35, β=0.30, γ=0.20, δ=0.15, λ=0.05) validated on 5+ agents
- Documentation of when to deviate from defaults
- Per-agent override available but not required

---

## Build Priority

| Priority | Stories | Rationale |
|----------|---------|-----------|
| **P0 (build first)** | E1.1, E1.2, E1.5, E1.6 | Phase 1 — deployable today, no OC changes |
| **P1 (next)** | E1.3, E1.4, E2.1, E2.4 | Phase 2 — rolling window + basic ALLM extraction |
| **P2 (then)** | E2.2, E2.3, E2.5, E2.6, E3.1 | Phase 3 — full ALLM pipeline + automation |
| **P3 (later)** | E3.2, E3.3, E3.4, E4.* | Phase 4 — platform features, fleet management |

---

## Definition of Done (all stories)

- [ ] Code written and compiles
- [ ] Unit tests covering happy path + edge cases
- [ ] Integration test with real OC session data
- [ ] Documentation in README
- [ ] No regressions in existing tests
