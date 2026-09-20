# Fresh Jev v5 holdout and independent design critique

Frozen: `2026-09-20T08:45:40+00:00`. JSON SHA-256: `8e28391bd234aabceba773e7e52ec9e2e63f2d2b904f56c8fc18b53e4647c585`.

Twenty synthetic cases were authored before viewing v5 implementation or outputs: five easy, five intermediate, six demanding, and four materially incomplete requests. The proposed design and v4 aggregate results were known. No task execution or paid routing call was made. Expected pair labels are provisional.

## Evaluation contract

Evaluate decisions before pairs. JVH5-17–20 require `needs_context`; their preferred pairs are mandatory legacy-schema placeholders and must not count in pair-agreement scoring. The remaining 16 cases expect enough supplied context to route. An unnecessary review on one of those is a coverage/latency penalty, not proof of unsafe behavior.

The six demanding cases JVH5-11–16 require at least rank 3 provisionally, preventing an indiscriminately cheap policy from succeeding. Model ranks do not establish measured equivalence between effort levels. Preserve the expected set and record disagreement rather than moving labels to match output.

Controlled comparisons: 01/02 test unrelated historical difficulty; 10/12 test whether recent evidence establishes versus rejects a known fix; 03/15 test a supplied browser checklist versus designing verification. Compare exact packet/policy digests and the same compatible candidate pools.

## Frozen expectations

| Case    | Kind                                    | Decision      | Preferred hypothesis | Acceptable pairs                                                     |
| ------- | --------------------------------------- | ------------- | -------------------- | -------------------------------------------------------------------- |
| JVH5-01 | easy/copy-edit                          | route         | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVH5-02 | easy/irrelevant-history                 | route         | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVH5-03 | easy/browser-checklist                  | route         | Terra / low          | Luna / medium, Luna / high, Terra / low, Terra / medium              |
| JVH5-04 | easy/log-extraction                     | route         | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVH5-05 | easy/independent-child                  | route         | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVH5-06 | intermediate/review-notes               | route         | Terra / medium       | Terra / low, Terra / medium, Terra / high, Sol / low                 |
| JVH5-07 | intermediate/supplied-generator-pattern | route         | Terra / medium       | Terra / low, Terra / medium, Terra / high, Sol / low, Sol / medium   |
| JVH5-08 | intermediate/pure-helper-review         | route         | Terra / medium       | Luna / high, Terra / low, Terra / medium, Terra / high, Sol / low    |
| JVH5-09 | intermediate/browser-visual-adjustment  | route         | Terra / medium       | Terra / low, Terra / medium, Terra / high, Sol / low                 |
| JVH5-10 | intermediate/relevant-known-fix         | route         | Terra / medium       | Terra / low, Terra / medium, Terra / high, Sol / low                 |
| JVH5-11 | hard/cross-language-preset              | route         | Sol / high           | Sol / medium, Sol / high, Sol / xhigh, Astra / medium, Astra / high  |
| JVH5-12 | hard/relevant-rejected-fix              | route         | Sol / high           | Sol / medium, Sol / high, Sol / xhigh, Astra / medium, Astra / high  |
| JVH5-13 | hard/persistence-review                 | route         | Astra / medium       | Sol / high, Sol / xhigh, Astra / medium, Astra / high, Astra / xhigh |
| JVH5-14 | hard/swift-undo-state                   | route         | Sol / high           | Sol / high, Sol / xhigh, Astra / medium, Astra / high                |
| JVH5-15 | hard/browser-state-coverage             | route         | Sol / high           | Sol / medium, Sol / high, Astra / medium, Astra / high               |
| JVH5-16 | hard/independent-restoration-audit      | route         | Sol / high           | Sol / high, Sol / xhigh, Astra / medium, Astra / high                |
| JVH5-17 | ambiguous/missing-screenshot            | needs_context | Not scored           | Not applicable                                                       |
| JVH5-18 | ambiguous/unloaded-plan                 | needs_context | Not scored           | Not applicable                                                       |
| JVH5-19 | ambiguous/child-reference               | needs_context | Not scored           | Not applicable                                                       |
| JVH5-20 | ambiguous/missing-review-material       | needs_context | Not scored           | Not applicable                                                       |

