# Jev routing evaluation — first baseline

Policy: `2026-09-20.guided-assessment.v3`. Saved: 2026-09-20T07:13:41.972Z. Run through the desktop's existing encrypted-credential bridge. **No coding tasks were executed and expected answers were not sent to Jev.** One decision request per case; no retries or prompt tuning against these results.

[Research and cases](JEV_ROUTING_EVALUATION.md) · [Corpus JSON](JEV_ROUTING_EVALUATION.json) · [Raw results](JEV_ROUTING_RESULTS.json)

## Results

| Metric                                             | Result                 |
| -------------------------------------------------- | ---------------------- |
| Cases / valid recommendations                      | 56 / 56                |
| Exact preferred-pair agreement                     | 29/56 (51.8%)          |
| Within expected acceptable pairs                   | 41/56 (73.2%)          |
| Below the automatic 0.50 confidence guard          | 16/56                  |
| Acceptable among scores ≥0.50                      | 35/40                  |
| Acceptable among scores <0.50                      | 6/16                   |
| Reported Jev cost                                  | $0.007973784           |
| Estimated Jev cost                                 | $0.000000000           |
| Median / mean / maximum reported route latency     | 409.5 / 432.5 / 839 ms |
| Sum of reported route latency (not full wall time) | 24.22 s                |
| Input / output tokens reported by Jev              | 189,852 / 18,784       |

These are agreements with provisional model-fit labels, **not measured task accuracy, calibrated success probabilities, weekly savings, or a direct comparison with the old policy across the same corpus**. The corpus includes repeated task families; 56 cases are not 56 independent workload categories. Both development and held-out labels are now visible; this is a descriptive baseline, not a reusable untouched holdout.

## What stands out

- Simple user-authored commit lookup (001): Luna / low, confidence 0.95. Greeting (002): Luna / low, 0.97. These cases now behave as intended, unlike the earlier live examples with the old policy; contexts differ, so this is not a controlled A/B comparison.
- All 56 requests produced valid recommendations. Splitting model and effort avoided the earlier all-fallback experience, but 16 recommendations would still fall back in Automatic mode. Guided can review all 56.
- Of 15 cases outside the acceptable ranges, 8 chose a lower model tier than the preferred label, 6 chose different effort on the same model, and 1 chose a higher tier. This classification is relative to labels, not proof of underperformance or waste.
- Ambiguous Git-history reconstruction (012) is still treated too much like a simple lookup: Luna / low, 0.35. Model labels and examples need to distinguish retrieving a record from reconstructing conflicting history.
- Exactly-once guided dispatch implementation (027) selected Terra / high, 0.21, while the expected set starts with Sol. The separate uncertainty assessment correctly identified substantial uncertainty, but the model recommendation did not fully reflect it. Independent questions do not consume each other's answers; the application currently combines model and effort, while task/uncertainty are explanatory evidence.
- Failed recurrence fix (038) retained Sol / high at 0.32. The no-downgrade guard worked; it does not guarantee an escalation. Expected labels favored Astra or Sol xhigh.
- Missing-context continuation (045) selected Luna / low at 0.59 even though its uncertainty assessment said substantial. This illustrates why 0.50 is not a reliable production guarantee.
- Several effort-only mismatches (015,022,028) could instead reveal overly conservative labels. We should review them before declaring the router wrong. Cases044/045 intentionally have low-certainty labels.
- No case selected xhigh. That may be appropriate restraint or insufficient differentiation of exceptional-depth work; only execution evidence can resolve it.

**Recommendation:** keep Guided as the default, review these disagreements together, and defer automatic threshold tuning until the questions/labels have been reviewed. Do not simply raise confidence numbers or force the largest model.

## All cases

