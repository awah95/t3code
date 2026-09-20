# Fresh Jev routing contrasts — v4 evaluation

Frozen authoring timestamp: `2026-09-20T07:46:11+00:00`. JSON SHA-256: `e76ea08c1835fc9d54937916c8fb3727bd515819c2eab99049cf0849d31bc687`.

Prepared by the independent GPT-6 Astra xhigh consultant before viewing v4 implementation or route outputs. Exactly 24 synthetic cases: six families × four variants. This is a fresh routing evaluation, not a task-execution benchmark. Model/effort labels remain provisional.

The earlier JEV-003, JEV-007 and JEV-012 should be rerun separately as exposed regressions. They are deliberately not relabeled or counted as fresh holdouts here.

## How to grade

1. Score the application decision first. Six D variants require `needs_context`: retrieve a known referenced artifact or clarify before making an automatic capability choice. Merely retaining a model and dispatching the underspecified task does not satisfy that decision.
2. The required legacy `preferred` pair in D variants is a placeholder. Their `acceptable` set is empty. Exclude all six from preferred-pair and acceptable-set agreement denominators. Never count the placeholder as the expected executor.
3. For the 18 route cases, report preferred-pair and acceptable-set agreement separately. A disagreement does not establish failure; keep minimum-capability screens and observed task outcomes separate.
4. A vs B tests sensitivity to actual work demands. A vs C tests resistance to irrelevant parent/project complexity. D tests context adequacy with both weak and strong current selections.
5. Capture exact request, policy/response version, candidate pool/order, semantic selected pair, decision/reason, factor assessments, split confidence, latency and router cost. Do not reward confidence increases or claim subscription savings.

## Family-level criteria

- **01 Record retrieval versus reconstructing authorship and event order:** The irrelevant completed scheduler incident must not raise the simple route; incomplete authorship/failure references must produce needs_context, not a guessed Git lookup.
- **02 Reading a status note versus reconciling review findings and actual work:** Short output must not collapse reconciliation into lookup. Conversely, the word review alone must not turn reading an exact supplied note into a frontier review task.
- **03 Executing a fixed form check versus designing proof of a cross-state absence claim:** The lexical negative "never" must not force a large model when scope is an exact checklist; an open cross-state invariant must not inherit the checklist route.
- **04 Tabular extraction versus reconciling shipment records across corrections:** The same report wording should separate selecting final values from reconstructing final values. Missing datasets must not be treated as an empty table or as permission to guess.
- **05 Applying an established parser fix versus investigating reconnect data loss:** A known fix remains cheap despite a dramatic symptom; an unknown cause with interacting asynchronous owners needs sufficient capability. Missing continuation context is a separate decision.
- **06 Route the independent child by its own evidence and inherited context:** A self-contained child should ignore unrelated parent difficulty/failure, but a no-history child that refers to absent agreements must yield needs_context.

## Frozen expectations