## Independent critique of the proposed v5 policy

**The direction is sensible:** check task demands first, use a deterministic admissibility policy, and focus uncertainty handling on whether uncertain demands could change the safe choice. This is clearer than a global minimum of all confidence values. Exhaustive combinations can catch interactions that one-dimension-at-a-time checks miss.

**Lowest admissible is a policy preference, not an optimizer.** It is defensible as a provisional efficiency rule only if the gate positively establishes sufficiency. A capability floor derived from incomplete demand dimensions is a lower bound on modeled requirements, not a proof that the first pair at that bound can finish. It does not compare expected time, tool steps or rework. A stronger model at low effort and a weaker one at high effort are not fully ordered by capability rank then effort. Keep the pair table explicit and label it provisional.

**Do not discard the raw model proposal invisibly.** A higher proposal can reflect missed requirements or just a conservative classifier. During the pilot, record large proposal/floor disagreements and inspect a sample. Do not automatically grant the raw proposal veto power, which would restore overprovisioning, but keep the signal available to find missing dimensions and execution failures.

**Decision stability is conditional on the alternatives examined.** A fixed probability cutoff of 0.20 is uncalibrated: a consequential alternative at 0.19 disappears while one at 0.20 blocks routing. Several omitted alternatives can also carry substantial total mass. Treat the cutoff as an experiment, log the alternatives included/excluded, and measure its errors rather than naming stability a correctness guarantee. Materially missing context needs its own direct guard even if a classifier assigns it low probability.

**Cartesian enumeration is necessary for some interactions but can be overconservative.** Independently answered marginal questions can produce combinations that cannot jointly describe the task. Do not multiply their probabilities as if they were independent, or present the resulting set as a joint posterior. Start with a small transparent set of compatible scenarios and compare false reviews against missed stronger requirements. A high-consequence-plus-invariant combination should be an explicit regression; a logically incompatible combination should not create a permanent review trap.

**Only checking stronger alternatives is appropriate only if admissibility is monotone.** Dropping a requirement should not make the selected pair fail, but this must hold in the actual pair policy. More capability or effort is not always a strict operational superset: tool support, context access, hard latency constraints and model-specific options are separate compatibility facts. Evaluate them before semantic gates. Empty candidate sets and unsupported required efforts need explicit outcomes.

**Refine the scope of reporting without erasing necessary understanding.** A handoff can describe a difficult defect without diagnosing it. It still may need to reconcile contradictions, distinguish claims from observed evidence, or avoid certifying an untested conclusion. Separate reporting, evidence synthesis, independent validation and implementation. Similarly, a factual report can contain a demanding attribution/reconstruction problem even though it does not impose an operational invariant.

**Check all consumers of the new stability field.** The effective route should use one authoritative decision result. Ensure old confidence >= 0.5 checks do not reject an approved stable decision downstream, and that fallback paths do not execute a weak current pair after the gate calls for stronger capability or needs_context. Normal turns, independent children, guided review and evaluator statistics should agree. Preserve raw confidence as diagnostic data; explain that it is not the effective routing verdict.

**Useful gate acceptance checks:** known simple work stays cheap despite unrelated historical complexity; unresolved relevant evidence changes the chosen route; a possible stronger requirement changes the decision when it crosses the provisional boundary; irrelevant low confidence alone does not block; missing objective/material does; pair compatibility and user pins remain authoritative; and a mandatory hard-task subset cannot pass on a small pair.

A practical pilot should report three things separately: pair fit on complete packets, unnecessary-review frequency, and unsafe-small/unknown-context dispatches. Better label agreement with fewer reviews is encouraging, but actual first-pass correctness and total task usage still need controlled execution evidence.