| Case    | Prompt                                                                                                                                      | Preferred      | Jev recommendation | Confidence | Acceptable | Automatic result |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------ | ---------: | ---------- | ---------------- |
| JEV-001 | What's the latest commit I made in this project?                                                                                            | Luna / low     | Luna / low         |       0.95 | yes        | Luna / low       |
| JEV-002 | hello                                                                                                                                       | Luna / low     | Luna / low         |       0.97 | yes        | Luna / low       |
| JEV-003 | Catch up on the dirty files describing the review findings and my work so far. Let me know once you are done.                               | Terra / medium | Luna / low         |       0.48 | review     | none             |
| JEV-004 | Update the local trackers with this commit and draft a concise reply to the reviewer.                                                       | Terra / medium | Terra / medium     |       0.39 | yes        | none             |
| JEV-005 | Should I rebuild Planner with Swift, or another stack, for a modern Mac app and later iPhone and Watch apps with shared core logic?         | Sol / high     | Astra / high       |       0.55 | yes        | Astra / high     |
| JEV-006 | Prepare a safe handoff of the Planner rebuild to another coding harness, preserving all work.                                               | Astra / high   | Sol / high         |       0.16 | yes        | none             |
| JEV-007 | Verify that forms with no Pro fields never show Pro field option groups.                                                                    | Sol / high     | Terra / medium     |       0.35 | review     | none             |
| JEV-008 | Learn how Jev could make our rule checks and PR audits faster and cheaper, and identify the useful applications.                            | Sol / high     | Terra / medium     |       0.33 | review     | none             |
| JEV-009 | Give me a morning brief with my calendar, important unread emails and anything that needs attention today.                                  | Terra / medium | Terra / low        |       0.34 | review     | none             |
| JEV-010 | Check whether I have any new GitHub peer review assignments since the last check.                                                           | Luna / medium  | Luna / low         |       0.90 | yes        | Luna / low       |
| JEV-011 | What branch is this checkout on, and is anything uncommitted?                                                                               | Luna / low     | Luna / low         |       0.99 | yes        | Luna / low       |
| JEV-012 | What was the last commit I made here before the broken migration, across the rebased branch and detached recovery worktree?                 | Sol / medium   | Luna / low         |       0.35 | review     | none             |
| JEV-013 | Summarize the last five commits in plain English.                                                                                           | Luna / low     | Luna / low         |       0.99 | yes        | Luna / low       |
| JEV-014 | Fix the typo in this option label from Bordr to Border.                                                                                     | Luna / low     | Luna / low         |       0.98 | yes        | Luna / low       |
| JEV-015 | Add the missing responsive flag to this field’s border settings, matching the sibling field.                                                | Luna / medium  | Luna / low         |       0.80 | review     | Luna / low       |
| JEV-016 | The responsive border setting works in the builder but is missing on the front end. Fix it.                                                 | Sol / high     | Sol / high         |       0.34 | yes        | none             |
| JEV-017 | Add regression coverage for the reset behavior we just fixed.                                                                               | Terra / medium | Terra / low        |       0.81 | yes        | Terra / low      |
| JEV-018 | Check whether this PHP declaration extraction changed behavior.                                                                             | Terra / high   | Sol / medium       |       0.28 | yes        | none             |
| JEV-019 | Why does this form duplicate event handlers after switching presets several times?                                                          | Astra / high   | Sol / high         |       0.81 | yes        | Sol / high       |
| JEV-020 | Run the existing six-case form QA checklist and record pass/fail with evidence.                                                             | Terra / medium | Terra / low        |       0.42 | yes        | none             |
| JEV-021 | Change this SwiftUI empty-state heading and explanatory sentence to the supplied copy.                                                      | Luna / low     | Luna / low         |       0.94 | yes        | Luna / low       |
| JEV-022 | Add a completed-task filter using the same view-model pattern as the existing overdue filter.                                               | Terra / medium | Terra / low        |       0.82 | review     | Terra / low      |
| JEV-023 | The app sometimes loses a rescheduled task when iCloud and EventKit update at the same time. Diagnose it and fix it.                        | Astra / high   | Astra / high       |       0.72 | yes        | Astra / high     |
| JEV-024 | Design a scheduler that remains consistent through DST, recurrence exceptions, travel time-zone changes, offline edits and two-device sync. | Astra / xhigh  | Astra / high       |       0.72 | yes        | Astra / high     |
| JEV-025 | Run the existing Planner isolated demo QA command and tell me whether it passed.                                                            | Luna / low     | Luna / low         |       0.56 | yes        | Luna / low       |
| JEV-026 | Add a routing mode preference with manual, automatic and guided options.                                                                    | Terra / medium | Terra / low        |       0.45 | review     | none             |
| JEV-027 | Implement guided routing so accepting or falling back submits exactly the pending message once.                                             | Sol / high     | Terra / high       |       0.21 | review     | none             |
| JEV-028 | Turn this Jev results JSON into a Markdown comparison table and summarize mismatches.                                                       | Luna / medium  | Luna / low         |       0.83 | review     | Luna / low       |
| JEV-029 | Figure out how to measure whether our routing actually extends my weekly allowance without causing more failed tasks.                       | Sol / high     | Terra / medium     |       0.35 | review     | none             |
| JEV-030 | Make this reviewer reply shorter and more natural.                                                                                          | Luna / low     | Luna / low         |       0.92 | yes        | Luna / low       |
| JEV-031 | Review this authentication change for cross-tenant data exposure before we ship.                                                            | Astra / high   | Sol / high         |       0.66 | yes        | Sol / high       |
| JEV-032 | Extract only the failing test names and assertion messages from this log.                                                                   | Luna / low     | Luna / low         |       0.98 | yes        | Luna / low       |
| JEV-033 | yes, implement it                                                                                                                           | Luna / low     | Luna / low         |       0.99 | yes        | Luna / low       |
| JEV-034 | yes, implement it                                                                                                                           | Astra / high   | Astra / high       |       0.86 | yes        | Astra / high     |
| JEV-035 | List every callback registration that references FieldDeclarations and return file and line number.                                         | Luna / low     | Luna / low         |       0.85 | yes        | Luna / low       |
| JEV-036 | Independently review whether our event log migration can lose writes during reconnection.                                                   | Astra / high   | Astra / high       |       0.52 | yes        | Astra / high     |
| JEV-037 | It still duplicates the event handler. Please fix the actual cause.                                                                         | Sol / high     | Sol / high         |       0.79 | yes        | Sol / high       |
| JEV-038 | The recurrence bug is still there even after the last fix.                                                                                  | Astra / high   | Sol / high         |       0.32 | review     | Sol / high       |
| JEV-039 | The command failed because node was not on PATH. Use the provided absolute path and rerun it.                                               | Luna / low     | Luna / low         |       0.98 | yes        | Luna / low       |
| JEV-040 | The API was down. Try the same read-only request now that service is restored.                                                              | Luna / low     | Luna / low         |       0.88 | yes        | Luna / low       |
| JEV-041 | I have very little weekly usage left. Fix the concurrent task-loss bug correctly.                                                           | Astra / high   | Astra / high       |       0.81 | yes        | Astra / high     |
| JEV-042 | I have plenty of weekly usage left. What branch is this checkout on?                                                                        | Luna / low     | Luna / low         |       1.00 | yes        | Luna / low       |
| JEV-043 | What branch is this checkout on?                                                                                                            | Luna / low     | Luna / low         |       0.96 | yes        | Luna / low       |
| JEV-044 | Fix the bug shown in the screenshot.                                                                                                        | Terra / medium | Astra / high       |       0.20 | review     | none             |
| JEV-045 | Do the next step.                                                                                                                           | Terra / medium | Luna / low         |       0.59 | review     | Luna / low       |
| JEV-046 | Summarize the three error messages in this log.                                                                                             | Luna / low     | Luna / low         |       1.00 | yes        | Luna / low       |
| JEV-047 | Convert these 200 rows from snake_case keys to camelCase, preserving values.                                                                | Luna / low     | Luna / low         |       0.98 | yes        | Luna / low       |
| JEV-048 | Implement the provided field-normalization decision table and check all branch combinations.                                                | Terra / high   | Terra / low        |       0.53 | review     | Terra / low      |
| JEV-049 | Find a counterexample to this proposed merge algorithm, or prove it preserves idempotence and ordering under retries.                       | Astra / xhigh  | Astra / high       |       0.67 | yes        | Astra / high     |
| JEV-050 | Review this 30-line pure helper for edge cases and fix any confirmed issue.                                                                 | Terra / medium | Terra / low        |       0.54 | yes        | Terra / low      |
| JEV-051 | I changed my mind: use a calmer blue for the badge.                                                                                         | Luna / low     | Luna / low         |       0.75 | yes        | Luna / low       |
| JEV-052 | Is the latest build green?                                                                                                                  | Luna / low     | Luna / low         |       0.93 | yes        | Luna / low       |
| JEV-053 | Is this safe to merge?                                                                                                                      | Astra / high   | Sol / high         |       0.43 | yes        | Astra / high     |
| JEV-054 | Rename this local variable to make its purpose clearer.                                                                                     | Luna / low     | Luna / low         |       0.87 | yes        | Luna / low       |
| JEV-055 | Plan the migration, but do not implement anything yet.                                                                                      | Astra / high   | Astra / high       |       0.71 | yes        | Astra / high     |
| JEV-056 | Run the supplied schema parser against the 56 routing cases and report only validation errors.                                              | Luna / low     | Luna / low         |       0.83 | yes        | Luna / low       |

