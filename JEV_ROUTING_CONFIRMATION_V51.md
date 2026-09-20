# Fresh v5.1 confirmation corpus

Frozen: `2026-09-20T08:54:54+00:00`. JSON SHA-256: `528510dd3f662433b18040e5de90eec567148c438a39d26619da57f5e7e3e98a`.

Twelve new synthetic scenarios: four simple, four intermediate slots including one needs_context case, and four demanding tasks. No result files or current v5.1 implementation were inspected. The proposed selection rule was known. Labels are provisional independent judgments.

**Scoring:** 11 cases enter pair-fit statistics. JVC51-08 must be scored only for needs_context; its required preferred pair is a legacy-format placeholder. Report unnecessary review separately from unsafe underassignment, and model fit separately from effort fit.

## Expectations

| Case     | Scope                                   | Expected decision | Preferred hypothesis | Acceptable pairs                                                     |
| -------- | --------------------------------------- | ----------------- | -------------------- | -------------------------------------------------------------------- |
| JVC51-01 | simple/exact-import-order               | route             | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVC51-02 | simple/remove-debug-output              | route             | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVC51-03 | simple/browser-observation              | route             | Luna / medium        | Luna / low, Luna / medium, Terra / low, Terra / medium               |
| JVC51-04 | simple/independent-file-list            | route             | Luna / low           | Luna / low, Luna / medium, Terra / low                               |
| JVC51-05 | intermediate/responsive-rule-emitter    | route             | Terra / high         | Terra / medium, Terra / high, Sol / medium, Sol / high               |
| JVC51-06 | intermediate/rename-plan-validation     | route             | Terra / high         | Terra / high, Sol / medium, Sol / high                               |
| JVC51-07 | intermediate/cache-key-semantics        | route             | Terra / high         | Terra / medium, Terra / high, Sol / medium, Sol / high               |
| JVC51-08 | intermediate-slot/missing-configuration | needs_context     | Not scored           | Not applicable                                                       |
| JVC51-09 | hard/browser-keyboard-behavior          | route             | Sol / high           | Sol / high, Sol / xhigh, Astra / medium, Astra / high                |
| JVC51-10 | hard/shared-resource-ownership          | route             | Sol / high           | Sol / high, Sol / xhigh, Astra / medium, Astra / high                |
| JVC51-11 | hard/persisted-schema-transition        | route             | Astra / high         | Sol / high, Sol / xhigh, Astra / medium, Astra / high, Astra / xhigh |
| JVC51-12 | hard/project-boundary-review            | route             | Astra / high         | Sol / high, Sol / xhigh, Astra / medium, Astra / high, Astra / xhigh |

## Independent principle assessment

**The proposed correction addresses a real discarded signal.** First choosing an economical model allowed by the capability policy, then using the greater of its effort floor and its own conditional effort proposal, restores the distinction between sufficient capability and sufficient deliberation. The effort answer must be the answer conditioned on the model that will actually run, not the raw model proposal when those models differ.

**Keep selection inside the admissible candidate set.** Resolve the final effort to an actually supported pair that also satisfies any attributed failure floor. Do not construct an unsupported model/effort pair from an ordinal maximum and later silently substitute a weaker pair. If no supported pair can meet the requirements, return an explicit review/no-admissible result.

**Make uncertainty specific to the final selected model.** Check whether plausible alternatives in that model’s effort distribution require more effort than the final selected effort. Lower or equal alternatives do not by themselves invalidate the pair. This remains stability under a declared set of alternatives, not a calibrated assurance of success. Model-demand and missing-context uncertainty still need their separate guards.

**Label the confidence honestly.** When the capability floor raises effort above Jev’s answer, the answer’s confidence still describes Jev’s proposed effort, not confidence in the final chosen effort. Expose the selected model, conditional proposed effort, raw confidence, capability floor and final effort distinctly. Do not rename or reinterpret a score to make the policy pair appear more certain.

**The tradeoff remains unmeasured.** A smaller model at high effort may or may not be faster or use less total allowance than a stronger model at medium effort. The corrected rule is a transparent provisional policy, not an expected-cost optimizer. Preserve v5 outputs and compare changed selections before any outcome claims. Watch for conditional effort proposals importing irrelevant history or repeatedly selecting high effort for straightforward tasks.