## Full cases

### JVH5-01 — easy/copy-edit

**Request:** Use the new sentence in the empty search result.

**Expected:** `route`. A supplied literal and exact target make this a mechanical source edit. The executor still verifies the narrow diff.

**Contrast:** Reference member: compare with JVH5-02; unrelated prior work should not change the pair.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Make only the requested copy edit in the empty search result view.",
  "currentModel": "gpt-6-astra",
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
      "id": "target",
      "kind": "source_excerpt",
      "text": "SearchEmptyState.tsx renders <p>No matches were found.</p>. Replace that exact sentence with \"Try a different search.\". The heading, markup and styles stay as they are."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Inspect the resulting diff. No behavior change, new tests, localization work or independent UX review is requested."
    }
  ]
}
```

### JVH5-02 — easy/irrelevant-history

**Request:** Use the new sentence in the empty search result.

**Expected:** `route`. A supplied literal and exact target make this a mechanical source edit. The executor still verifies the narrow diff.

**Contrast:** Counterpart of JVH5-01: same current request and source; added historical difficulty is unrelated.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Make only the requested copy edit in the empty search result view.",
  "currentModel": "gpt-6-astra",
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
      "id": "target",
      "kind": "source_excerpt",
      "text": "SearchEmptyState.tsx renders <p>No matches were found.</p>. Replace that exact sentence with \"Try a different search.\". The heading, markup and styles stay as they are."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Inspect the resulting diff. No behavior change, new tests, localization work or independent UX review is requested."
    },
    {
      "id": "earlier-job",
      "kind": "unrelated_context",
      "text": "The completed calendar review required tracing asynchronous ownership and lost-update scenarios. None of those files is imported by SearchEmptyState.tsx."
    }
  ],
  "history": [
    {
      "role": "user",
      "text": "The earlier job was to review an offline calendar merge algorithm."
    },
    {
      "role": "assistant",
      "text": "That review is complete. We documented the event ordering and cancellation issues; the calendar changes are now out of scope."
    },
    {
      "role": "user",
      "text": "Next is the separate copy edit below."
    }
  ]
}
```

### JVH5-03 — easy/browser-checklist

**Request:** Check the filter panel behavior.

**Expected:** `route`. This is direct execution of a complete visible checklist. Browser interaction requires care but the reasoning and success criteria are established.

**Contrast:** Compare with JVH5-15: the same short request can require different verification work.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Execute only the saved browser checklist for the search filter panel; report the observations.",
  "currentModel": "gpt-6-astra",
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
      "id": "checklist",
      "kind": "test_plan",
      "text": "At /demo/search, open Filters, select category Books, press Reset, then close and reopen Filters. Expected: category returns to All and stays All after reopen. Record those two observations and one screenshot. The fixture and selectors are supplied; no code changes."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "If a step fails, report it and stop. Do not diagnose the cause, generalize to other panels, or expand the checklist."
    }
  ]
}
```

### JVH5-04 — easy/log-extraction

**Request:** List the failing suites and their assertion messages.

**Expected:** `route`. The requested facts are explicit in a short supplied log, and no diagnosis is requested.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Extract the requested information from the supplied focused-test output.",
  "currentModel": "gpt-6-astra",
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
      "id": "log",
      "kind": "test_output",
      "text": "PASS label-map.test.ts\nFAIL preset-import.test.ts — expected captionMode \"auto\", received \"manual\"\nPASS field-registration.test.ts\nFAIL tooltip-position.test.ts — expected top 16, received 24\nSummary: 2 failed, 2 passed."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Return suite name and assertion message only. Do not infer causes or change anything."
    }
  ]
}
```

### JVH5-05 — easy/independent-child

**Request:** Check that the patch applies the approved identifier everywhere in this function.