## Disagreements to review

### JEV-003 — Catch up on the dirty files describing the review findings and my work so far. Let me know once you are done.

Jev: **Luna / low**, confidence 0.48. Expected: Terra / medium, Terra / high, Sol / low, Sol / medium. Label certainty: medium.

Label rationale: Reading several potentially inconsistent progress documents requires synthesis, but does not yet require solving every underlying code issue.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "Local review tracker documents describe completed, deferred and still-open findings. Inspect Git status and the relevant documents; summarize the current state without implementing or publishing."}

### JEV-007 — Verify that forms with no Pro fields never show Pro field option groups.

Jev: **Terra / medium**, confidence 0.35. Expected: Sol / high, Sol / medium, Astra / medium, Astra / high. Label certainty: medium.

Label rationale: Establishing a negative claim across metadata and UI states is integration diagnosis, despite the concise prompt.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "Investigate the existing Forminator/Divi issue with source and permitted focused verification. Existing explanation is unproven; compare field metadata, filtering and UI visibility across relevant form types."}

### JEV-008 — Learn how Jev could make our rule checks and PR audits faster and cheaper, and identify the useful applications.

Jev: **Terra / medium**, confidence 0.33. Expected: Sol / high, Sol / medium, Astra / medium, Astra / high. Label certainty: medium.