Cases 05–07 test bounded but careful reasoning; cases 01–04 guard against blanket effort inflation; cases 09–12 prevent the economical rule from erasing capability needs. Actual execution with acceptance checks is still needed to validate the hypotheses.

## Full cases

### JVC51-01 — simple/exact-import-order

**Request:** Put these imports in the agreed order.

**Expected:** `route`. This is an exact transformation of three supplied lines under an explicit ordering rule.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Reorder the three supplied imports without changing their contents.",
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
      "id": "source",
      "kind": "code_excerpt",
      "text": "import { Card } from \"./Card\";\nimport type { Entry } from \"./types\";\nimport { useMemo } from \"react\";"
    },
    {
      "id": "rule",
      "kind": "user_constraint",
      "text": "Order: external value imports, local type imports, local value imports. Preserve every imported name and path. Inspect the diff; no other cleanup."
    }
  ]
}
```

### JVC51-02 — simple/remove-debug-output

**Request:** Remove the leftover debug print from this handler.

**Expected:** `route`. The target and intended edit are completely specified; there is no request to diagnose the handler.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Delete only the identified diagnostic statement.",
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
      "id": "source",
      "kind": "code_excerpt",
      "text": "function onOpen(id: string) { console.debug(\"panel-open\", id); setOpenPanel(id); }"
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "The console.debug statement is the sole requested removal. Retain setOpenPanel(id) and do not change handler behavior or add logging elsewhere."
    }
  ]
}
```

### JVC51-03 — simple/browser-observation

**Request:** Confirm the saved demo shows the updated save label.

**Expected:** `route`. The browser action and assertion are supplied. Some tool interaction is necessary, but the work does not require designing coverage or diagnosing a mismatch.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Perform one existing browser observation in the isolated saved demo.",
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
      "id": "fixture",
      "kind": "test_plan",
      "text": "Open /fixtures/profile-editor. The supplied locator [data-testid=\"save-profile\"] identifies one visible enabled button. Its expected text is \"Save profile\". Record its text and capture one screenshot."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Only verify this text on the named fixture. Report a mismatch if present; do not inspect other pages or change source."
    }
  ]
}
```

### JVC51-04 — simple/independent-file-list

**Request:** Return the filenames that appear only in the second list.

**Expected:** `route`. This independent child has a self-contained exact set difference and a directly checkable output.

```json
{
  "existingSession": false,
  "hasAttachments": false,
  "interactionMode": "subagent",
  "originalTask": "Independent child: compare these two supplied lists exactly.",
  "currentModel": "gpt-5.6-sol",
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
      "id": "first",
      "kind": "list",
      "text": "caption.ts\nspacing.ts\npreview.ts"
    },
    {
      "id": "second",
      "kind": "list",
      "text": "caption.ts\nspacing.ts\npreview.ts\nlabel.ts\nhelp-text.ts"
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Return exact filenames only. Do not inspect file contents or infer whether the additions are correct."
    }
  ]
}
```

### JVC51-05 — intermediate/responsive-rule-emitter

**Request:** Implement the responsive visibility rule table in the existing helper.

**Expected:** `route`. The approach and scope are established, while chained inheritance and rule suppression require careful branch coverage. Terra high is a provisional effort preference, not a claim that Sol capability is mandatory.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Extend a pure CSS-rule emitter according to the supplied table; use the existing helper interface.",
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
      "id": "contract",
      "kind": "spec_excerpt",
      "text": "Inputs: desktop, tablet and phone are each show, hide or inherit; output is a list of min/max-width rules in desktop-to-phone order. Tablet inherit resolves from desktop. Phone inherit resolves from the resolved tablet value. Desktop inherit means show. Emit a breakpoint rule only when its resolved value differs from the preceding effective value."
    },
    {
      "id": "edge-cases",
      "kind": "test_table",
      "text": "Required cases include all inherit; hide/inherit/inherit; hide/show/inherit; show/hide/show; show/inherit/hide; hide/inherit/show; and explicit values that equal inherited values. The existing helper coalesces adjacent identical declarations and keeps caller-supplied selectors unchanged."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Preserve output ordering and avoid redundant or contradictory rules. Add focused table-driven coverage and inspect the generated CSS strings. No browser layout redesign or generator changes."
    }
  ]
}
```

