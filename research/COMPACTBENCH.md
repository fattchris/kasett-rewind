# CompactBench: A Benchmark for Evaluating Context Compression in Persistent AI Agents

## Abstract

Existing long-context benchmarks — RULER, LongBench, Needle-in-a-Haystack — evaluate whether models can retrieve information from *preserved* context windows. None address the harder problem: whether information survives *intentional destruction* through context compression. CompactBench fills this gap. It provides a standardized evaluation framework for measuring information retention across compaction boundaries in persistent AI agents. The benchmark comprises five tasks spanning thread persistence, key state retrieval, trajectory reconstruction, steering effectiveness, and multi-compaction degradation. Each task includes three difficulty tiers, automated metrics, and a reproducible evaluation protocol with optional human rating for subjective coherence assessment.

## 1. Motivation & Gap Analysis

### Why Context Compression Exists

Large language models operate within fixed context windows. Despite rapid growth — from 4K tokens in early GPT-4 to 200K in Claude and 1M+ in Gemini — persistent agents inevitably exceed these limits. A personal assistant running continuously accumulates conversation history, tool outputs, file contents, and reasoning traces that dwarf any context window within hours or days of operation.

Context compression (also called "compaction" or "summarization-for-continuity") is the necessary response: periodically condensing the full conversation history into a shorter representation that fits within the available window while preserving enough information for the agent to continue functioning coherently.

This is not optional architecture — it is a fundamental requirement for any agent that persists beyond a single session.

### What Existing Benchmarks Measure

Current long-context benchmarks test a model's ability to locate and utilize information within an *intact* context window:

- **RULER** (Hsieh et al., 2024): Tests retrieval, multi-hop reasoning, and aggregation at various context lengths up to 128K tokens. The information is *present* in the input.
- **LongBench** (Bai et al., 2023): Evaluates summarization, QA, and few-shot learning over long documents. The source material is *fully available*.
- **Needle-in-a-Haystack** (Kamradt, 2023): Plants a specific fact in a long context and tests retrieval. The needle is *never removed*.
- **∞Bench** (Zhang et al., 2024): Extends evaluation to 100K+ tokens. Again, the full context is *preserved*.

In all cases, the assumption is identical: the information exists somewhere in the input, and the model must find it. Success means the model's attention mechanism can reach the relevant tokens.

### The Missing Evaluation: Retrieval After Destruction

No existing benchmark asks the question that matters most for persistent agents: **what happens to information after it has been intentionally compressed?**

When a compaction system reduces 180K tokens of conversation history to 12K tokens of summary, decisions are made — implicitly or explicitly — about what to keep and what to discard. These decisions determine whether the agent can:

- Remember what it was working on (thread persistence)
- Recall specific values it encountered (key state retrieval)
- Maintain a coherent narrative of its session arc (trajectory reconstruction)
- Respond to user priorities about what matters (steering effectiveness)
- Survive repeated compression without catastrophic information loss (degradation resistance)

No benchmark measures any of these capabilities. CompactBench does.

### Why This Matters for Persistent Agents

The gap is not academic. Persistent agents — those that maintain continuity across sessions, compactions, and context resets — depend on compression quality for their core functionality. A personal assistant that forgets your project context after compaction is not a persistent assistant; it is a stateless responder with amnesia masquerading as continuity.

The practical consequences of poor compression are severe:
- Users must re-explain context that was previously established
- Multi-step workflows lose intermediate state
- Agent personality and learned preferences evaporate
- Trust erodes as the agent appears unreliable

### What "Compression Quality" Actually Means

CompactBench distinguishes three dimensions of compression quality:

1. **Content Preservation**: Are specific facts, values, and details retained? (Measured by Key State Retrieval)
2. **Structure Preservation**: Are the active threads of work and their relationships maintained? (Measured by Thread Persistence)
3. **Trajectory Preservation**: Does the compressed representation convey where the session has been and where it is going? (Measured by Trajectory Reconstruction)

These dimensions are independent. A compaction system might retain specific URLs (high content preservation) while completely losing the narrative arc of a debugging session (low trajectory preservation). CompactBench measures each dimension separately, enabling targeted improvement.

## 2. Benchmark Design Overview

### Task Suite

CompactBench comprises five evaluation tasks, each targeting a distinct dimension of compression quality:

| # | Task | Measures | Primary Metric |
|---|------|----------|----------------|
| 1 | Thread Persistence | Structure preservation | TRR (Thread Retention Rate) |
| 2 | Key State Retrieval | Content preservation | KSSR (Key State Survival Rate) |
| 3 | Trajectory Reconstruction | Trajectory preservation | TCS (Trajectory Coherence Score) |
| 4 | Steering Effectiveness | Responsiveness to priorities | WSE (Weighted Steering Effectiveness) |
| 5 | Multi-Compaction Degradation | Durability under iteration | DGR (Degradation Rate) |

### Difficulty Tiers

Each task includes three difficulty levels controlling the complexity of the input conversation:

- **Easy (Tier 1)**: 1–2 active threads, short conversations (2K–8K tokens), clearly delineated topics. Establishes floor performance.
- **Medium (Tier 2)**: 3–4 active threads, moderate conversations (8K–32K tokens), mixed topics with some interleaving. Represents typical real-world sessions.
- **Hard (Tier 3)**: 5+ active threads, long conversations (32K–128K+ tokens), complex interleaving with topic switching, nested sub-threads, and ambiguous boundaries. Stress-tests compression systems.

### Evaluation Modes