Label rationale: Needs source evaluation, product fit and a credible measurement design. Treat this as research rather than immediately building a classifier.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "The thread title asks about Typesafe/Jev for Divi rule checks and audits. Research vendor documentation, distinguish classification from code verification, and recommend a concrete evaluation plan. No integrations requested yet."}

### JEV-009 — Give me a morning brief with my calendar, important unread emails and anything that needs attention today.

Jev: **Terra / low**, confidence 0.34. Expected: Terra / medium, Terra / high, Sol / low, Sol / medium. Label certainty: medium.

Label rationale: Multiple sources and prioritization need sound judgment, with a bounded output and no external mutation.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "Read-only connected calendar and email tools are available. Use today’s dates and existing brief history to avoid resurfacing completed items. Summarize privately; do not send or modify anything."}

### JEV-012 — What was the last commit I made here before the broken migration, across the rebased branch and detached recovery worktree?

Jev: **Luna / low**, confidence 0.35. Expected: Sol / medium, Terra / high, Sol / high, Astra / medium. Label certainty: medium.

Label rationale: Similar wording to the simple commit question now requires reconstructing history and resolving ambiguity.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "Two identities, rewritten history and a detached recovery tree are present. The user wants attribution and ordering evidence, not merely HEAD. Do not modify refs."}