| Case     | Variant            | Expected action | Preferred hypothesis         | Acceptable pairs                                                    |
| -------- | ------------------ | --------------- | ---------------------------- | ------------------------------------------------------------------- |
| JVC4-01A | simple             | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-01B | complex            | route           | Sol / medium                 | Sol / medium, Sol / high, Terra / high, Astra / medium              |
| JVC4-01C | irrelevant_context | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-01D | missing_context    | needs_context   | Not scored — context missing | Not applicable                                                      |
| JVC4-02A | simple             | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-02B | complex            | route           | Terra / medium               | Terra / medium, Terra / high, Sol / low, Sol / medium, Sol / high   |
| JVC4-02C | irrelevant_context | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-02D | missing_context    | needs_context   | Not scored — context missing | Not applicable                                                      |
| JVC4-03A | simple             | route           | Terra / low                  | Terra / low, Terra / medium, Luna / medium, Luna / high             |
| JVC4-03B | complex            | route           | Sol / high                   | Sol / medium, Sol / high, Sol / xhigh, Astra / medium, Astra / high |
| JVC4-03C | irrelevant_context | route           | Terra / low                  | Terra / low, Terra / medium, Luna / medium, Luna / high             |
| JVC4-03D | missing_context    | needs_context   | Not scored — context missing | Not applicable                                                      |
| JVC4-04A | simple             | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-04B | complex            | route           | Sol / medium                 | Terra / high, Sol / medium, Sol / high, Astra / medium              |
| JVC4-04C | irrelevant_context | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-04D | missing_context    | needs_context   | Not scored — context missing | Not applicable                                                      |
| JVC4-05A | simple             | route           | Luna / medium                | Luna / low, Luna / medium, Terra / low, Terra / medium              |
| JVC4-05B | complex            | route           | Sol / high                   | Sol / high, Sol / xhigh, Astra / medium, Astra / high               |
| JVC4-05C | irrelevant_context | route           | Luna / medium                | Luna / low, Luna / medium, Terra / low, Terra / medium              |
| JVC4-05D | missing_context    | needs_context   | Not scored — context missing | Not applicable                                                      |
| JVC4-06A | simple             | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-06B | complex            | route           | Sol / high                   | Sol / high, Sol / xhigh, Astra / medium, Astra / high               |
| JVC4-06C | irrelevant_context | route           | Luna / low                   | Luna / low, Luna / medium, Terra / low                              |
| JVC4-06D | missing_context    | needs_context   | Not scored — context missing | Not applicable                                                      |

## Full cases

### JVC4-01A — contrast/history_reconstruction/simple

**User request:** Which change was mine immediately before the import started failing?

**Expected decision:** `route`. An explicitly identified author and first-failure commit in a supplied linear record make this bounded extraction. The wording alone does not require a history investigation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Identify the last commit authored by me before the first failed import run. My verified Git email is lea@example.test.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "git-records",
      "kind": "git_metadata",
      "text": "The selected branch has a linear history with no rewrites. Newest first: 8ab4c90, author lea@example.test, subject \"Rename import progress label\"; 321fbc7, author teammate@example.test, subject \"Add CSV fixture\"; 909ef13, author lea@example.test, subject \"Handle empty header\". The first failed import run is explicitly tied to 8ab4c90. Return the commit immediately before that run that I authored, including that run commit if it is mine."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Use the supplied records only; report hash and subject. No cause analysis or repository changes."
    }
  ]
}
```

### JVC4-01B — contrast/history_reconstruction/complex

**User request:** Which change was mine immediately before the import started failing?

**Expected decision:** `route`. Attribution and chronology must be reconstructed across rewritten, squashed, cherry-picked and detached histories. Read-only Git tools do not make this direct lookup. Terra high remains a plausible alternative pending execution evidence.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Identify my last original change before the import began failing. Include an attribution and ordering explanation; do not modify refs.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "identity",
      "kind": "user_context",
      "text": "I used lea@example.test on the laptop and l.dev@example.test on the recovery machine. The shared branch was rebased after the failed import; a detached recovery worktree contains unsquashed edits."
    },
    {
      "id": "records",
      "kind": "git_metadata",
      "text": "The visible branch ends at 82fd910, a teammate-authored squash of three commits. Reflog has a rebase onto 50c021c and a later checkout of detached c712ea0. The recovery tree contains commits with both of my emails and one cherry-pick whose author is me but committer is a teammate. Author timestamps overlap because one machine clock was wrong; the CI job identifies the first failing tree, not an original commit."
    },
    {
      "id": "available-evidence",
      "kind": "artifact_manifest",
      "text": "The agent can read both local Git object databases, reflogs, patch-id comparisons, and the saved passing/failing CI tree hashes. Recover correspondence between rewritten commits, original changes and CI trees; distinguish confirmed attribution from ambiguous candidates."
    }
  ]
}
```

### JVC4-01C — contrast/history_reconstruction/irrelevant_context

**User request:** Which change was mine immediately before the import started failing?