**Expected:** `route`. The child has a complete mechanical review task and no need for inherited parent history.

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "originalTask": "Independent child: inspect the supplied local rename only.",
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
      "id": "patch",
      "kind": "diff_excerpt",
      "text": "Inside resolveCaptionMode(), the local variable chosen is renamed resolvedMode in its declaration, the following if condition and the return statement. No property names, external exports or values change. The complete patch contains those three substitutions only."
    },
    {
      "id": "approved-name",
      "kind": "user_constraint",
      "text": "The approved identifier is resolvedMode. Report a missed occurrence if any; do not review the parent feature."
    }
  ]
}
```

### JVH5-06 — intermediate/review-notes

**Request:** Prepare a short handoff from these review notes.

**Expected:** `route`. The work is bounded synthesis of statuses and evidence. Describing an unresolved cache problem is not authorization to diagnose it.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Summarize the current patch status, remaining work and evidence for the next developer. Do not verify or fix the underlying issues.",
  "currentModel": "gpt-6-astra",
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
      "text": "N1 requests a caption default change; the source edit is present and its focused test passed. N2 questions cache invalidation after importing a preset; no fix has been attempted. N3 requests a narrow-screen screenshot; only a desktop screenshot exists."
    },
    {
      "id": "latest-update",
      "kind": "file_excerpt",
      "text": "The reviewer accepted N1 in the latest note. N2 remains open pending investigation. A teammate will capture the N3 screenshot tomorrow."
    },
    {
      "id": "output",
      "kind": "user_constraint",
      "text": "Write five bullets separating completed changes, unresolved questions and missing evidence. Do not turn the handoff into a correctness audit."
    }
  ]
}
```

### JVH5-07 — intermediate/supplied-generator-pattern

**Request:** Add the caption spacing control using the adjacent field as the pattern.

**Expected:** `route`. This is an established pattern with a few dependent generated outputs and focused verification. It needs implementation judgment but no unestablished ownership diagnosis.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Implement the new spacing control through the established metadata source and generator path.",
  "currentModel": "gpt-6-astra",
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
      "id": "pattern",
      "kind": "source_excerpt",
      "text": "The adjacent helpText field declares spacing under its typography group. The caption field uses the same component type and selector structure. The requested control has the same default and responsive behavior, with caption-specific names and selectors."
    },
    {
      "id": "procedure",
      "kind": "implementation_plan",
      "text": "Edit only the caption metadata source, run the supplied scoped generator and inspect TypeScript/PHP output. Existing tests cover serialization and responsive values; add the caption instance to those shared cases."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Do not alter selector ownership, reset semantics or the generator itself."
    }
  ]
}
```

### JVH5-08 — intermediate/pure-helper-review

**Request:** Check whether extracting this helper preserved the empty-input behavior.

**Expected:** `route`. The difference is local but requires semantic review of a meaningful edge case. The complete relevant before/after logic is available; a whole-system audit is unnecessary.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Review the supplied pure-function extraction and add a focused regression only if the behavior changed.",
  "currentModel": "gpt-6-astra",
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
      "id": "before",
      "kind": "source_excerpt",
      "text": "Before extraction: if values is undefined return inherited; otherwise filter out entries with enabled === false, then return the resulting array. An explicitly empty array therefore returns []."
    },
    {
      "id": "after",
      "kind": "source_excerpt",
      "text": "The caller now passes values to enabledValues(). The helper uses if (!values?.length) return inherited; otherwise it filters enabled === false. No I/O, caches or lifecycle state are involved."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Distinguish omitted input from an explicitly empty list. Keep the review to this behavior and explain the counterexample if there is one."
    }
  ]
}
```

### JVH5-09 — intermediate/browser-visual-adjustment

**Request:** Bring the help bubble back inside the preview at 480 pixels.