### JEV-015 — Add the missing responsive flag to this field’s border settings, matching the sibling field.

Jev: **Luna / low**, confidence 0.80. Expected: Luna / medium, Terra / low, Terra / medium. Label certainty: medium.

Label rationale: Execution of a known pattern with supplied generator instructions is much simpler than discovering metadata ownership.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "The parent supplied the exact source file, approved sibling pattern, expected generated outputs and scoped regeneration command. Make the bounded change and inspect the generated diff."}

### JEV-022 — Add a completed-task filter using the same view-model pattern as the existing overdue filter.

Jev: **Terra / low**, confidence 0.82. Expected: Terra / medium, Terra / high, Sol / low. Label certainty: high.

Label rationale: Contained implementation following an established pattern.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "The task model, predicate and UI pattern are known; one view model and one view need edits. Persistence format is unchanged. Add focused predicate coverage."}

### JEV-026 — Add a routing mode preference with manual, automatic and guided options.

Jev: **Terra / low**, confidence 0.45. Expected: Terra / medium, Terra / high, Sol / low. Label certainty: medium.

Label rationale: Straightforward implementation with a known pattern and bounded compatibility requirement.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "There is an existing persisted settings pattern. Scope is the schema and preference UI only; runtime dispatch integration is a separate task. Migration defaults are specified."}

### JEV-027 — Implement guided routing so accepting or falling back submits exactly the pending message once.

Jev: **Terra / high**, confidence 0.21. Expected: Sol / high, Astra / medium, Astra / high, Sol / xhigh. Label certainty: high.

Label rationale: Cross-component asynchronous state and externally visible dispatch correctness need a capable first pass.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "Integrate side-panel choice, composer edits, attachments, selected thread changes, cancellation and asynchronous router replies. Preserve remote and desktop behavior. The state machine must prevent stale acceptance and duplicate dispatch."}

### JEV-028 — Turn this Jev results JSON into a Markdown comparison table and summarize mismatches.

Jev: **Luna / low**, confidence 0.83. Expected: Luna / medium, Terra / low, Terra / medium. Label certainty: high.

Label rationale: Structured transformation with explicit metrics is bounded; honest interpretation matters but does not require frontier diagnosis.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "The schema and desired columns are specified. Compute preferred/acceptable agreement, route errors and latency from recorded values. Do not infer successful task completion or weekly savings."}

### JEV-029 — Figure out how to measure whether our routing actually extends my weekly allowance without causing more failed tasks.

Jev: **Terra / medium**, confidence 0.35. Expected: Sol / high, Astra / medium, Astra / high. Label certainty: high.

Label rationale: Measurement design and confounding variables require judgment; documentation alone does not establish savings.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "Design an evaluation that separates router agreement, first-pass success, rework, task latency, model token usage and account-wide usage. Research official current limits; cannot assume API prices equal subscription usage."}

### JEV-038 — The recurrence bug is still there even after the last fix.

Jev: **Sol / high**, confidence 0.32. Expected: Astra / high, Astra / xhigh, Sol / xhigh. Label certainty: high.

Label rationale: Maintain or strengthen capability while changing the failed diagnostic approach; the evidence supports Astra.

Context: {"existingSession": true, "hasAttachments": false, "interactionMode": "default", "originalTask": "Sol high proposed a fix that still loses one recurrence exception during offline conflict resolution. The defect is reproduced; prior approach failed.", "currentModel": "gpt-5.6-sol", "currentEffort": "high", "failure": {"unresolved": true, "model": "gpt-5.6-sol", "effort": "high", "signals": ["The exact recurrence-exception loss remains reproducible after the Sol high patch."]}}

### JEV-044 — Fix the bug shown in the screenshot.