**Expected decision:** `route`. An explicitly identified author and first-failure commit in a supplied linear record make this bounded extraction. The wording alone does not require a history investigation. The extra context is explicitly unrelated; the admissible task demands are unchanged from variant A.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Identify the last commit authored by me before the first failed import run. My verified Git email is lea@example.test.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "git-records",
      "kind": "git_metadata",
      "text": "The selected branch has a linear history with no rewrites. Newest first: 8ab4c90, author lea@example.test, subject \"Rename import progress label\"; 321fbc7, author teammate@example.test, subject \"Add CSV fixture\"; 909ef13, author lea@example.test, subject \"Handle empty header\". The first failed import run is explicitly tied to 8ab4c90. Return the commit immediately before that run that I authored, including that run commit if it is mine."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Use the supplied records only; report hash and subject. No cause analysis or repository changes."
    },
    {
      "id": "unrelated-previous-work",
      "kind": "prior_task",
      "text": "An earlier, completed project concerned a distributed scheduler, daylight-saving transitions and cross-device conflict resolution. Its incident report used the words data loss and race condition. That project has no connection to the supplied import records."
    }
  ]
}
```

### JVC4-01D — contrast/history_reconstruction/missing_context

**User request:** Which change was mine immediately before it started failing?

**Expected decision:** `needs_context`. The task reference or decisive material is absent. Recover the known artifact/context or clarify before deciding capability. The preferred pair is a legacy-schema placeholder and MUST NOT be scored as a recommendation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "currentModel": "gpt-5.6-luna",
  "currentEffort": "low",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "missing",
  "missingContext": [
    "The project or checkout referred to by \"it\" is not identified.",
    "No author identity, failure boundary, or Git records are included."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVC4-02A — contrast/review_synthesis/simple

**User request:** Catch up on the dirty review notes and my progress, then tell me when you are ready.

**Expected decision:** `route`. This asks only to read one fully supplied, nonconflicting status note and acknowledge it. It does not ask for independent validation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Read the supplied local note so you have the context for my next request. No independent review or implementation is requested.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "notes",
      "kind": "file_excerpt",
      "text": "review-notes.md is the only dirty file. Its complete contents: \"R1: approved rename from Enable Notifications to Send Notifications. Work done: label changed in the source file. Focused snapshot updated and passed. Remaining: wait for the reviewer. Do not send a reply.\""
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Acknowledge once read. Do not inspect other files or determine whether the patch is correct."
    }
  ]
}
```

### JVC4-02B — contrast/review_synthesis/complex

**User request:** Catch up on the dirty review notes and my progress, then tell me when you are ready.

**Expected decision:** `route`. The acknowledgement follows cross-source synthesis of contradictory work and review claims. This is bounded understanding of current state, not permission to solve the underlying defect. Terra medium is provisional; Sol is reasonable if source reconciliation requires more judgment.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Catch up before we continue the current review. Reconcile the notes enough to distinguish completed work, disputed claims and remaining checks; do not edit code or contact the reviewer.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "review-notes",
      "kind": "file_excerpt",
      "text": "review-findings.md: R1 says preset resets can restore a paid-field group after switching to a free-only form. R2 says the generated PHP metadata and TypeScript declaration disagree about the default. R3 requests a browser check after switching forms twice."
    },
    {
      "id": "progress-notes",
      "kind": "file_excerpt",
      "text": "work-so-far.md: R1 is marked fixed by moving the filter to the field registry; later notes say the old filter still runs during preset hydration. R2 is marked complete after editing generated PHP, but a TODO says regenerate from the TypeScript source. R3 is marked checked on initial load only."
    },
    {
      "id": "working-tree",
      "kind": "git_diff_summary",
      "text": "Dirty files include those two notes, the registry filter, its preset consumer, the metadata source and generated PHP. A narrow test asserts the initial registry result. None of the supplied receipts exercises a second form switch."
    },
    {
      "id": "output-scope",
      "kind": "user_constraint",
      "text": "Read the dirty notes and relevant changes. Build a consistent account of what was attempted and what evidence exists; flag unresolved contradictions without silently treating the notes as proof of correctness. The final reply can be brief."
    }
  ]
}
```

### JVC4-02C — contrast/review_synthesis/irrelevant_context

**User request:** Catch up on the dirty review notes and my progress, then tell me when you are ready.

**Expected decision:** `route`. This asks only to read one fully supplied, nonconflicting status note and acknowledge it. It does not ask for independent validation. The extra context is explicitly unrelated; the admissible task demands are unchanged from variant A.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Read the supplied local note so you have the context for my next request. No independent review or implementation is requested.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "notes",
      "kind": "file_excerpt",
      "text": "review-notes.md is the only dirty file. Its complete contents: \"R1: approved rename from Enable Notifications to Send Notifications. Work done: label changed in the source file. Focused snapshot updated and passed. Remaining: wait for the reviewer. Do not send a reply.\""
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Acknowledge once read. Do not inspect other files or determine whether the patch is correct."
    },
    {
      "id": "archive",
      "kind": "unrelated_document",
      "text": "An archived note from last month describes a difficult authentication redesign, migration and production outage. It is marked CLOSED and is unrelated to this label-only review."
    }
  ]
}
```