**Expected:** `route`. The evidence establishes the cause and an existing local solution. The task combines a bounded change with two concrete browser checks.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Correct the isolated tooltip overflow shown by the supplied browser evidence.",
  "currentModel": "gpt-6-astra",
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
      "id": "browser-evidence",
      "kind": "inspection_excerpt",
      "text": "At viewport width 480, the tooltip trigger is near the right edge. The bubble has width 220px and left:0 relative to the trigger; its measured right edge is 594px. Its parent is not clipped. The same component already supports a right-aligned variant on the adjacent settings button."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Reuse that existing alignment variant for this trigger. Check 480px and the existing 1280px layout. Do not redesign the tooltip or change shared positioning logic."
    }
  ]
}
```

### JVH5-10 — intermediate/relevant-known-fix

**Request:** Pick this up from the last notes and finish it.

**Expected:** `route`. Recent history supplies a reviewed, bounded fix and an exact failing regression. A continuation should inherit that known approach rather than the symptom wording alone.

**Contrast:** Contrast with JVH5-12: identical current prompt, objective and target, but history establishes different remaining work.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Ensure the preview displays the latest selected form after a rapid selection change.",
  "currentModel": "gpt-5.6-terra",
  "currentEffort": "medium",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "target",
      "kind": "source_map",
      "text": "The change is in PreviewSelector.tsx. A focused test already drives selection A then B and resolves the A request after B."
    }
  ],
  "history": [
    {
      "role": "user",
      "text": "We reproduced the stale display after selecting A and then B."
    },
    {
      "role": "assistant",
      "text": "The approved patch is to compare the completed request id against activeRequestId before setting the preview. The existing request ids already identify every selection; no new state or cancellation mechanism is needed. The focused test currently fails and should pass with that one guard."
    },
    {
      "role": "user",
      "text": "Apply that reviewed guard and rerun the focused test."
    }
  ]
}
```

### JVH5-11 — hard/cross-language-preset

**Request:** Make caption styling survive importing the preset in both rendered views.

**Expected:** `route`. The cause is not established and behavior crosses serialization, inherited values, generated metadata and renderer state. A local pattern match or generated-file patch is insufficient evidence.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Find and fix why an imported caption style differs between the editor and the server-rendered page.",
  "currentModel": "gpt-6-astra",
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
      "id": "observations",
      "kind": "bug_report",
      "text": "Freshly edited captions match in both views. After exporting and importing a preset, the editor shows the new caption color, while the frontend uses the previous value. A full page reload changes which value wins. Changing only the generated PHP default did not explain the discrepancy."
    },
    {
      "id": "paths",
      "kind": "source_map",
      "text": "Preset normalization can move a caption object under a group key. React resolves inherited values before emitting dynamic CSS. PHP builds declarations using the serialized group key and an import-time defaults cache. Generated metadata comes from the TypeScript source."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Trace value ownership through import, normalization and both renderers. Add the smallest regression that fails for the actual cause, regenerate affected outputs if needed, and check both rendered paths. Preserve unrelated dirty work."
    }
  ]
}
```

### JVH5-12 — hard/relevant-rejected-fix

**Request:** Pick this up from the last notes and finish it.

**Expected:** `route`. The relevant history invalidates the simple known fix and exposes interacting asynchronous ownership. The task remains executable because the objective and reproduction are supplied; it is not merely missing-context uncertainty.

**Contrast:** Contrast with JVH5-10: do not keep the same cheap continuation route when the latest evidence rejects the established approach.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Ensure the preview displays the latest selected form after a rapid selection change.",
  "currentModel": "gpt-5.6-terra",
  "currentEffort": "medium",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [
    {
      "id": "target",
      "kind": "source_map",
      "text": "The change is in PreviewSelector.tsx. A focused test already drives selection A then B and resolves the A request after B."
    }
  ],
  "history": [
    {
      "role": "user",
      "text": "We reproduced the stale display after selecting A and then B."
    },
    {
      "role": "assistant",
      "text": "The request-id guard passes the simple A/B test, but the preview still reverts after a preset import. Import starts a second loader and reuses the current selection id. Cleanup from the original loader can clear the replacement preview. We have not established which callback owns the final state."
    },
    {
      "role": "user",
      "text": "The first approach did not resolve the reported behavior. Investigate the import and selection interaction before proposing another change."
    }
  ]
}
```