### JVC51-06 — intermediate/rename-plan-validation

**Request:** Build the dry-run filename plan using these rules.

**Expected:** `route`. This is bounded implementation of explicit rules, but normalization, collision checks and rename cycles interact. It warrants more effort on a capable mid-tier model rather than treating the operation as a simple text replacement.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Implement a pure rename planner for supplied local filenames. Produce a plan and validation errors without touching the filesystem.",
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
      "id": "rules",
      "kind": "spec_excerpt",
      "text": "Normalize Unicode to NFC, trim leading/trailing spaces, replace runs of internal spaces with one hyphen, and preserve the final extension. Compare resulting names case-insensitively for collisions. Reject names that become empty, reserved names CON/PRN/AUX/NUL, a name with a path separator, and a target already occupied by a file outside the rename set."
    },
    {
      "id": "ordering",
      "kind": "spec_excerpt",
      "text": "Swapping two existing names is allowed only if the plan includes unique temporary names first. A case-only rename also needs a temporary name. Temporary names must not collide with existing or planned names. A validation error returns no executable operations for the whole batch."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "The current parser already provides the input filenames and occupied-name set. Follow the existing Result type, add tests for collisions and cycles, and return a dry-run description. Do not perform actual renames."
    }
  ]
}
```

### JVC51-07 — intermediate/cache-key-semantics

**Request:** Add regression coverage for the cache-key normalization contract.

**Expected:** `route`. The task has a known pure-function contract with several distinctions that weak tests could miss. Additional reasoning effort can improve branch and interaction coverage without automatically requiring the largest model.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Write tests for a pure cache-key builder against the supplied semantics. The implementation exists; report any disagreement without changing it.",
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
      "id": "contract",
      "kind": "spec_excerpt",
      "text": "A missing locale uses the tenant default. An explicit null locale means locale-independent and differs from missing. An empty locale string is invalid. Object-key order is irrelevant, but array order is significant. Numbers and numeric strings differ. Unset optional flags are omitted; explicit false flags remain. Nested undefined object values are omitted, while undefined array entries are represented by a position-preserving marker."
    },
    {
      "id": "test-interface",
      "kind": "source_map",
      "text": "Use buildKey(tenantId, request) and the current unit-test runner. Compare semantic equality/inequality between keys rather than relying only on snapshots of an encoded string."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Choose cases that distinguish the specified branches and their combinations. Include repeated calls to check determinism. No network, filesystem or cache eviction behavior is in scope."
    }
  ]
}
```

### JVC51-08 — intermediate-slot/missing-configuration

**Request:** Apply the settings from the configuration I uploaded yesterday.

**Expected:** `needs_context`. The requested configuration and target are unidentified. Recover them or clarify before choosing an executor. This preferred pair is only a legacy-schema placeholder and must not be pair-scored.

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
    "The configuration uploaded yesterday is not present in the current packet or identified by a recoverable file path.",
    "The available messages do not identify the target environment or which settings should be copied."
  ],
  "target": {
    "kind": "turn",
    "inheritedContext": "full"
  },
  "evidence": []
}
```

### JVC51-09 — hard/browser-keyboard-behavior

**Request:** Fix keyboard selection in the radio group after returning with browser Back.

**Expected:** `route`. The agent must diagnose disagreement among restored values, focus state and event ownership, then verify the relevant browser interactions. No established fix is supplied.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Diagnose and correct the radio group state after client-side history navigation.",
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
      "id": "reproduction",
      "kind": "browser_report",
      "text": "On the preferences route, choose the second radio option, navigate to another route, and use browser Back. The second option remains visually selected, but the first option receives the tab stop. ArrowRight sometimes changes the visual selection without changing the submitted value. Reloading the page restores normal behavior."
    },
    {
      "id": "paths",
      "kind": "source_map",
      "text": "The route restores serialized form values. A roving-tabindex hook tracks a separate active index. A plugin also handles arrow keys on a persistent container, and the route component remounts its individual inputs. The defect is observed only after history restoration."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Identify the ownership/lifecycle cause and verify mouse selection, keyboard movement, focus entry and submitted value after history navigation. Keep native radio semantics and avoid duplicate event handling."
    }
  ]
}
```