### JVC4-02D — contrast/review_synthesis/missing_context

**User request:** Catch up on the dirty review notes and my progress, then tell me when you are ready.

**Expected decision:** `needs_context`. The task reference or decisive material is absent. Recover the known artifact/context or clarify before deciding capability. The preferred pair is a legacy-schema placeholder and MUST NOT be scored as a recommendation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "currentModel": "gpt-6-astra",
  "currentEffort": "high",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "windowed",
  "missingContext": [
    "The referenced note files are neither attached nor identified by a project/path.",
    "The loaded messages start after the review began and contain no findings or work summary."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVC4-03A — contrast/negative_invariant/simple

**User request:** Verify that forms without paid fields never show paid-field settings.

**Expected decision:** `route`. The actual authorized work is a predefined three-case execution with exact assertions and failure handling. Broader invariant reasoning is explicitly excluded.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "For this request, verify exactly the approved three-case checklist in the isolated demo; do not generalize beyond those cases.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "approved-checklist",
      "kind": "test_plan",
      "text": "Use the saved free-only fixture FREE-A in the demo. Cases: open FREE-A fresh; switch PAID-B to FREE-A once; reset FREE-A once. For each, query data-option-group=\"paid-field\" and assert count zero. Existing command: pnpm test form-paid-group-checklist --fixture FREE-A. The expected assertions and screenshot locations are already defined."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Run the existing command and record the three results. If a case fails, report the evidence and stop; root-cause diagnosis or expanding the matrix is outside this task."
    }
  ]
}
```

### JVC4-03B — contrast/negative_invariant/complex

**User request:** Verify that forms without paid fields never show paid-field settings.

**Expected decision:** `route`. A negative invariant spans normalization, metadata, asynchronous selection and saved state. The verification design and ownership are not established, so the task is substantially more than running a known UI check.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Establish whether the absence claim holds for forms that have no paid fields. The existing explanation has not been verified. Use source and focused checks; do not assume an initial-load screenshot proves all states.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "data-path",
      "kind": "source_map",
      "text": "The form service exposes raw field types. A normalization layer aliases composite types. Metadata declares option groups before the form request completes. The editor filters groups using the current registry. Preset hydration and undo can restore saved group attributes independently."
    },
    {
      "id": "observations",
      "kind": "review_evidence",
      "text": "A free-only form looks correct when opened fresh. After a paid form is opened, switching to the same free-only form sometimes leaves a paid-field heading. A prior proposed patch filters only the service response. It has not been checked with a saved preset, undo, an empty form, or a stale asynchronous response."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Trace the relevant state paths and design the smallest checks that can support or refute the stated invariant. Separate confirmed coverage from states that remain untested. Do not fix unrelated controls."
    }
  ]
}
```

### JVC4-03C — contrast/negative_invariant/irrelevant_context

**User request:** Verify that forms without paid fields never show paid-field settings.