### JVH5-13 — hard/persistence-review

**Request:** Review whether this save queue can acknowledge an edit that will be lost.

**Expected:** `route`. This is a consequential independent correctness review of durability and concurrent ownership. The problem is defined, but the required reasoning is not reduced to a supplied checklist.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Independently review the changed save queue before it replaces the current implementation. Do not implement a fix.",
  "currentModel": "gpt-6-astra",
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
      "id": "protocol",
      "kind": "source_summary",
      "text": "The UI considers an edit saved when the queue publishes ack(editId). The worker writes a batch to a temporary file, publishes all acknowledgements, then renames the file over the durable store. A retry can replay a batch after reconnecting. A second worker may resume a lease that expired while the first worker was paused."
    },
    {
      "id": "constraints",
      "kind": "acceptance",
      "text": "Find concrete loss, duplicate or stale-write scenarios across acknowledgement, rename, retry and lease ownership. Distinguish a source-confirmed flaw from a hypothetical risk and identify the checks needed to establish durability."
    },
    {
      "id": "available-material",
      "kind": "artifact_manifest",
      "text": "The queue implementation, file-store adapter, lease code and existing deterministic worker tests are available in the isolated checkout."
    }
  ]
}
```

### JVH5-14 — hard/swift-undo-state

**Request:** Fix the undo action restoring the wrong reminder after moving it between lists.

**Expected:** `route`. The cause must be confirmed across UI identity, persistence ordering, sync and undo history. The supplied reproduction supports investigation; it does not establish a safe mechanical patch.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Diagnose the incorrect undo target in the local reminder editor and preserve the current store.",
  "currentModel": "gpt-6-astra",
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
      "id": "reproduction",
      "kind": "bug_report",
      "text": "Move reminder R from Inbox to Work, edit its time, then undo twice. The UI restores the old time on another reminder if a sync update arrives between the two undos. With sync paused, the same sequence succeeds."
    },
    {
      "id": "implementation",
      "kind": "source_map",
      "text": "The view model stores undo closures over list positions. The persistence layer can reorder reminders on a sync merge. The editor keeps a selected object snapshot while the shared store replaces rows by stable ID. The two undo operations span both time and list changes."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Use the isolated fixture store. Determine the state ownership problem, make a narrow fix and verify the interleaving without touching live reminders. Preserve valid undo ordering and selection."
    }
  ]
}
```

### JVH5-15 — hard/browser-state-coverage

**Request:** Check the filter panel behavior.

**Expected:** `route`. The user needs a defensible behavioral review across state owners and entry points, including a verification design. Browser work is not automatically a fixed checklist.