### JVC51-10 — hard/shared-resource-ownership

**Request:** Check whether removing one module can break the other module’s embedded preview.

**Expected:** `route`. The review requires reasoning about shared ownership and asynchronous cleanup across server and client loading paths. It is not merely confirming whether a script handle is present.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Review the preview resource cleanup across two instances and identify any concrete defect. Do not implement a fix yet.",
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
      "id": "setup",
      "kind": "architecture_excerpt",
      "text": "Two modules on the page can request the same third-party script and stylesheet. The server enqueue path assigns stable handles. The client preview loader deduplicates requests using a URL cache. Each module cleanup removes elements carrying its own instance marker; the first requester creates the shared script before the second instance mounts."
    },
    {
      "id": "observations",
      "kind": "browser_report",
      "text": "Deleting the first module sometimes removes styles from the second. A failed script request can be retried after one instance unmounts. When a delayed load finishes, its callback may run after the creating instance has been replaced."
    },
    {
      "id": "acceptance",
      "kind": "user_constraint",
      "text": "Trace ownership across successful load, failed load, retry, replacement and cleanup. Distinguish module-owned nodes from shared resources and identify which transitions need focused verification. A single two-module initial-load check is insufficient."
    }
  ]
}
```

### JVC51-11 — hard/persisted-schema-transition

**Request:** Design the transition to the new field identifiers without breaking saved presets.

**Expected:** `route`. The design combines forward/backward compatibility, ambiguous persisted data, concurrent client generations and rollback. A complete plan requires interacting reasoning rather than executing a known rename recipe.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Produce a compatibility and rollback design for renaming persisted field identifiers across current and older clients. No implementation is requested.",
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
      "id": "current-state",
      "kind": "schema_excerpt",
      "text": "Existing presets use field IDs like helperText. New clients should write assistanceText. Older clients remain supported and can load, edit and resave presets after new clients have touched them. The import/export format and PHP renderer both read the IDs. Some stored records already contain both keys with different values due to an earlier partial experiment."
    },
    {
      "id": "constraints",
      "kind": "user_constraint",
      "text": "Preserve user edits, prevent an older resave from dropping the new value, and define deterministic precedence for dual-key records. A rollback must still read records written during the transition. Explain the migration, compatibility window and verification needed; do not assume all clients upgrade together."
    },
    {
      "id": "available-material",
      "kind": "artifact_manifest",
      "text": "The serializer, importer, old and new field maps, PHP reader and representative saved records are available. The existing preset version number does not distinguish the partial experiment."
    }
  ]
}
```

### JVC51-12 — hard/project-boundary-review

**Request:** Review whether the preview asset endpoint respects the selected project boundary.

**Expected:** `route`. The requested review concerns security boundaries across authorization state, caching, filesystem resolution and concurrent reconfiguration. It needs a capable independent review; syntactic path checks alone cannot establish correctness.

```json
{
  "existingSession": true,
  "hasAttachments": false,
  "interactionMode": "default",
  "originalTask": "Independently assess the changed local preview asset endpoint for unauthorized file exposure. Report source-backed findings and targeted verification ideas; do not read real private files.",
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
      "id": "flow",
      "kind": "source_summary",
      "text": "The browser requests an asset with an environment ID, project ID and relative path. The server resolves the project record, joins the path to its configured root, and serves cached file contents. A shared cache currently uses normalized path and provider instance but not project ID. Projects may contain symlinks; a project root can change while a request is waiting for filesystem I/O."
    },
    {
      "id": "permissions",
      "kind": "policy_excerpt",
      "text": "A connected client may access only projects granted to that connection in the selected environment. The same provider instance may serve two projects with different grants. Revocation must prevent later reads even when a cache entry exists. Symlinks outside the granted root are not permitted."
    },
    {
      "id": "scope",
      "kind": "user_constraint",
      "text": "Review the authorization, cache and path-resolution ordering together, including reconfiguration/revocation races. Use synthetic fixtures for any proof. Separate confirmed bypasses from uncertain hypotheses, and do not retrieve credentials or personal files."
    }
  ]
}
```