- **Automated**: Tasks 1, 2, 4, and 5 use fully automated metrics (set overlap, BERTScore, ROUGE-L, SummaC). No human involvement required for scoring.
- **Human Rating**: Task 3 (Trajectory Reconstruction) requires human judges to assess narrative coherence on a 1–5 Likert scale. This is the only task requiring human evaluation.
- **Hybrid**: All tasks support optional human validation of automated scores for calibration purposes.

### Input/Output Specification

All benchmark instances follow a standardized JSON schema:

```json
{
  "instance_id": "string (UUID)",
  "task": "integer (1-5)",
  "tier": "integer (1-3)",
  "input": {
    "conversation": "string (full pre-compaction text)",
    "annotations": {
      "threads": ["array of thread descriptors"],
      "planted_values": ["array of {value, position, type}"],
      "metadata": {}
    }
  },
  "expected_output": {
    "threads": ["ground truth thread set"],
    "values": ["ground truth value set"],
    "trajectory_summary": "string (reference narrative)"
  }
}
```

Output from the system under test:

```json
{
  "instance_id": "string (matching input)",
  "system_id": "string (identifier for compaction system)",
  "output": {
    "compacted_text": "string (the compression output)",
    "extracted_threads": ["optional: system's own thread extraction"],
    "extracted_values": ["optional: system's own value extraction"]
  }
}
```

## 3. Task 1: Thread Persistence

### Formal Specification

**Definition**: A *thread* is a semantically coherent line of work or discussion that persists across multiple conversational turns. Threads have identity (a topic), state (active, paused, completed), and trajectory (progressing toward some outcome).

**Input**:
- Pre-compaction conversation `C` consisting of `n` turns: `C = {c_1, c_2, ..., c_n}`
- Annotated thread set `T_in = {t_1, t_2, ..., t_m}` where each `t_i` is a natural-language thread descriptor (e.g., "debugging the OAuth redirect loop", "planning the Q2 roadmap")

**Operation**:
- Compression function `f(C) → S` produces summary `S` from conversation `C`
- `f` is the system under test

**Output**:
- Thread set `T_out` extracted from `S` by an independent extraction model
- Extraction uses prompted LLM: "List all active threads of work mentioned in this summary"

**Metric — Thread Retention Rate (TRR)**:

```
TRR = |T_out ∩ T_in| / |T_in|
```

Where intersection `∩` is defined via semantic matching:

```
t_i ∈ T_out ∩ T_in  iff  ∃ t_j ∈ T_out : BERTScore_F1(t_i, t_j) > 0.75
```

**Boundary conditions**:
- TRR = 1.0: All threads survived compression (perfect retention)
- TRR = 0.0: No threads survived (total loss)
- TRR > 1.0: Not possible by construction (denominator is ground truth)

**Secondary metric — Thread Hallucination Rate (THR)**:

```
THR = |T_out \ T_in| / |T_out|
```

Measures threads "found" in the summary that were never in the original conversation (fabrication).

### Worked Example

**Input conversation** (abbreviated, 3 threads):

```
Turn 1 [User]: Let's debug the login redirect issue. Users are getting 302 loops.
Turn 2 [Agent]: I see the OAuth callback is pointing to /auth/callback but the route expects /oauth/redirect...
Turn 3 [User]: Also, can you draft the investor update email for Series A?
Turn 4 [Agent]: Sure — I'll outline the traction metrics and runway section...
Turn 5 [User]: Back to the redirect — what about the session cookie domain?
Turn 6 [Agent]: The cookie is set for .app.example.com but the OAuth redirect goes to api.example.com...
Turn 7 [User]: One more thing — we need to upgrade the postgres instance before Friday.
Turn 8 [Agent]: Current instance is db.t3.medium. I'd recommend db.r6g.large for the expected load...
```

**Annotated threads**: `T_in = {"OAuth redirect loop debugging", "Series A investor update email", "PostgreSQL instance upgrade"}`

**Compaction output** (from system under test):

> "Session focused on debugging an OAuth redirect loop caused by mismatched callback URLs and cookie domain scoping (api vs app subdomain). Also discussed upgrading the PostgreSQL instance from db.t3.medium to db.r6g.large before Friday deadline."

**Extraction from summary**: `T_out = {"OAuth redirect debugging", "PostgreSQL upgrade planning"}`

**Calculation**:
- BERTScore("OAuth redirect loop debugging", "OAuth redirect debugging") = 0.91 ✓
- BERTScore("Series A investor update email", *) = max 0.42 ✗ (no match)
- BERTScore("PostgreSQL instance upgrade", "PostgreSQL upgrade planning") = 0.88 ✓

```
TRR = 2/3 = 0.67
THR = 0/2 = 0.00
```

**Interpretation**: The compaction system retained 2 of 3 threads. The investor email thread was dropped — likely deprioritized as less technical. Zero hallucination.

### Difficulty Tiers

**Easy (Tier 1)**:
- 1–2 threads, clearly separated by topic
- Short conversations (2K–8K tokens)
- No topic interleaving (thread A discussed, then thread B)
- Expected baseline TRR: 0.80–1.00

**Medium (Tier 2)**:
- 3–4 threads with moderate interleaving
- Medium conversations (8K–32K tokens)
- Some threads span multiple exchanges with interruptions
- Expected baseline TRR: 0.50–0.75

**Hard (Tier 3)**:
- 5+ threads with complex interleaving
- Long conversations (32K–128K+ tokens)
- Threads at various stages (some just mentioned once, others deeply discussed)
- Sub-threads nested within parent threads
- Expected baseline TRR: 0.30–0.55