**Contrast:** Counterpart of JVH5-03: identical short request with materially different actual scope.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Determine whether the filter panel maintains the chosen category across its supported entry and exit paths. Design focused checks from the current behavior; no complete checklist exists.",
  "currentModel": "gpt-6-astra",
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
      "id": "observations",
      "kind": "browser_evidence",
      "text": "Opening Filters from the toolbar preserves Books. Opening the same panel with its keyboard shortcut shows All. Closing with Escape and reopening can change the search result count without changing the visible category. Reset looks correct on a fresh load."
    },
    {
      "id": "state-paths",
      "kind": "source_map",
      "text": "The toolbar updates persistent search state. The keyboard command initializes local panel state. The mobile sheet shares the reset handler but mounts a separate panel instance. Debounced URL updates can arrive after a panel closes."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Trace the relevant transitions, choose checks that isolate the inconsistency, and report which supported paths are verified. Do not certify all paths from a single screenshot or expand to unrelated search features."
    }
  ]
}
```

### JVH5-16 — hard/independent-restoration-audit

**Request:** Determine which preserved patch contains the missing dialog work and how to restore only that work.

**Expected:** `route`. The child must reconstruct semantic work across overlapping artifacts while preserving unrelated current changes. Read-only planning still demands careful attribution and ordering.

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "originalTask": "Independent child: investigate the provided local recovery artifacts and produce a restoration plan. Do not change files or refs.",
  "currentModel": "gpt-5.6-terra",
  "currentEffort": "medium",
  "objectiveProvenance": "user_message",
  "historyCompleteness": "complete",
  "missingContext": [],
  "target": {
    "kind": "independent_child",
    "inheritedContext": "none"
  },
  "evidence": [
    {
      "id": "artifacts",
      "kind": "recovery_manifest",
      "text": "There are two exported patches and a detached snapshot. Patch A was created before a rebase and includes the dialog plus unrelated navigation changes. Patch B was generated after the rebase and contains only part of the dialog work. The detached snapshot includes uncommitted fixes absent from both patches."
    },
    {
      "id": "current-state",
      "kind": "git_summary",
      "text": "The current checkout already contains a newer navigation implementation and unrelated dirty edits. Several dialog paths were renamed during the rebase. Applying either patch wholesale would overwrite current work."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Compare content and path history, identify which hunks belong to the missing dialog behavior, and give a recoverable ordered plan with evidence. Mark ambiguities explicitly. The child has the artifact paths and checkout, but inherits no chat history."
    }
  ]
}
```

### JVH5-17 — ambiguous/missing-screenshot

**Request:** Match the spacing to what I marked in the image.

**Expected:** `needs_context`. The referenced task material is absent, so retrieve or clarify it before assessing executor capability. The preferred pair is solely a legacy-schema placeholder and must be excluded from pair scoring.

```json
{
  "existingSession": true,
  "hasAttachments": true,
  "interactionMode": "default",
  "currentModel": "gpt-5.6-luna",
  "currentEffort": "low",
  "objectiveProvenance": "unknown",
  "historyCompleteness": "missing",
  "missingContext": [
    "The attachment image is unavailable to the router and no annotation text was extracted.",
    "The target element and requested spacing change are not identified."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVH5-18 — ambiguous/unloaded-plan

**Request:** Go ahead with the second option.

**Expected:** `needs_context`. The referenced task material is absent, so retrieve or clarify it before assessing executor capability. The preferred pair is solely a legacy-schema placeholder and must be excluded from pair scoring.

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
    "The available page of the conversation does not contain the options or the decision being discussed.",
    "No accepted plan or original objective has been recovered."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": [],
  "history": [
    {
      "role": "assistant",
      "text": "Both approaches could work; the second has different tradeoffs."
    },
    {
      "role": "user",
      "text": "Let me think about it."
    }
  ]
}
```

### JVH5-19 — ambiguous/child-reference

**Request:** Check the issue in the file I mentioned earlier.

**Expected:** `needs_context`. The referenced task material is absent, so retrieve or clarify it before assessing executor capability. The preferred pair is solely a legacy-schema placeholder and must be excluded from pair scoring.

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
    "This independent child receives no inherited turns.",
    "Its message includes no filename, project, issue description or quoted earlier reference."
  ],
  "target": {
    "kind": "independent_child",
    "inheritedContext": "none"
  },
  "evidence": []
}
```

### JVH5-20 — ambiguous/missing-review-material

**Request:** Address the remaining reviewer points and keep the accepted changes.

**Expected:** `needs_context`. The referenced task material is absent, so retrieve or clarify it before assessing executor capability. The preferred pair is solely a legacy-schema placeholder and must be excluded from pair scoring.

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
    "The review thread or findings list is not supplied.",
    "The available history does not identify which changes were accepted or which points remain open."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```
