# Kasett Intake Log — IP Provenance Record

**Purpose:** Legal record of every file received in connection with Kasett project (patents, disclosures, technical documents, third-party communications).

**Why a separate log:** Kasett patents (ALLM, Steering Loop, Hypervisor) require defensible provenance for prior-art and inventorship records. This log is a contemporaneous record admissible as evidence.

**Format (one entry per file):**

```
ISO_TIMESTAMP · SENDER · CHANNEL/CONTEXT · ORIGINAL_FILENAME · → DESTINATION · SHA256
  summary: 1-2 sentence content summary
```

**Update rule:** Append-only. Never edit prior entries. If correction needed, add a new entry referencing the prior one with `[CORRECTION]` prefix.

---

## Log entries

2026-05-05T09:03:00Z · chris · telegram (backfilled 2026-05-10) · ALLM-patent-claims.md · → repos/kasett-rewind/intake/2026-05-05-allm-patent-claims.md · sha256:26209e04b9dbd11fc43b1f794e9e77bc640aeb7c3aa334876a8b2f1961660d75
  summary: ALLM (Adaptive Large Language Model) patent claims draft. Kasett patent #1 (~$25-35K filing). Two duplicate uploads received in inbound; canonical content stored.

2026-05-05T09:03:00Z · chris · telegram (backfilled 2026-05-10) · ALLM-design-doc.md · → repos/kasett-rewind/intake/2026-05-05-allm-design-doc.md · sha256:e9b7789bc86e1e416b6f7f98e720564569f0c5d7d7bc36b266ed9d6c097bfa4d
  summary: ALLM design document. Companion to patent claims. Two duplicate uploads received in inbound; canonical content stored.