**Expected decision:** `route`. The actual authorized work is a predefined three-case execution with exact assertions and failure handling. Broader invariant reasoning is explicitly excluded. The extra context is explicitly unrelated; the admissible task demands are unchanged from variant A.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "For this request, verify exactly the approved three-case checklist in the isolated demo; do not generalize beyond those cases.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "approved-checklist",
      "kind": "test_plan",
      "text": "Use the saved free-only fixture FREE-A in the demo. Cases: open FREE-A fresh; switch PAID-B to FREE-A once; reset FREE-A once. For each, query data-option-group=\"paid-field\" and assert count zero. Existing command: pnpm test form-paid-group-checklist --fixture FREE-A. The expected assertions and screenshot locations are already defined."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Run the existing command and record the three results. If a case fails, report the evidence and stop; root-cause diagnosis or expanding the matrix is outside this task."
    },
    {
      "id": "release-history",
      "kind": "unrelated_context",
      "text": "The demo repository also contains a payment-webhook retry bug and a complex database migration. Both are tracked separately, and neither is used by the three form fixtures or approved command."
    }
  ]
}
```

### JVC4-03D — contrast/negative_invariant/missing_context

**User request:** Verify that those settings never appear for the affected forms.

**Expected decision:** `needs_context`. The task reference or decisive material is absent. Recover the known artifact/context or clarify before deciding capability. The preferred pair is a legacy-schema placeholder and MUST NOT be scored as a recommendation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": true,
  "interactionMode": "default",
  "currentModel": "gpt-5.6-luna",
  "currentEffort": "low",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "windowed",
  "missingContext": [
    "The settings and affected form types are not identified in the available messages.",
    "The screenshot referenced by the previous turn is unavailable to the router; no text description or checklist is supplied."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVC4-04A — contrast/shipment_reconciliation/simple

**User request:** Give me one final billed-weight row per shipment.

**Expected decision:** `route`. The data is already final, normalized and unique; this is exact selection of columns with no semantic reconciliation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Transform the supplied authoritative finalized CSV into the requested three-column table.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "final-csv",
      "kind": "table_excerpt",
      "text": "The CSV has columns shipment_id, billed_kg, currency, comment. It contains exactly three unique rows: S-10,12.5,USD,final; S-11,8.0,USD,final; S-12,4.2,EUR,final. All billed_kg values are final and already normalized."
    },
    {
      "id": "format",
      "kind": "user_constraint",
      "text": "Output shipment_id, billed_kg, and currency. Preserve values exactly; do not recompute charges or infer missing records."
    }
  ]
}
```

### JVC4-04B — contrast/shipment_reconciliation/complex

**User request:** Give me one final billed-weight row per shipment.

**Expected decision:** `route`. The difficulty is identity, event precedence and provenance across sources, not row count or financial wording. A bounded documented reconciliation could fit Terra high, while Sol medium is the preferred hypothesis.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Reconcile the supplied courier exports into one final billed-weight row per shipment, with an exception list where identity or final status cannot be established. Apply the documented rules; do not silently choose a value.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "source-a",
      "kind": "table_excerpt",
      "text": "Manifest export: shipment_id S-10, label L-801, parcel P-8, measured 12.5 kg; S-11, label L-802, parcel P-9, measured 8.0 kg. Relabel export: L-801 replaced by L-901 for the same parcel; label L-802 was reused on a replacement parcel P-12 after cancellation."
    },
    {
      "id": "source-b",
      "kind": "table_excerpt",
      "text": "Courier ledger contains original weighings, corrections and cancellation events. It can refer to old or new labels and uses both lb and kg. Corrections can arrive before the original event in the export. Multiple entries have the same timestamp but distinct event IDs."
    },
    {
      "id": "rules",
      "kind": "policy_excerpt",
      "text": "Identity follows parcel ID plus the documented relabel chain, never label alone. A cancelled parcel has no final billed row. The highest revision for a parcel supersedes earlier weights; identical event IDs are duplicate deliveries. Normalize lb to kg using the supplied conversion constant. A correction without a resolvable parcel/revision belongs in the exception list. Preserve provenance from each output row to the input events."
    },
    {
      "id": "available-files",
      "kind": "artifact_manifest",
      "text": "The three local CSVs and the relabel ledger are available. Build and validate the reconciliation against cancellation, reused-label, out-of-order correction and unit-conversion fixtures. This is an offline data report, with no billing-system mutation."
    }
  ]
}
```

### JVC4-04C — contrast/shipment_reconciliation/irrelevant_context

**User request:** Give me one final billed-weight row per shipment.

**Expected decision:** `route`. The data is already final, normalized and unique; this is exact selection of columns with no semantic reconciliation. The extra context is explicitly unrelated; the admissible task demands are unchanged from variant A.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Transform the supplied authoritative finalized CSV into the requested three-column table.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "final-csv",
      "kind": "table_excerpt",
      "text": "The CSV has columns shipment_id, billed_kg, currency, comment. It contains exactly three unique rows: S-10,12.5,USD,final; S-11,8.0,USD,final; S-12,4.2,EUR,final. All billed_kg values are final and already normalized."
    },
    {
      "id": "format",
      "kind": "user_constraint",
      "text": "Output shipment_id, billed_kg, and currency. Preserve values exactly; do not recompute charges or infer missing records."
    },
    {
      "id": "irrelevant-thread",
      "kind": "completed_context",
      "text": "Earlier the user discussed an unrelated warehouse optimization problem with uncertain forecasts and a costly solver. That optimization is complete. Its forecasts must not enter the finalized CSV transformation."
    }
  ]
}
```