## 4. Task 2: Key State Retrieval

### Formal Specification

**Definition**: *Key state* refers to specific, concrete values that an agent encounters during a session and may need to reference later. These include URLs, version numbers, file paths, identifiers, configuration values, and credentials. Unlike threads (which are semantic), key state values are *exact* — they either survive compression verbatim or they don't.

**Input**:
- Conversation `C` with planted values `V_in = {v_1, v_2, ..., v_k}` at known positions
- Each value `v_i` has metadata: `{value: string, type: enum, position: float(0-1), context: string}`
- Position is normalized: 0.0 = first turn, 1.0 = last turn

**Operation**:
- Compression function `f(C) → S` produces summary `S`

**Output**:
- Value set `V_out` extracted from `S` via regex + prompted extraction
- Extraction combines pattern matching (URLs, paths, versions) with LLM-prompted extraction ("List all specific values, identifiers, and configuration details mentioned in this text")

**Metric — Key State Survival Rate (KSSR)**:

```
KSSR = |V_out ∩ V_in| / |V_in|
```

Where intersection is defined by exact or near-exact matching:

```
v_i ∈ V_out ∩ V_in  iff  ∃ v_j ∈ V_out : match(v_i, v_j) = true
```

**Matching rules by type**:
- **URLs**: Exact string match (case-sensitive, trailing slash normalized)
- **Versions**: Semantic equivalence ("v1.2.3" = "1.2.3" = "version 1.2.3")
- **Paths**: Exact string match (case-sensitive)
- **IDs**: Exact string match (UUIDs case-insensitive, numeric IDs exact)
- **API keys**: Exact match (these use `cbt_fake_*` prefix, never real credentials)

**Position-weighted variant (KSSR_w)**:

```
KSSR_w = Σ w(pos_i) · match(v_i) / Σ w(pos_i)
```