Jev: **Astra / high**, confidence 0.20. Expected: Terra / medium, Terra / high, Sol / medium, Astra / medium. Label certainty: low.

Label rationale: Unknown content cannot justify a precise capability claim. This label is intentionally uncertain and should favor a guided review of the choice.

Context: {"existingSession": false, "hasAttachments": true, "interactionMode": "default", "originalTask": "A screenshot is attached but its pixels and extracted text were not included in the router context. No other description identifies the bug. The executor should inspect it before proposing a fix.", "omissions": ["Screenshot content is not available to the router."]}

### JEV-045 — Do the next step.

Jev: **Luna / low**, confidence 0.59. Expected: Terra / medium, Sol / medium, Astra / medium. Label certainty: low.

Label rationale: The right pick is underdetermined until context is recovered. Grade this chiefly as an uncertainty diagnostic, not hard capability truth.

Context: {"existingSession": true, "hasAttachments": false, "interactionMode": "default", "originalTask": "An existing thread is selected, but previous exchanges and active plan are unavailable to the router. Executor may recover them; do not invent the task.", "omissions": ["Original task and prior exchanges were omitted."]}

### JEV-048 — Implement the provided field-normalization decision table and check all branch combinations.

Jev: **Terra / low**, confidence 0.53. Expected: Terra / high, Terra / medium, Luna / high, Luna / xhigh, Sol / medium. Label certainty: medium.

Label rationale: Moderate capability with extra attention may suit dense specified logic; choosing a bigger model is not automatically necessary.

Context: {"existingSession": false, "hasAttachments": false, "interactionMode": "default", "originalTask": "A bounded pure function has ten inputs, exact precedence rules and a supplied 24-case decision table. No external I/O or architectural uncertainty."}

## Later controlled execution experiment — proposed, not run

The user proposed a small web project followed by roughly ten fixed iterations of varying difficulty: an initially ambiguous request, menu-color and header-text changes, then a few more demanding changes. Compare fixed Astra / medium with Jev-selected pairs through the same Codex CLI/harness.

Use identical repository snapshots and user messages, model/tool permissions, and verification criteria. Keep adaptive follow-up decisions documented, preserve failed attempts and rework, and compare final screenshots plus functional checks. Record task completion, first-pass success, wall time, all model input/output/reasoning/cache usage actually exposed, and router overhead. API-priced USD must be labeled a hypothetical equivalent using applicable model/cache prices, separate from real Jev charges and subscription allowance. Shared usage windows cannot attribute exact per-task allowance consumption. Set the small execution budget and finalize the protocol together before running either arm; this baseline incurred no such execution cost.

## Reproducibility

Candidate order in this run: Luna, Terra, Sol, Astra; efforts low, medium, high, xhigh, with unsupported failure downgrades filtered before sending. Synthetic corpus context went directly to the same desktop decision function; this does not test live-chat context extraction for every case. The companion CLI (`scripts/evaluate-jev.ts`) supports `--dry-run` and API-key environment/stdin input. The desktop evaluation UI reuses encrypted credential storage.

SHA-256 digests at the baseline:

- `apps/desktop/src/jev/assessment.ts`: `d94d59ded2fff630b8159ce9dddc9dd6e552e4f6f20e141b3ff324a040deedb8`
- `apps/desktop/src/jev/decision.ts`: `c4eb22dcfb37860b00518b179ded6990937cef53e3759c9d1defad4195518d1a`
- `packages/shared/src/jevRouting.ts`: `c22b5d4bae8d0a935a8d986c2fd9fb6e6c06cfb227abe00775f925bfaddac32c`
- `JEV_ROUTING_EVALUATION.json`: `b4f8f282ae230fa213550c5fd3a1d92ecbca4694a3b338bf66a5cda0b5951ed1`
- `JEV_ROUTING_RESULTS.json`: `aa379d84429fb581408bb7a3bd4d95bf9b1dedd1a2b1b45d40d400df5f1f4c26`