### JVC4-04D — contrast/shipment_reconciliation/missing_context

**User request:** Give me one final billed-weight row per shipment.

**Expected decision:** `needs_context`. The task reference or decisive material is absent. Recover the known artifact/context or clarify before deciding capability. The preferred pair is a legacy-schema placeholder and MUST NOT be scored as a recommendation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": true,
  "interactionMode": "default",
  "currentModel": "gpt-6-astra",
  "currentEffort": "high",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "missing",
  "missingContext": [
    "No shipment records, source locations, schema, or final-status rules are included.",
    "An earlier attached workbook is referenced but its sheets and text are unavailable."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVC4-05A — contrast/telemetry_diagnosis/simple

**User request:** Stop the sample reader from dropping the first reading after reconnect.

**Expected decision:** `route`. The cause, exact edit and direct failing regression are supplied. Concurrency terminology in the symptom does not expand this bounded implementation task.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Apply the reviewed one-line fix in the offline telemetry simulator, then run the existing focused regression.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "reviewed-fix",
      "kind": "patch_instruction",
      "text": "In simulator/line-reader.ts, reset nextIndex from 1 to 0 in resetForReconnect(). A trace and the reviewer already established that this skips element zero of the new in-memory batch. Do not alter buffering or socket code."
    },
    {
      "id": "verification",
      "kind": "test_plan",
      "text": "Run pnpm test reconnect-first-reading. The test feeds [sample-40, sample-41] after a reset and expects both in order. The current test fails with only sample-41. Scope is the reviewed reset change and its existing regression."
    }
  ]
}
```

### JVC4-05B — contrast/telemetry_diagnosis/complex

**User request:** Stop the sample reader from dropping the first reading after reconnect.

**Expected decision:** `route`. The agent must discover ownership and ordering across reconnect, cancellation, buffering and replay while preserving interacting invariants. This requires causal investigation rather than merely rerunning a command.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Diagnose and fix intermittent first-reading loss in the offline telemetry simulator. No cause has been established.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "trace",
      "kind": "log_excerpt",
      "text": "A reconnect trace shows old socket close, new socket open, sample seq=40 received, resubscribe acknowledgement, sample seq=41 received. The consumer emits only seq=41. Another failing run has the acknowledgement before seq=40. Reproductions occur only when reconnect and consumer cancellation overlap."
    },
    {
      "id": "ownership",
      "kind": "source_map",
      "text": "Socket callbacks write to a shared ring buffer. Resubscribe swaps the active generation token. Consumer cancellation clears pending delivery and may finish after the new generation begins. A replay source can redeliver the last acknowledged sequence. Three callbacks own portions of state cleanup."
    },
    {
      "id": "requirements",
      "kind": "user_constraint",
      "text": "Preserve order, deliver each sample once, and prevent stale-generation callbacks from clearing new-generation readings. Identify the cause from the source and reproduce it with a deterministic interleaving test. The simulator is isolated; no hardware or production services are involved."
    }
  ]
}
```