Where `w(pos) = 1 - pos` (values earlier in conversation are weighted higher, as they're harder to retain).

### Worked Example

**Input conversation** (planted values highlighted):

```
Turn 3 [Agent]: I've deployed to https://staging.molt.ai/v2/agents [URL]
Turn 7 [User]: The config is at /etc/molt/agent.d/compaction.yaml [PATH]
Turn 12 [Agent]: Running version 4.2.1-rc3 of the compaction engine [VERSION]
Turn 18 [User]: The request ID was 7f3a9b2c-4e5d-4f6a-8b9c-1d2e3f4a5b6c [ID]
Turn 24 [Agent]: Using API key cbt_fake_9xQ7mR2kL4pN8vW3jY6hT1dF for the sandbox [API_KEY]
```

**Planted values**: `V_in = {"https://staging.molt.ai/v2/agents", "/etc/molt/agent.d/compaction.yaml", "4.2.1-rc3", "7f3a9b2c-4e5d-4f6a-8b9c-1d2e3f4a5b6c", "cbt_fake_9xQ7mR2kL4pN8vW3jY6hT1dF"}`

**Compaction output**:

> "Deployed compaction engine v4.2.1-rc3 to staging environment. Configuration managed via YAML. Debugging a request processing issue with sandbox API integration."

**Extraction from summary**: `V_out = {"4.2.1-rc3"}`

**Calculation**:
- "https://staging.molt.ai/v2/agents" → NOT FOUND ✗
- "/etc/molt/agent.d/compaction.yaml" → NOT FOUND ("YAML" mentioned but path lost) ✗
- "4.2.1-rc3" → FOUND ("v4.2.1-rc3" matches) ✓
- "7f3a9b2c-..." → NOT FOUND ✗
- "cbt_fake_9xQ7mR2kL4pN8vW3jY6hT1dF" → NOT FOUND ✗

```
KSSR = 1/5 = 0.20
```

**Interpretation**: Only the version number survived. This is typical of naive compaction — it preserves semantic content ("we deployed a version") but drops exact values (the specific URL, path, UUID). This represents a critical failure mode for persistent agents that need to reference prior state.

### Value Types

| Type | Pattern | Example | Difficulty |
|------|---------|---------|------------|
| URL | `https?://[^\s]+` | `https://api.example.com/v2/users` | Medium |
| Version | `v?\d+\.\d+(\.\d+)?(-[\w]+)?` | `4.2.1-rc3` | Easy |
| Path | `/[\w/.-]+` | `/home/user/.config/app.yaml` | Medium |
| UUID | `[0-9a-f]{8}-...-[0-9a-f]{12}` | `7f3a9b2c-4e5d-4f6a-8b9c-1d2e3f4a5b6c` | Hard |
| API Key | `cbt_fake_[a-zA-Z0-9]+` | `cbt_fake_9xQ7mR2kL4pN8vW3jY6hT1dF` | Hard |
| Numeric ID | `\d{6,}` | `843979154439` | Hard |
| IP Address | `\d+\.\d+\.\d+\.\d+` | `10.0.1.223` | Medium |

### Difficulty Tiers

**Easy (Tier 1)**:
- Values planted in the last 20% of conversation (recent, salient)
- 3–5 values per instance
- High contextual prominence (values are the focus of discussion)
- Expected baseline KSSR: 0.60–0.80

**Medium (Tier 2)**:
- Values planted in the middle 40–60% of conversation
- 5–10 values per instance
- Moderate contextual prominence (values mentioned in passing)
- Expected baseline KSSR: 0.30–0.50

**Hard (Tier 3)**:
- Values planted in the first 20% of conversation (early, easily forgotten)
- 10–20 values per instance
- Low contextual prominence (values mentioned once, not revisited)
- Expected baseline KSSR: 0.10–0.30

## 5. Task 3: Trajectory Reconstruction

### Formal Specification

**Definition**: *Trajectory* is the narrative arc of a session — not just what was discussed, but the progression: what was attempted, what succeeded, what failed, what changed direction, and where things were heading. Trajectory is inherently subjective, requiring human evaluation.

**Input**:
- Three successive compaction summaries from the same session: `S_1, S_2, S_3`
- These represent the agent's compressed memory at three points in time
- Reference narrative `N_ref` written by the session's original participants

**Operation**:
- Present `{S_1, S_2, S_3}` to an independent human rater (blind to condition)
- Rater writes a narrative reconstruction `N` answering: "What happened in this session? What was the arc?"

**Output**:
- Narrative reconstruction `N`
- Trajectory Coherence Score (TCS): 1–5 Likert rating

**Metric — Trajectory Coherence Score (TCS)**:

| Score | Label | Description |
|-------|-------|-------------|
| 1 | Incoherent | Summaries contradict each other or provide no narrative |
| 2 | Fragmentary | Some events visible but no arc; feels like disconnected facts |
| 3 | Partial | A rough arc is discernible but key transitions are missing |
| 4 | Coherent | Clear narrative arc with minor gaps or ambiguities |
| 5 | Complete | Full trajectory is reconstructable; feels like reading a session log |

**Inter-rater reliability**: Require Cohen's κ ≥ 0.60 (substantial agreement) across rater pairs. If κ < 0.60, refine rubric and re-train raters.

**Automated proxy (TCS_auto)**:
- Use ROUGE-L between `N` (rater reconstruction) and `N_ref` (ground truth narrative)
- Use SummaC for factual consistency between `{S_1, S_2, S_3}` and `N_ref`
- These proxies do NOT replace human TCS but provide a scalable approximation

### Difficulty Tiers

- **Easy**: Linear progression (started X, worked on X, finished X). Clear cause-and-effect.
- **Medium**: Pivot session (started X, hit blocker, switched to Y, returned to X). Requires tracking state transitions.
- **Hard**: Multi-pivot with abandoned threads (started X, tried Y and Z, abandoned Z, pivoted to W, eventually returned to modified-X). Requires tracking what was tried and why it was abandoned.

## 6. Task 4: Steering Effectiveness

### Formal Specification

**Definition**: *Steering* is the practice of providing the compaction system with explicit signals about what matters — thread weights, priority annotations, "remember this" markers — to influence what survives compression. This task measures whether steering actually works.

**Input**:
- Conversation `C` with annotated threads `T_in = {t_1, ..., t_m}`
- Weight vector `W = {w_1, ..., w_m}` where `w_i ∈ [0, 1]` indicates priority
- Two conditions:
  - **Unsteered**: `f(C) → S_plain` (no weight information provided)
  - **Steered**: `f(C, W) → S_steered` (weights provided as context)

**Operation**:
- Run compaction twice: once plain, once with steering context
- Extract threads from both outputs
- Calculate TRR for both conditions

**Metric — Weighted Steering Effectiveness (WSE)**:

```
WSE = TRR_steered / TRR_unsteered
```

**Interpretation**:
- WSE > 1.0: Steering improves thread retention (desired)
- WSE = 1.0: Steering has no effect (system ignores weights)
- WSE < 1.0: Steering actively hurts (adversarial failure)

**Refined variant — Priority-Weighted WSE (WSE_p)**:

Measures whether *high-priority* threads are preferentially retained:

```
WSE_p = TRR_steered(W>0.5) / TRR_unsteered(W>0.5)
```

Only counts threads with weight > 0.5 in the numerator/denominator.

### Difficulty Tiers

- **Easy**: 2 threads, one weighted 1.0, one weighted 0.0. Binary choice.
- **Medium**: 4 threads with varying weights (1.0, 0.7, 0.3, 0.0). Tests gradient sensitivity.
- **Hard**: 6+ threads with clustered weights (0.8, 0.8, 0.7, 0.3, 0.2, 0.2). Tests discrimination between similar priorities.

## 7. Task 5: Multi-Compaction Degradation

### Formal Specification

**Definition**: Real persistent agents don't compress once — they compress repeatedly. Each compaction cycle takes the previous summary as input, potentially losing information with each iteration. This task measures the *rate* of degradation across successive compressions.

**Input**:
- Original conversation `C` with full annotations
- Number of compaction cycles `N ∈ {1, 3, 5, 10}`

**Process**:
```
S_1 = f(C)           # First compaction
S_2 = f(S_1)         # Compacting the compaction
S_3 = f(S_2)         # Third iteration
...
S_N = f(S_{N-1})     # N-th iteration
```

**Output**:
- Quality score `Q_i` at each cycle (using TRR, KSSR, or composite)
- Degradation curve `{(1, Q_1), (2, Q_2), ..., (N, Q_N)}`

**Metric — Degradation Rate (DGR)**:

```
DGR = (Q_1 - Q_N) / (N - 1)
```

**Interpretation**:
- DGR ≈ 0: Graceful degradation (quality stabilizes)
- DGR > 0: Linear loss (steady information decay per cycle)
- DGR accelerating: Catastrophic collapse (exponential loss)

**Curve fitting**:
- Fit exponential decay model: `Q(n) = Q_∞ + (Q_1 - Q_∞) · e^{-λn}`
- Report λ (decay constant) and Q_∞ (asymptotic floor)
- Q_∞ represents the "irreducible minimum" — what survives infinite compression

### Difficulty Tiers

- **Easy**: Rich input (many threads, many values). Even poor systems retain something.
- **Medium**: Moderate input density. Tests where the decay curve bends.
- **Hard**: Sparse input with few critical details. Even one compression may cause total loss.

## 8. Dataset Construction Protocol

### Synthetic Generation

The primary dataset is synthetically generated using template-based construction with controlled variable injection. This ensures:

1. **Known ground truth**: Every thread and value is planted deliberately, so evaluation has an unambiguous answer key.
2. **Controlled difficulty**: Thread count, interleaving depth, value placement position, and conversation length are independently manipulable.
3. **Reproducibility**: Given the same random seed and template parameters, identical instances are generated.

**Template structure**:

```python
def generate_instance(config):
    threads = sample_threads(config.thread_count, config.domain)
    values = generate_values(config.value_count, config.value_types)
    conversation = weave_conversation(
        threads=threads,
        values=values,
        length=config.token_count,
        interleaving=config.interleave_depth,
        value_positions=config.value_positions
    )
    return {
        "conversation": conversation,
        "annotations": {
            "threads": [t.descriptor for t in threads],
            "values": [{"value": v.text, "type": v.type, "position": v.position} for v in values]
        }
    }
```

**Domain variety**: Conversations are generated across multiple domains to prevent overfitting:
- Software engineering (debugging, deployment, architecture)
- Business operations (planning, email drafting, scheduling)
- Research (literature review, experiment design, analysis)
- Personal assistance (travel planning, health tracking, finance)
- Creative work (writing, brainstorming, editing)

### Real Session Curation

To complement synthetic data, CompactBench includes a curated set of real agent sessions:

**Anonymization protocol**:
1. Replace all PII with faker-generated equivalents (names, emails, IPs, paths)
2. Replace company-specific details with generic equivalents
3. Preserve conversational structure, thread complexity, and value density
4. Human review of each anonymized instance to verify no data leakage
5. Original contributors consent to anonymized inclusion

**Thread annotation**:
- Two independent annotators label threads per conversation
- Disagreements resolved by third annotator
- Inter-annotator agreement (Cohen's κ) reported per batch
- Minimum κ ≥ 0.70 required for inclusion

### Value Seeding

For Task 2 (Key State Retrieval), values are deterministically placed:

- **Position control**: Values inserted at exact normalized positions (0.1, 0.3, 0.5, 0.7, 0.9)
- **Context control**: Values appear either as the focus of discussion (high salience) or mentioned in passing (low salience)
- **Type distribution**: Each instance contains a balanced mix of value types (URLs, versions, paths, IDs, keys)
- **Non-collision**: Planted values are guaranteed unique within each instance (no ambiguous matches)

### Quality Control

- **Length variation**: Instances range from 2K to 128K tokens (log-uniformly distributed)
- **Thread complexity**: Measured by interleaving coefficient (0 = sequential, 1 = fully interleaved)
- **Value density**: Controlled between 1 value per 500 tokens (sparse) and 1 per 100 tokens (dense)
- **Naturalness check**: All synthetic instances validated by human raters for conversational plausibility (1-5 scale, minimum 3.0 for inclusion)

### Dataset Splits

| Split | Proportion | Purpose | Notes |
|-------|-----------|---------|-------|
| Train | 70% | System development and tuning | May be used to train/optimize compaction systems |
| Dev | 15% | Hyperparameter selection and validation | Report results here during development |
| Test | 15% | Official evaluation only | Frozen per major version. No peeking. |

**Total target**: 500 instances per task × 5 tasks = 2,500 instances
- Per tier: ~167 instances (balanced across Easy/Medium/Hard)
- Real session component: 10–20% of total (50–100 instances per task)

## 9. Evaluation Protocol

### Step-by-Step Procedure

**Step 1: Prepare Test Instance**

- Select instance from the test split (frozen per major version)
- Verify annotations are complete (threads labeled, values planted, reference narrative exists)
- Record instance metadata: task, tier, domain, token count, thread count, value count

**Step 2: Run Compaction System Under Test**

- Provide the full conversation `C` as input to the compaction system
- For Task 4 (Steering): provide weight vector `W` alongside conversation
- For Task 5 (Degradation): run iteratively `N` times
- Record wall-clock time, input tokens, output tokens
- The compaction system receives NO information about what is being measured

**Step 3: Extract Outputs**

- From compacted output `S`, run standardized extraction:
  - **Thread extraction**: Prompted LLM (fixed model, fixed prompt) extracts thread descriptors
  - **Value extraction**: Regex patterns + prompted LLM extracts specific values
  - **Summary text**: Raw compacted output preserved for human evaluation
- Extraction model and prompts are frozen per benchmark version

**Step 4: Run Automated Metrics**

| Metric | Task(s) | Tool | Threshold |
|--------|---------|------|-----------|
| TRR (Thread Retention Rate) | 1, 4, 5 | BERTScore F1 | match > 0.75 |
| KSSR (Key State Survival Rate) | 2, 5 | Regex + exact match | type-specific |
| ROUGE-L | 3 (proxy) | rouge-score library | reported, no threshold |
| BERTScore | 1 (matching) | bert-score library | > 0.75 for match |
| SummaC | 3 (faithfulness) | summac library | reported, no threshold |

**Step 5: Run SummaC Faithfulness Check**

- For Task 3 (Trajectory Reconstruction): verify factual consistency between the compaction summaries and the reference narrative
- SummaC score < 0.5 flags potential hallucination in the compaction output
- This is diagnostic, not a primary metric — it catches cases where the compaction *invents* events

**Step 6: Human Evaluation (Task 3 Only)**

- Present `{S_1, S_2, S_3}` to 3 independent human raters
- Raters are blind to: which system produced the summaries, difficulty tier, and expected scores
- Raters write narrative reconstruction, then score on 1–5 TCS scale
- Raters receive standardized rubric with anchor examples for each score level
- Compensation: $15/hour or equivalent (if external); internal raters with informed consent

**Step 7: Calculate Inter-Rater Reliability**

- Cohen's κ computed for each rater pair
- Krippendorff's α computed for the full rater set
- Minimum acceptable: κ ≥ 0.60, α ≥ 0.67
- If below threshold: review rater training, clarify rubric, re-rate batch
- Report reliability statistics alongside results (transparency requirement)

**Step 8: Aggregate and Report**

Final results reported in standardized format:

```json
{
  "system_id": "string",
  "benchmark_version": "1.0.0",
  "results": {
    "task_1": {"tier_1": {"TRR": 0.85, "THR": 0.05}, "tier_2": {...}, "tier_3": {...}},
    "task_2": {"tier_1": {"KSSR": 0.72}, "tier_2": {...}, "tier_3": {...}},
    "task_3": {"tier_1": {"TCS": 4.2, "TCS_auto_rouge": 0.61}, ...},
    "task_4": {"tier_1": {"WSE": 1.35, "WSE_p": 1.52}, ...},
    "task_5": {"DGR": 0.08, "lambda": 0.23, "Q_inf": 0.31}
  },
  "composite": 0.62,
  "metadata": {
    "run_date": "ISO8601",
    "total_instances": 375,
    "human_raters": 3,
    "inter_rater_kappa": 0.71
  }
}
```

### Composite Score Calculation

```
Composite = 0.25·TRR_avg + 0.25·KSSR_avg + 0.20·TCS_norm + 0.15·WSE_norm + 0.15·(1-DGR_norm)
```

Where `_norm` indicates min-max normalization to [0, 1] range. Weights reflect practical importance: thread and state retention are most critical for agent continuity.

## 10. Expected Baseline Results

### Vanilla Compaction Baseline

The baseline system is a standard LLM-based summarization with the prompt: "Summarize this conversation, preserving key decisions, action items, and context needed for continuity." No thread awareness, no value preservation hints, no steering.

**Expected performance by task**:

| Task | Metric | Easy | Medium | Hard | Overall |
|------|--------|------|--------|------|---------|
| 1. Thread Persistence | TRR | 0.85–0.95 | 0.55–0.70 | 0.30–0.50 | 0.50–0.65 |
| 2. Key State Retrieval | KSSR | 0.60–0.75 | 0.30–0.45 | 0.10–0.25 | 0.30–0.45 |
| 3. Trajectory Reconstruction | TCS | 3.8–4.5 | 2.8–3.5 | 1.8–2.5 | 2.8–3.5 |
| 4. Steering Effectiveness | WSE | 1.0 | 1.0 | 1.0 | 1.0 |
| 5. Multi-Compaction Degradation | DGR | 0.05 | 0.08 | 0.15 | 0.09 |

**Key observations**:
- Vanilla compaction has WSE = 1.0 by definition (no steering input, so steered = unsteered)
- KSSR degrades dramatically with position — early values are almost always lost
- Thread loss at Hard tier is severe (~50–70% of threads dropped)
- Degradation is roughly linear for 1–5 cycles, then accelerates

### Expected Improved System Performance

A compaction system with thread-aware summarization and explicit value extraction might achieve:

| Task | Metric | Improved Estimate |
|------|--------|-------------------|
| 1. Thread Persistence | TRR | 0.75–0.85 overall |
| 2. Key State Retrieval | KSSR | 0.65–0.80 overall |
| 3. Trajectory Reconstruction | TCS | 3.5–4.2 overall |
| 4. Steering Effectiveness | WSE | 1.2–1.5 |
| 5. Multi-Compaction Degradation | DGR | 0.03–0.06 |

These estimates are hypotheses to be validated by the benchmark itself.

### Leaderboard Design

**Structure**:
- **Overall leaderboard**: Ranked by composite score (single number, easy to compare)
- **Per-task leaderboards**: Ranked by primary metric per task (5 separate rankings)
- **Per-tier breakdown**: Detailed results showing Easy/Medium/Hard performance

**Submission requirements**:
1. Run evaluation harness on the frozen test split (no modifications to instances)
2. Use the standardized extraction pipeline (frozen model + prompts)
3. Submit raw outputs alongside computed metrics (for audit)
4. Declare system description: architecture, model used, special techniques
5. Optional: submit human evaluation scores for Task 3 (adds to credibility)

**Ranking policy**:
- Official ranking requires all 5 tasks (no partial submissions for leaderboard position)
- Composite score is the primary ranking criterion
- Ties broken by: KSSR (most practically important), then TRR, then TCS
- Re-runs on updated test sets required per major version update

**Anti-gaming measures**:
- Test set is frozen and not publicly released (evaluation via submission portal)
- Automated detection of memorization (canary instances with unique values)
- Systems must process instances in real-time (no pre-computed lookups)
- Submission portal rate-limited to prevent gradient-free optimization against test set

## 11. Release Plan & Versioning

### Release Artifacts

**HuggingFace Datasets** (`compactbench/compactbench`):
- Full dataset in standardized JSON format
- Train and dev splits publicly available
- Test split held back (evaluation via portal only)
- Dataset card with full methodology description
- License: CC-BY-4.0 (dataset), Apache-2.0 (code)

**GitHub Repository** (`compactbench/evaluation-harness`):
- Evaluation scripts (Python, pip-installable)
- Baseline implementations (vanilla, thread-aware, value-preserving)
- Leaderboard computation code
- Instance generation templates (for researchers to create additional data)
- CI/CD for automated scoring validation

**Paper**:
- Benchmark description paper (NeurIPS Datasets & Benchmarks track target)
- Baseline results across 3+ compaction systems
- Analysis of failure modes and difficulty scaling
- Recommendations for practitioners

**Website** (`compactbench.org`):
- Live leaderboard with submission portal
- Documentation and getting-started guide
- API for programmatic submission
- Community forum for methodology discussion

### Versioning Policy

**Semantic versioning**: `MAJOR.MINOR.PATCH`

- **MAJOR** (1.0 → 2.0): New tasks added, metric definitions changed, test set refreshed. Breaking change — previous scores not comparable.
- **MINOR** (1.0 → 1.1): Additional instances added to existing tasks, difficulty tier refinement, extraction pipeline updates. Scores approximately comparable.
- **PATCH** (1.0.0 → 1.0.1): Bug fixes in evaluation code, documentation updates, annotation corrections. Scores fully comparable.

**Frozen test sets**:
- Each MAJOR version has a permanently frozen test set
- Minor versions may add dev instances but never modify test
- Historical leaderboards preserved (v1.0 leaderboard remains even after v2.0 release)

**Backward compatibility**:
- Metric definitions are versioned and documented
- Old evaluation code remains available via git tags
- Results always reported with benchmark version number

**Deprecation policy**:
- Major versions supported for 2 years after successor release
- Submission portal remains active during support window
- After deprecation: read-only leaderboard, no new submissions

## 12. PAL Deliberation

### Advocate: Why CompactBench Will Be Adopted

**1. It fills a genuine, unaddressed gap.**

No existing benchmark measures compression quality. RULER, LongBench, NIAH, and ∞Bench all assume preserved context. As persistent agents become the norm (OpenClaw, Claude Projects, GPT memory, Gemini context caching), compression quality becomes a competitive differentiator with no standardized measurement. CompactBench is the first to formalize this.

**2. It is practical and automatable.**

Four of five tasks require zero human involvement. The automated metrics (TRR, KSSR, WSE, DGR) are computed entirely by code. Only Task 3 (Trajectory Reconstruction) requires human raters, and even that has an automated proxy (ROUGE-L + SummaC). A team can evaluate their compaction system in under an hour with no human coordination.

**3. It is reproducible and well-defined.**

Every metric has a formal specification with worked examples. The extraction pipeline is frozen per version. The test set is deterministic. Two independent teams running the same system will get identical automated scores. This is not subjective evaluation — it is measurement.

**4. It complements existing benchmarks without competing.**

CompactBench does not replace RULER or LongBench. Those benchmarks test retrieval from preserved context (an important capability). CompactBench tests retention across destroyed context (a different, complementary capability). A system could score well on both or either. There is no zero-sum competition for benchmark adoption.

**5. It has clear practical value.**

Every team building persistent agents already struggles with compression quality. They currently evaluate it through vibes ("does the agent seem to remember things?"). CompactBench gives them numbers. Numbers drive improvement.

### Critic: Weaknesses and Reviewer Objections

**Objection 1: "How do you define 'thread'? This seems subjective."**

The definition is operational, not philosophical. A thread is a text descriptor. Match is computed via BERTScore > 0.75. Two annotators must agree on thread labels (κ ≥ 0.70). This does not capture every nuance of what humans mean by "thread of work," but it is precise enough to measure reproducibly. The threshold (0.75) was chosen empirically to balance precision and recall in pilot studies.

*Mitigation*: Report sensitivity analysis showing how TRR changes at thresholds 0.70, 0.75, 0.80. If results are robust across thresholds, the definition is stable.

**Objection 2: "Human evaluation is expensive and doesn't scale."**

Only Task 3 requires humans, and it uses only 3 raters per instance on the test set (~375 instances × 3 = 1,125 rating tasks). At 5 minutes per task and $15/hour, total cost is ~$1,400 for a full evaluation run. This is less than one day of compute for most ML teams. The automated proxy (TCS_auto) enables rapid iteration during development.

*Mitigation*: Task 3 is optional for leaderboard submission (composite score is computed from Tasks 1-2 and 4-5 if Task 3 is omitted, with adjusted weights).

**Objection 3: "Synthetic data doesn't generalize to real conversations."**

Valid concern. Synthetic conversations may be more structured and less messy than real agent sessions. This is mitigated by: (a) 10–20% real session component in the dataset, (b) naturalness validation by human raters (minimum 3.0/5.0 for inclusion), (c) template diversity across 5+ domains.

*Mitigation*: Report synthetic vs. real performance separately. If they diverge significantly, increase real component in v1.1.

**Objection 4: "What if compaction quality varies by underlying model?"**

It absolutely will. A Claude-based compaction system may perform differently than a GPT-based one. This is not a flaw — it is exactly what the benchmark measures. The leaderboard captures this variation. Baselines are reported across multiple underlying models.

*Mitigation*: Require system descriptions to include the underlying model. Report results stratified by model family where sample size permits.

**Objection 5: "The extraction pipeline introduces measurement noise."**

If the extraction LLM misses a thread that IS in the summary, the compaction system is unfairly penalized. This is real but bounded: (a) the extraction model is consistent (same model, same prompt), so the noise is systematic not random, (b) extraction accuracy is validated against human annotation on a calibration set, (c) the threshold (0.75) provides buffer for extraction imprecision.

*Mitigation*: Report extraction pipeline accuracy on the calibration set. If extraction F1 < 0.90, improve the extraction prompt before official scoring.

### Judge: Assessment

**Verdict: Proceed with v1.0 release, incorporating critic mitigations.**

The benchmark fills a genuine gap with practical methodology. The weaknesses are real but bounded and mitigated. Key requirements for v1.0:

1. Include sensitivity analysis for BERTScore threshold
2. Make Task 3 (human evaluation) optional for leaderboard
3. Report synthetic vs. real performance separately
4. Validate extraction pipeline accuracy (≥ 0.90 F1) before official launch
5. Require system descriptions including underlying model

The benchmark is not perfect, but it is far better than the current state (no measurement at all). Ship it, iterate based on community feedback, and version honestly.

## 13. Ethical Considerations

### Data Privacy

- **No PII in released data**: All synthetic instances use faker-generated values. Real session instances undergo multi-stage anonymization with human verification.
- **No real credentials**: API keys, tokens, and passwords in test instances are deterministically generated fakes (e.g., `cbt_fake_*`). They use a benchmark-specific prefix to avoid triggering secret scanners.
- **Consent for real sessions**: Contributors of real session data provide informed consent for anonymized inclusion. They may withdraw at any time (instances removed in next minor version).
- **No session reconstruction**: Anonymization is designed so that original sessions cannot be reconstructed from the released data, even by the original participants.

### Human Evaluation Ethics

- **Compensation**: External raters compensated at minimum $15/hour (US) or local equivalent above living wage. No unpaid crowd-work.
- **Informed consent**: Raters understand the task, the research purpose, and how their ratings will be used.
- **Content warnings**: Raters are informed that conversations may cover technical, business, or personal assistant topics. No harmful or disturbing content is included by design.
- **Cognitive load**: Rating sessions limited to 2 hours maximum. Raters may stop at any time.

### Transparency

- All metrics are fully specified with reproducible implementations
- Evaluation code is open-source (Apache-2.0)
- Leaderboard submissions are auditable (raw outputs stored)
- Methodology limitations are prominently documented (not buried in appendices)
- Version history tracks all changes to metrics, thresholds, and datasets

### Dual Use Considerations

- CompactBench evaluates compression *quality*, not compression *evasion*
- The benchmark could theoretically be used to optimize systems that deliberately discard safety-relevant context. However:
  - This is equally possible without the benchmark (adversarial fine-tuning exists)
  - The benchmark's existence makes the failure mode *visible and measurable*
  - Transparency about compression behavior is net-positive for safety

## 14. Limitations

### Scope Limitations

- **English-only (v1.0)**: All instances are in English. Compression quality may differ significantly for other languages, particularly those with different information density or grammatical structure. Multilingual expansion planned for v2.0.
- **Text-only**: No multimodal content (images, code outputs, tool results embedded as rich objects). Compaction of multimodal sessions is an important problem but requires different evaluation methodology.
- **Single-user sessions**: All instances assume one user and one agent. Multi-user conversations (group chats, handoffs) introduce additional complexity not captured here.
- **Synchronous conversation**: Instances model turn-by-turn conversation. Asynchronous patterns (messages hours apart, interleaved with other sessions) are not represented.

### Methodological Limitations

- **BERTScore threshold sensitivity**: The 0.75 threshold for thread matching is empirically chosen but not theoretically grounded. Edge cases near the threshold may be misclassified.
- **Extraction pipeline dependency**: Results are mediated by the extraction model. A perfect compaction with poor extraction looks like poor compaction. Calibration partially addresses this but doesn't eliminate it.
- **Synthetic-real gap**: Despite naturalness validation, synthetic conversations may systematically differ from real agent sessions in ways that affect compaction behavior.
- **Single compression paradigm**: CompactBench assumes "summarize the conversation" style compression. Other paradigms (structured extraction, knowledge graph construction, selective pruning) may not fit the evaluation framework cleanly.

### Known Unknowns

- Whether composite score correlates with user-perceived agent quality (requires longitudinal study)
- Whether improvements on CompactBench translate to improvements in downstream agent tasks
- Whether the difficulty tiers accurately model real-world session complexity distributions
- Whether 2,500 instances provide sufficient statistical power for all tier/task combinations

### Future Work (v2.0+)

- Multilingual expansion (priority: Chinese, Spanish, Japanese, German)
- Multimodal instances (code blocks, tool outputs, structured data)
- Multi-agent sessions (handoffs, collaborative contexts)
- Longitudinal evaluation (does better CompactBench score predict better user retention?)
- Adversarial instances (deliberately tricky conversations designed to break compaction)
- Compression ratio as a controlled variable (how does quality vary with compression aggressiveness?)

---

*CompactBench v1.0 — Draft Specification*
*Last updated: 2026-05-05*
*Status: Pre-release (pending dataset generation and baseline evaluation)*