### JVC4-05C — contrast/telemetry_diagnosis/irrelevant_context

**User request:** Stop the sample reader from dropping the first reading after reconnect.

**Expected decision:** `route`. The cause, exact edit and direct failing regression are supplied. Concurrency terminology in the symptom does not expand this bounded implementation task. The extra context is explicitly unrelated; the admissible task demands are unchanged from variant A.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Apply the reviewed one-line fix in the offline telemetry simulator, then run the existing focused regression.",
  "currentModel": "gpt-5.6-sol",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "reviewed-fix",
      "kind": "patch_instruction",
      "text": "In simulator/line-reader.ts, reset nextIndex from 1 to 0 in resetForReconnect(). A trace and the reviewer already established that this skips element zero of the new in-memory batch. Do not alter buffering or socket code."
    },
    {
      "id": "verification",
      "kind": "test_plan",
      "text": "Run pnpm test reconnect-first-reading. The test feeds [sample-40, sample-41] after a reset and expects both in order. The current test fails with only sample-41. Scope is the reviewed reset change and its existing regression."
    },
    {
      "id": "unrelated-systems",
      "kind": "project_background",
      "text": "The larger repository includes a high-availability cluster, firmware deployment tools and a storage compactor. None is involved in the isolated line-reader reset function or the supplied regression."
    }
  ]
}
```

### JVC4-05D — contrast/telemetry_diagnosis/missing_context

**User request:** Stop it dropping the first one again.

**Expected decision:** `needs_context`. The task reference or decisive material is absent. Recover the known artifact/context or clarify before deciding capability. The preferred pair is a legacy-schema placeholder and MUST NOT be scored as a recommendation.

**Context sent to the router:**

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "currentModel": "gpt-5.6-luna",
  "currentEffort": "low",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "windowed",
  "missingContext": [
    "The referenced reader, item type and failure are absent from the loaded conversation.",
    "The task appears to continue earlier debugging, but no trace, attempted fix or current objective is available."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVC4-06A — contrast/independent_child/simple

**User request:** Review only the export patch described below and report any correctness issue.

**Expected decision:** `route`. This independent child receives a complete trivial patch and explicit narrow review contract. It should not inherit the parent model or the full audit scope.

**Context sent to the router:**

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "originalTask": "Independent child: inspect only the supplied patch; do not perform the parent project audit.",
  "currentModel": "gpt-6-astra",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "independent_child",
    "inheritedContext": "none"
  },
  "evidence": [
    {
      "id": "child-patch",
      "kind": "diff_excerpt",
      "text": "The complete patch changes one CSV column heading from \"Reciever\" to \"Receiver\" in exportHeaders.ts. The row values, column order and serialization code are unchanged. The expected-header test receives the same spelling correction."
    },
    {
      "id": "child-contract",
      "kind": "delegation",
      "text": "Return whether the heading and expected test agree. Do not investigate other export behavior. You inherit no conversation history; this message contains the complete child task."
    },
    {
      "id": "parent-background",
      "kind": "parent_context",
      "text": "The parent is working on a broad export compatibility review involving several formats. Its model is Astra high; the delegated question is the spelling-only patch above."
    }
  ]
}
```

### JVC4-06B — contrast/independent_child/complex

**User request:** Review only the export patch described below and report any correctness issue.

**Expected decision:** `route`. The bounded child still has demanding correctness work across checkpoints, partial writes and leases. Independence does not imply low difficulty, and a supplied review scope is not an established solution.

**Context sent to the router:**

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "originalTask": "Independent child: review the supplied export design and changed paths for missing or duplicated rows during cancellation and resume. Do not implement fixes.",
  "currentModel": "gpt-6-astra",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "independent_child",
    "inheritedContext": "none"
  },
  "evidence": [
    {
      "id": "child-patch",
      "kind": "change_summary",
      "text": "The patch checkpoints the last exported cursor after each page is written. Resume reads from that cursor inclusively. Cancellation can occur after writing a partial page but before persisting its checkpoint. A second worker may acquire the same expired export lease."
    },
    {
      "id": "child-contract",
      "kind": "acceptance",
      "text": "Report concrete loss/duplication scenarios, inspect lease and checkpoint ownership, and distinguish confirmed defects from missing evidence. Row identity uses a composite key; equal timestamps do not imply duplicate rows. The downstream writer appends and has no implicit deduplication."
    },
    {
      "id": "available-source",
      "kind": "artifact_manifest",
      "text": "The child has paths for the exporter, checkpoint store, lease code and focused tests. No history is inherited. The parent already narrowed the review to these interactions but has not established correctness or proposed a fix."
    },
    {
      "id": "parent-background",
      "kind": "parent_context",
      "text": "The parent is on Astra high for a larger compatibility audit. Its selected model is context, not an instruction to use the same pair for this child."
    }
  ]
}
```

### JVC4-06C — contrast/independent_child/irrelevant_context

**User request:** Review only the export patch described below and report any correctness issue.

**Expected decision:** `route`. This independent child receives a complete trivial patch and explicit narrow review contract. It should not inherit the parent model or the full audit scope. The extra context is explicitly unrelated; the admissible task demands are unchanged from variant A.

**Context sent to the router:**

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "originalTask": "Independent child: inspect only the supplied patch; do not perform the parent project audit.",
  "currentModel": "gpt-6-astra",
  "currentEffort": "high",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "independent_child",
    "inheritedContext": "none"
  },
  "evidence": [
    {
      "id": "child-patch",
      "kind": "diff_excerpt",
      "text": "The complete patch changes one CSV column heading from \"Reciever\" to \"Receiver\" in exportHeaders.ts. The row values, column order and serialization code are unchanged. The expected-header test receives the same spelling correction."
    },
    {
      "id": "child-contract",
      "kind": "delegation",
      "text": "Return whether the heading and expected test agree. Do not investigate other export behavior. You inherit no conversation history; this message contains the complete child task."
    },
    {
      "id": "parent-background",
      "kind": "parent_context",
      "text": "The parent is working on a broad export compatibility review involving several formats. Its model is Astra high; the delegated question is the spelling-only patch above."
    },
    {
      "id": "parent-failure",
      "kind": "unrelated_parent_history",
      "text": "The parent previously failed an unrelated calendar export timezone fix. The parent then switched to Astra high. This child remains the exact spelling-only CSV heading check; the timezone patch and its failure are outside its scope."
    }
  ]
}
```

### JVC4-06D — contrast/independent_child/missing_context

**User request:** Review the patch we agreed on and tell me if it is safe.

**Expected decision:** `needs_context`. The task reference or decisive material is absent. Recover the known artifact/context or clarify before deciding capability. The preferred pair is a legacy-schema placeholder and MUST NOT be scored as a recommendation.

**Context sent to the router:**

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "currentModel": "gpt-6-astra",
  "currentEffort": "high",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "missing",
  "missingContext": [
    "This independent child inherits no history.",
    "The spawn message contains no patch, source paths, agreed scope, or relevant excerpts."
  ],
  "target": {
    "kind": "independent_child",
    "inheritedContext": "none"
  },
  "evidence": []
}
```

## Interpretation limits

These cases deliberately make the relevant evidence inspectable, including realistic conflicting notes and references. They still do not replace production input-builder tests with actual paginated chat and attached artifacts. A task packet may be adequate to assess task difficulty without containing all source code needed to execute the task. Conversely, simply naming files that the router cannot inspect does not establish that their contents are easy.

The proposed capability floor is conservative screening guidance. Pair preferences do not encode benchmark-derived success rates. A small execution study with defined acceptance checks is required to compare first-pass correctness, completion time and total usage.
