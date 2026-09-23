// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { CodexLedgerService, layerForHome } from "./CodexLedgerService.ts";
import { CODEX_STANDARD_RATE_SNAPSHOT } from "./codexLedgerPricing.ts";

const at = "2026-09-20T10:00:00.000Z";
const row = (type: string, payload: object) =>
  JSON.stringify({ type, timestamp: at, payload }) + "\n";
const receipt = (id: string, input: number) =>
  row("token_usage_record", {
    response_id: id,
    thread_id: "codex-thread",
    turn_id: "codex-turn",
    root_turn_id: "codex-turn",
    usage: {
      input_tokens: input,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 3,
      reasoning_output_tokens: 1,
      total_tokens: input + 3,
    },
    turn_token_usage: {
      input_tokens: input,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 3,
      reasoning_output_tokens: 1,
      total_tokens: input + 3,
    },
  });

it.effect("moves the bundled rate selection to v2 and reprices existing responses", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-rate-upgrade-")),
    );
    try {
      const dir = NodePath.join(home, "sessions", "2026", "09", "20");
      yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "rollout.jsonl"),
          row("session_meta", { id: "rate-upgrade-thread" }) +
            row("event_msg", { type: "task_started", turn_id: "turn" }) +
            row("turn_context", { turn_id: "turn", model: "gpt-6-sol" }) +
            row("token_usage_record", {
              ...(JSON.parse(receipt("rate-upgrade-response", 10)) as { payload: object }).payload,
              model: "gpt-6-sol",
            }),
        ),
      );
      const db = NodePath.join(home, "state.sqlite");
      const dbLayer = NodeSqliteClient.layer({ filename: db });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provide(
            layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
          ),
        );
      const initial = yield* run(
        Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const summary = yield* ledger.getSummary();
          const snapshots = yield* ledger.listRateSnapshots();
          return { summary, snapshots };
        }),
      );
      assert.equal(initial.summary.responseCount, 1);
      assert.equal(initial.summary.valuation.unpricedResponseCount, 0);
      assert.equal(
        initial.snapshots.items.find((item) => item.active)?.snapshotId,
        CODEX_STANDARD_RATE_SNAPSHOT.id,
      );

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const previousId = "openai-standard-scenario-2026-09-20-v1";
        yield* sql`INSERT INTO codex_ledger_rate_snapshots
          (snapshot_id,captured_at,source_url,rules_json,calculation_version)
          VALUES(${previousId},'2026-09-20','https://developers.openai.com/api/docs/pricing',
            ${JSON.stringify({ ...CODEX_STANDARD_RATE_SNAPSHOT, id: previousId })},'1')`;
        yield* sql`UPDATE codex_ledger_settings SET active_snapshot_id=${previousId} WHERE id=1`;
        yield* sql`INSERT INTO codex_ledger_valuations
          (source_domain,response_id,valuation_id,snapshot_id,estimate_kind,components_json,total_usd,missing_reasons_json,created_at)
          SELECT source_domain,response_id,'capture-v1',${previousId},estimate_kind,
            components_json,'999',missing_reasons_json,created_at
          FROM codex_ledger_valuations WHERE valuation_id=${`scenario:${CODEX_STANDARD_RATE_SNAPSHOT.id}`}`;
        yield* sql`DELETE FROM codex_ledger_valuations
          WHERE valuation_id=${`scenario:${CODEX_STANDARD_RATE_SNAPSHOT.id}`}`;
      }).pipe(Effect.provide(dbLayer));

      const upgraded = yield* run(
        Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const summary = yield* ledger.getSummary();
          const snapshots = yield* ledger.listRateSnapshots();
          const sql = yield* SqlClient.SqlClient;
          const valuations = yield* sql`SELECT valuation_id,snapshot_id,total_usd
            FROM codex_ledger_valuations WHERE response_id='rate-upgrade-response'`;
          return { summary, snapshots, valuations };
        }),
      );
      assert.equal(upgraded.summary.valuation.unpricedResponseCount, 0);
      assert.equal(
        upgraded.snapshots.items.find((item) => item.active)?.snapshotId,
        CODEX_STANDARD_RATE_SNAPSHOT.id,
      );
      assert.equal(
        upgraded.valuations.find(
          (item) => item.valuation_id === `scenario:${CODEX_STANDARD_RATE_SNAPSHOT.id}`,
        )?.total_usd,
        "0.00005",
      );
      assert.equal(
        upgraded.valuations.find(
          (item) => item.valuation_id === "scenario:openai-standard-scenario-2026-09-20-v1",
        )?.total_usd,
        "999",
      );
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);

it.effect("links a Jev child receipt after its transcript and spawn edge arrive", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-late-child-")),
    );
    try {
      const db = NodePath.join(home, "state.sqlite");
      const dbLayer = NodeSqliteClient.layer({ filename: db });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const serviceLayer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
      yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.recordJevReceipt({
          requestId: "early-child",
          attemptId: "route",
          rootTurnId: null,
          toolUseId: "spawn-late",
          environmentId: null,
          projectId: null,
          threadId: null,
          messageId: null,
          turnId: null,
          providerThreadId: null,
          providerTurnId: null,
          childProviderThreadId: null,
          parentProviderTurnId: null,
          dispatchId: null,
          observedModel: null,
          sourceScope: "subagent",
          decisionJson: "{}",
          dispatchJson: null,
          reportedCostUsd: "0.006",
          estimatedCostUsd: null,
          status: "completed",
        });
      }).pipe(Effect.provide(serviceLayer));
      const dir = NodePath.join(home, "sessions", "2026", "09", "20");
      yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "parent.jsonl"),
          row("session_meta", { id: "parent-thread" }) +
            row("event_msg", { type: "task_started", turn_id: "parent-turn" }) +
            row("turn_context", {
              turn_id: "parent-turn",
              root_turn_id: "parent-turn",
              model: "gpt-5.6-luna",
            }) +
            row("response_item", {
              type: "function_call",
              call_id: "spawn-late",
              name: "functions.collaboration.spawn_agent",
            }) +
            row("response_item", {
              type: "function_call_output",
              call_id: "spawn-late",
              output: '{"task_name":"/root/late"}',
            }) +
            receipt("parent-response", 10),
        ),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "child.jsonl"),
          row("session_meta", {
            id: "late-child-thread",
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: "parent-thread",
                  agent_path: "/root/late",
                },
              },
            },
          }),
        ),
      );
      const linked = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.getSummary();
        const sql = yield* SqlClient.SqlClient;
        return yield* sql`SELECT root_turn_id,identity_json FROM codex_ledger_jev_receipts
          WHERE request_id='early-child'`;
      }).pipe(Effect.provide(serviceLayer));
      assert.equal(linked[0]?.root_turn_id, "parent-turn");
      const identity = JSON.parse(String(linked[0]?.identity_json)) as {
        sourceDomain?: string;
        childProviderThreadId?: string;
      };
      assert.match(identity.sourceDomain ?? "", /^source:/);
      assert.equal(identity.childProviderThreadId, "late-child-thread");
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);

it.effect(
  "persists exact Codex receipts, replay identity, pagination, quota and capture state",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-service-")),
      );
      try {
        const dir = NodePath.join(home, "sessions", "2026", "09", "20");
        yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
        const transcript = NodePath.join(dir, "rollout.jsonl");
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            transcript,
            row("session_meta", {
              id: "codex-thread",
              cli_version: "0.155.0",
              thread_source: "cli",
            }) +
              row("event_msg", { type: "task_started", turn_id: "codex-turn" }) +
              row("turn_context", {
                turn_id: "codex-turn",
                root_turn_id: "codex-turn",
                model: "gpt-5.6-luna",
                effort: "medium",
              }) +
              row("response_item", {
                type: "function_call",
                call_id: "spawn-1",
                name: "functions.collaboration.spawn_agent",
              }) +
              row("response_item", {
                type: "function_call_output",
                call_id: "spawn-1",
                output: '{"task_name":"/root/review"}',
              }) +
              receipt("response-1", 10) +
              row("event_msg", {
                type: "token_count",
                rate_limits: {
                  limit_id: "weekly",
                  plan_type: "pro",
                  primary: { used_percent: 34, window_minutes: 10080, resets_at: 1790000000 },
                },
              }) +
              row("event_msg", { type: "task_complete", turn_id: "codex-turn" }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(dir, "child.jsonl"),
            row("session_meta", {
              id: "child-thread",
              source: {
                subagent: {
                  thread_spawn: {
                    parent_thread_id: "codex-thread",
                    agent_path: "/root/review",
                  },
                },
              },
            }),
          ),
        );
        const db = NodePath.join(home, "state.sqlite");
        const dbLayer = NodeSqliteClient.layer({ filename: db });
        yield* runMigrations().pipe(Effect.provide(dbLayer));
        yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.recordJevReceipt({
            requestId: "early-main",
            attemptId: "route",
            rootTurnId: null,
            toolUseId: null,
            environmentId: null,
            projectId: null,
            threadId: "t3-thread",
            messageId: "t3-message",
            turnId: null,
            providerThreadId: null,
            providerTurnId: null,
            childProviderThreadId: null,
            parentProviderTurnId: null,
            dispatchId: null,
            observedModel: null,
            sourceScope: "turn",
            decisionJson: '{"model":"gpt-5.6-luna"}',
            dispatchJson: null,
            reportedCostUsd: "0.004",
            estimatedCostUsd: null,
            status: "completed",
          });
        }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO projection_thread_sessions(thread_id,status,provider_name,provider_thread_id,updated_at)
        VALUES('t3-thread','ready','codex','codex-thread',${at})`;
          yield* sql`INSERT INTO projection_turns(thread_id,turn_id,pending_message_id,state,requested_at,checkpoint_files_json)
        VALUES('t3-thread','codex-turn','t3-message','completed',${at},'[]')`;
        }).pipe(Effect.provide(dbLayer));
        const serviceLayer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
        const first = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const summary = yield* ledger.getSummary();
          const turns = yield* ledger.listTurns({ limit: 1 });
          const quota = yield* ledger.listQuota({});
          const detail = yield* ledger.getTurn({
            sourceDomain: turns.items[0]!.identity.sourceDomain,
            codexThreadId: "codex-thread",
            codexTurnId: "codex-turn",
          });
          return { summary, turns, quota, detail };
        }).pipe(Effect.provide(serviceLayer));
        assert.equal(first.summary.responseCount, 1);
        assert.equal(first.summary.tokens.processedTokens, 13);
        assert.equal(first.summary.valuation.unpricedResponseCount, 0);
        assert.equal(first.turns.items[0]?.coverage.usage, "exact");
        assert.equal(first.turns.items[0]?.identity.t3ThreadId, "t3-thread");
        assert.equal(first.turns.items[0]?.identity.t3TurnId, "codex-turn");
        assert.equal(first.detail?.responses[0]?.responseId, "response-1");
        assert.equal(first.quota.items[0]?.bucketId, "weekly");
        const rebound = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql`SELECT root_turn_id,identity_json FROM codex_ledger_jev_receipts WHERE request_id='early-main'`;
        }).pipe(Effect.provide(dbLayer));
        assert.equal(rebound[0]?.root_turn_id, "codex-turn");
        const reboundIdentity = JSON.parse(String(rebound[0]?.identity_json)) as {
          sourceDomain?: string;
          providerThreadId?: string;
          providerTurnId?: string;
        };
        assert.equal(reboundIdentity.sourceDomain, first.turns.items[0]?.identity.sourceDomain);
        assert.equal(reboundIdentity.providerThreadId, "codex-thread");
        assert.equal(reboundIdentity.providerTurnId, "codex-turn");

        const scenarios = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const sourceDomain = first.turns.items[0]!.identity.sourceDomain;
          const override = {
            ...CODEX_STANDARD_RATE_SNAPSHOT,
            id: "test-luna-override",
            models: {
              ...CODEX_STANDARD_RATE_SNAPSHOT.models,
              "gpt-5.6-luna": {
                ...CODEX_STANDARD_RATE_SNAPSHOT.models["gpt-5.6-luna"]!,
                ordinaryInput: "0.4",
              },
            },
          };
          yield* ledger.createRateSnapshot({
            snapshotId: override.id,
            rulesJson: JSON.stringify(override),
          });
          yield* ledger.selectRateSnapshot(override.id);
          const changed = yield* ledger.getSummary();
          yield* ledger.upsertExperiment({
            experimentId: "exp-1",
            name: "Paired pilot",
            manifestJson: JSON.stringify({
              taskCorpus: "case-a",
              acceptanceChecks: ["passes tests"],
              rateSnapshotId: override.id,
            }),
          });
          yield* ledger.upsertRun({
            runId: "run-1",
            experimentId: "exp-1",
            caseId: "case-a",
            cohort: "baseline",
            sourceDomain,
            rootTurnId: "codex-turn",
            status: "failed",
            metadataJson: "{}",
            outcomeJson: JSON.stringify({ qualityAccepted: false }),
          });
          yield* ledger.upsertRun({
            runId: "run-2",
            experimentId: "exp-1",
            caseId: "case-a",
            cohort: "baseline",
            sourceDomain: null,
            rootTurnId: null,
            status: "accepted",
            metadataJson: "{}",
            outcomeJson: JSON.stringify({ qualityAccepted: true }),
          });
          const report = yield* ledger.getExperiment("exp-1");
          yield* ledger.selectRateSnapshot(CODEX_STANDARD_RATE_SNAPSHOT.id);
          const reverted = yield* ledger.getSummary();
          yield* ledger.upsertExperiment({
            experimentId: "exp-2",
            name: "Coverage pilot",
            manifestJson: JSON.stringify({
              taskCorpus: "case-a",
              acceptanceChecks: ["passes tests"],
              rateSnapshotId: CODEX_STANDARD_RATE_SNAPSHOT.id,
            }),
          });
          yield* ledger.upsertRun({
            runId: "run-3",
            experimentId: "exp-2",
            caseId: "case-a",
            cohort: "baseline",
            sourceDomain,
            rootTurnId: "codex-turn",
            status: "accepted",
            metadataJson: JSON.stringify({
              jevEnabled: false,
              rootTurns: [
                { sourceDomain, rootTurnId: "codex-turn" },
                { sourceDomain, rootTurnId: "codex-turn" },
              ],
            }),
            outcomeJson: JSON.stringify({ qualityAccepted: true }),
          });
          const duplicateRoots = yield* ledger.getExperiment("exp-2");
          const list = yield* ledger.listRateSnapshots();
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO codex_ledger_jev_receipts
            (request_id,attempt_id,root_turn_id,tool_use_id,identity_json,decision_json,dispatch_json,
              reported_cost_usd,estimated_cost_usd,status,created_at)
            VALUES('storage-gap','route',NULL,NULL,
              ${JSON.stringify({ threadId: "t3-thread", receiptStorageError: true })},
              '{}',NULL,NULL,NULL,'failed',${at})`;
          const knownStorageGap = yield* ledger.getExperiment("exp-2");
          yield* sql`INSERT INTO codex_ledger_turns(source_domain,codex_thread_id,codex_turn_id,root_turn_id,started_at,lifecycle)
        VALUES(${sourceDomain},'child-thread','child-active','codex-turn',${at},'active')`;
          const activeChild = yield* ledger.getExperiment("exp-2");
          yield* sql`DELETE FROM codex_ledger_turns WHERE codex_turn_id='child-active'`;
          yield* sql`UPDATE codex_ledger_responses SET status='conflict' WHERE response_id='response-1'`;
          const pricedConflict = yield* ledger.getExperiment("exp-2");
          yield* sql`UPDATE codex_ledger_responses SET status='reported' WHERE response_id='response-1'`;
          const versions =
            yield* sql`SELECT valuation_id,snapshot_id FROM codex_ledger_valuations WHERE response_id='response-1'`;
          return {
            changed,
            reverted,
            list,
            versions,
            report,
            duplicateRoots,
            knownStorageGap,
            activeChild,
            pricedConflict,
          };
        }).pipe(Effect.provide(serviceLayer));
        assert.notEqual(
          scenarios.changed.valuation.completeEstimateUsd,
          first.summary.valuation.completeEstimateUsd,
        );
        assert.equal(
          scenarios.reverted.valuation.completeEstimateUsd,
          first.summary.valuation.completeEstimateUsd,
        );
        assert.equal(scenarios.list.items.filter((item) => item.active).length, 1);
        assert.equal(scenarios.versions.length, 2);
        const experimentReport = JSON.parse(scenarios.report?.reportJson ?? "{}") as {
          cases?: {
            attemptCount: number;
            apiCompleteUsd: string | null;
            coverageReasons: string[];
          }[];
        };
        assert.equal(experimentReport.cases?.[0]?.attemptCount, 2);
        assert.equal(experimentReport.cases?.[0]?.apiCompleteUsd, null);
        const coverage = (value: typeof scenarios.duplicateRoots) =>
          JSON.parse(value?.reportJson ?? "{}") as {
            cases?: {
              apiSubtotalUsd: string | null;
              apiCompleteUsd: string | null;
              jevReportedUsd: string | null;
              combinedScenarioUsd: string | null;
            }[];
          };
        assert.equal(
          coverage(scenarios.duplicateRoots).cases?.[0]?.apiSubtotalUsd,
          first.summary.valuation.completeEstimateUsd,
        );
        // The spawn edge is known, but its child has not emitted a turn yet.
        assert.equal(coverage(scenarios.duplicateRoots).cases?.[0]?.apiCompleteUsd, null);
        assert.equal(coverage(scenarios.duplicateRoots).cases?.[0]?.jevReportedUsd, "0.004");
        assert.equal(coverage(scenarios.duplicateRoots).cases?.[0]?.combinedScenarioUsd, null);
        assert.equal(
          (
            JSON.parse(scenarios.knownStorageGap?.reportJson ?? "{}") as {
              cases?: { jevUnknownCount: number; coverageReasons: string[] }[];
            }
          ).cases?.[0]?.jevUnknownCount,
          1,
        );
        assert.equal(coverage(scenarios.activeChild).cases?.[0]?.apiCompleteUsd, null);
        assert.equal(coverage(scenarios.pricedConflict).cases?.[0]?.apiCompleteUsd, null);

        // A fresh service connection resumes its durable cursor; the same response cannot double count.
        const reopened = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const summary = yield* ledger.getSummary();
          const exportPage = yield* ledger.exportJsonl({ format: "jsonl", limit: 2 });
          const stopped = yield* ledger.setCapture(false);
          return { summary, exportPage, stopped };
        }).pipe(
          Effect.provide(
            layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
          ),
        );
        assert.equal(reopened.summary.responseCount, 1);
        assert.match(reopened.exportPage.data, /response-1/);
        assert.equal(reopened.stopped.captureState, "paused");
        yield* Effect.promise(() => NodeFSP.appendFile(transcript, receipt("response-2", 20)));
        const paused = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          return yield* ledger.getSummary();
        }).pipe(
          Effect.provide(
            layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
          ),
        );
        assert.equal(paused.responseCount, 1);
        const resumed = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          return yield* ledger.setCapture(true);
        }).pipe(
          Effect.provide(
            layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
          ),
        );
        assert.equal(resumed.responseCount, 2);

        const additional = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const firstPage = yield* ledger.listTurns({
            limit: 1,
            t3ThreadId: "t3-thread",
            t3TurnId: "codex-turn",
          });
          const exportFirst = yield* ledger.exportJsonl({ format: "jsonl", limit: 2 });
          yield* Effect.promise(() => NodeFSP.appendFile(transcript, receipt("response-3", 7)));
          yield* ledger.getSummary();
          const sql = yield* SqlClient.SqlClient;
          const exportSecond = yield* ledger.exportJsonl({
            format: "jsonl",
            limit: 1,
            cursor: exportFirst.nextCursor ?? undefined,
          });
          let frozenCursor = exportSecond.nextCursor;
          let frozenData = exportFirst.data + exportSecond.data;
          while (frozenCursor) {
            const page: { format: "jsonl"; data: string; nextCursor: string | null } =
              yield* ledger.exportJsonl({ format: "jsonl", limit: 20, cursor: frozenCursor });
            frozenData += page.data;
            frozenCursor = page.nextCursor;
          }
          const receiptBase = {
            requestId: "jev-1",
            attemptId: "attempt-1",
            rootTurnId: "codex-turn",
            toolUseId: "spawn-1",
            environmentId: null,
            projectId: null,
            threadId: "t3-thread",
            messageId: "t3-message",
            turnId: "codex-turn",
            providerThreadId: "codex-thread",
            providerTurnId: "codex-turn",
            childProviderThreadId: null,
            parentProviderTurnId: null,
            dispatchId: null,
            observedModel: null,
            sourceScope: "subagent" as const,
            decisionJson: '{"proposed":"gpt-5.6-luna"}',
            dispatchJson: null,
            reportedCostUsd: null,
            estimatedCostUsd: null,
          };
          yield* ledger.recordJevReceipt({ ...receiptBase, status: "proposed" });
          yield* ledger.recordJevReceipt({
            ...receiptBase,
            status: "completed",
            reportedCostUsd: "0.001",
          });
          yield* ledger.recordJevReceipt({ ...receiptBase, status: "proposed" });
          yield* ledger.recordJevReceipt({
            ...receiptBase,
            attemptId: "attempt-2",
            status: "completed",
            reportedCostUsd: "0.002",
          });
          yield* ledger.recordJevReceipt({
            ...receiptBase,
            attemptId: "attempt-2",
            status: "dispatched",
            reportedCostUsd: "0.002",
            dispatchJson: '{"childThreadId":"child-thread"}',
          });
          yield* ledger.recordJevReceipt({
            ...receiptBase,
            attemptId: "attempt-2",
            status: "completed",
            reportedCostUsd: "0.002",
          });
          const jev =
            yield* sql`SELECT request_id,attempt_id,status,reported_cost_usd,identity_json FROM codex_ledger_jev_receipts`;
          const edges =
            yield* sql`SELECT tool_use_id,child_thread_id FROM codex_ledger_lineage_edges`;
          let exportCursor: string | null = null;
          let exportData = "";
          do {
            const page: { format: "jsonl"; data: string; nextCursor: string | null } =
              yield* ledger.exportJsonl({
                format: "jsonl",
                limit: 2,
                ...(exportCursor ? { cursor: exportCursor } : {}),
              });
            exportData += page.data;
            exportCursor = page.nextCursor;
          } while (exportCursor);
          return { firstPage, exportFirst, exportSecond, jev, edges, exportData, frozenData };
        }).pipe(
          Effect.provide(
            layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
          ),
        );
        assert.equal(additional.firstPage.items.length, 1);
        assert.notEqual(additional.exportFirst.nextCursor, null);
        assert.match(additional.exportSecond.data, /response-2/);
        assert.equal(additional.exportSecond.data.includes("response-3"), false);
        assert.equal(additional.frozenData.includes("response-3"), false);
        const firstAttempt = additional.jev.find(
          (row) => row.request_id === "jev-1" && row.attempt_id === "attempt-1",
        );
        const secondAttempt = additional.jev.find(
          (row) => row.request_id === "jev-1" && row.attempt_id === "attempt-2",
        );
        assert.equal(firstAttempt?.status, "completed");
        assert.equal(firstAttempt?.reported_cost_usd, "0.001");
        assert.equal(secondAttempt?.status, "dispatched");
        assert.equal(secondAttempt?.reported_cost_usd, "0.002");
        assert.equal(
          (
            JSON.parse(String(firstAttempt?.identity_json ?? "{}")) as {
              childProviderThreadId?: string;
            }
          ).childProviderThreadId,
          "child-thread",
        );
        assert.deepEqual(additional.edges, [
          { tool_use_id: "spawn-1", child_thread_id: "child-thread" },
        ]);
        const exportKinds = new Set(
          additional.exportData
            .trim()
            .split("\n")
            .map((line) => (JSON.parse(line) as { type: string }).type),
        );
        for (const kind of [
          "header",
          "response",
          "observations",
          "turns",
          "quota",
          "jev",
          "experiments",
          "runs",
          "valuations",
          "rates",
          "sources",
        ])
          assert.equal(exportKinds.has(kind), true, kind);
        assert.equal(additional.exportData.includes(home), false);
        const sourceExport = additional.exportData
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { type: string; record?: Record<string, unknown> })
          .find((line) => line.type === "sources");
        assert.equal(typeof sourceExport?.record?.["resumeOffset"], "number");
        assert.equal(Object.hasOwn(sourceExport?.record ?? {}, "path"), false);

        yield* Effect.promise(() => NodeFSP.appendFile(transcript, receipt("response-1", 11)));
        const conflict = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          return yield* ledger.getSummary();
        }).pipe(
          Effect.provide(
            layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
          ),
        );
        assert.equal(conflict.responseCount, 3);
        assert.equal(conflict.conflictCount, 1);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);

it.effect(
  "accumulates provisional deltas once and replaces them with distinct exact responses",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-provisional-")),
      );
      try {
        const dir = NodePath.join(home, "sessions", "2026", "09", "20");
        yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
        const transcript = NodePath.join(dir, "rollout.jsonl");
        const usage = (input: number) => ({
          input_tokens: input,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: input,
        });
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            transcript,
            row("session_meta", { id: "codex-thread" }) +
              row("event_msg", { type: "task_started", turn_id: "codex-turn" }) +
              row("event_msg", {
                type: "token_count",
                info: { total_token_usage: usage(10), last_token_usage: usage(10) },
              }) +
              row("event_msg", {
                type: "token_count",
                info: { total_token_usage: usage(20), last_token_usage: usage(10) },
              }),
          ),
        );
        const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
        yield* runMigrations().pipe(Effect.provide(dbLayer));
        const layer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
        const provisional = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          return yield* ledger.listTurns({ limit: 10 });
        }).pipe(Effect.provide(layer));
        assert.equal(provisional.items[0]?.tokens.inputTokens, 20);
        assert.equal(provisional.items[0]?.coverage.usage, "provisional");
        assert.equal(provisional.items[0]?.responseCount, 0);
        assert.equal(provisional.items[0]?.valuation.pricedSubtotalUsd, null);
        assert.equal(provisional.items[0]?.valuation.completeEstimateUsd, null);
        assert.equal(provisional.items[0]?.coverage.pricing, "notValued");
        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            transcript,
            receipt("response-a", 10) +
              receipt("response-b", 10) +
              row("event_msg", { type: "task_complete", turn_id: "codex-turn" }),
          ),
        );
        const exact = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const summaries = yield* Effect.all([ledger.getSummary(), ledger.getSummary()], {
            concurrency: 2,
          });
          const turns = yield* ledger.listTurns({ limit: 10 });
          return { summaries, turns };
        }).pipe(
          Effect.provide(
            layerForHome(home).pipe(
              Layer.provideMerge(
                NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") }),
              ),
            ),
          ),
        );
        assert.equal(exact.summaries[0]?.responseCount, 2);
        assert.equal(exact.summaries[1]?.responseCount, 2);
        assert.equal(exact.summaries[0]?.tokens.inputTokens, 20);
        assert.equal(exact.turns.items[0]?.tokens.inputTokens, 20);
        const zeroUsage = usage(0);
        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            transcript,
            row("event_msg", { type: "task_started", turn_id: "zero-turn" }) +
              row("turn_context", {
                turn_id: "zero-turn",
                root_turn_id: "zero-turn",
                model: "gpt-5.6-luna",
              }) +
              row("token_usage_record", {
                response_id: "zero-response",
                thread_id: "codex-thread",
                turn_id: "zero-turn",
                root_turn_id: "zero-turn",
                usage: zeroUsage,
                turn_token_usage: zeroUsage,
              }) +
              row("event_msg", { type: "task_complete", turn_id: "zero-turn" }),
          ),
        );
        const pricedZero = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          return yield* ledger.getTurn({
            sourceDomain: exact.turns.items[0]!.identity.sourceDomain,
            codexThreadId: "codex-thread",
            codexTurnId: "zero-turn",
          });
        }).pipe(Effect.provide(layer));
        assert.equal(pricedZero?.turn.valuation.pricedSubtotalUsd, "0");
        assert.equal(pricedZero?.turn.valuation.completeEstimateUsd, "0");
        assert.equal(pricedZero?.turn.coverage.pricing, "priced");
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);

it.effect("keeps child follow-up turns in their explicit root family", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-followup-")),
    );
    try {
      const dir = NodePath.join(home, "sessions", "2026", "09", "20");
      yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "parent.jsonl"),
          row("session_meta", { id: "parent-thread" }) +
            row("event_msg", { type: "task_started", turn_id: "root-a" }) +
            row("response_item", {
              type: "function_call",
              call_id: "spawn-child",
              name: "functions.collaboration.spawn_agent",
            }) +
            row("response_item", {
              type: "function_call_output",
              call_id: "spawn-child",
              output: '{"task_name":"/root/child"}',
            }),
        ),
      );
      const childPath = NodePath.join(dir, "child.jsonl");
      const childReceipt = (id: string, turnId: string, rootTurnId: string) =>
        row("token_usage_record", {
          response_id: id,
          thread_id: "child-thread",
          turn_id: turnId,
          root_turn_id: rootTurnId,
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
            total_tokens: 2,
          },
        });
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          childPath,
          row("session_meta", {
            id: "child-thread",
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: "parent-thread",
                  agent_path: "/root/child",
                },
              },
            },
          }) +
            row("event_msg", { type: "task_started", turn_id: "child-first" }) +
            childReceipt("response-first", "child-first", "root-a") +
            row("event_msg", { type: "task_started", turn_id: "child-followup" }),
        ),
      );
      const db = NodePath.join(home, "state.sqlite");
      const dbLayer = NodeSqliteClient.layer({ filename: db });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const first = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.getSummary();
        const turns = yield* ledger.listTurns({ limit: 20 });
        const domain = turns.items[0]!.identity.sourceDomain;
        const oldFamily = yield* ledger.listFamily({
          sourceDomain: domain,
          rootTurnId: "root-a",
          limit: 20,
        });
        return { turns, oldFamily, domain };
      }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
      assert.equal(
        first.turns.items.find((turn) => turn.identity.codexTurnId === "child-followup")?.identity
          .rootTurnId,
        null,
      );
      assert.deepEqual(
        first.oldFamily.items.map((turn) => turn.identity.codexTurnId),
        ["child-first"],
      );
      assert.equal(
        first.turns.items.find((turn) => turn.identity.codexTurnId === "root-a")?.childTurnCount,
        1,
      );

      yield* Effect.promise(() =>
        NodeFSP.appendFile(
          childPath,
          row("turn_context", { turn_id: "child-followup", root_turn_id: "root-b" }) +
            childReceipt("response-followup", "child-followup", "root-b"),
        ),
      );
      const after = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.getSummary();
        const oldFamily = yield* ledger.listFamily({
          sourceDomain: first.domain,
          rootTurnId: "root-a",
          limit: 20,
        });
        const newFamily = yield* ledger.listFamily({
          sourceDomain: first.domain,
          rootTurnId: "root-b",
          limit: 20,
        });
        return { oldFamily, newFamily };
      }).pipe(
        Effect.provide(
          layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
        ),
      );
      assert.deepEqual(
        after.oldFamily.items.map((turn) => turn.identity.codexTurnId),
        ["child-first"],
      );
      assert.deepEqual(
        after.newFamily.items.map((turn) => turn.identity.codexTurnId),
        ["child-followup"],
      );
      assert.equal(after.oldFamily.items[0]?.tokens.processedTokens, 2);
      assert.equal(after.newFamily.items[0]?.tokens.processedTokens, 2);
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);

it.effect(
  "enriches unknown response model, promotes compaction and quarantines an incompatible model",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-reconcile-")),
      );
      try {
        const dir = NodePath.join(home, "sessions", "2026", "09", "20");
        yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
        const transcript = NodePath.join(dir, "rollout.jsonl");
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            transcript,
            row("session_meta", { id: "codex-thread" }) +
              row("event_msg", { type: "task_started", turn_id: "codex-turn" }) +
              receipt("response-shared", 10),
          ),
        );
        const db = NodePath.join(home, "state.sqlite");
        const dbLayer = NodeSqliteClient.layer({ filename: db });
        yield* runMigrations().pipe(Effect.provide(dbLayer));
        const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.provide(
              layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: db }))),
            ),
          );
        const initial = yield* run(
          Effect.gen(function* () {
            const ledger = yield* CodexLedgerService;
            const summary = yield* ledger.getSummary();
            const turns = yield* ledger.listTurns({ limit: 10 });
            return { summary, turns };
          }),
        );
        assert.equal(initial.summary.responseCount, 1);
        assert.equal(initial.summary.valuation.unpricedResponseCount, 1);
        assert.equal(initial.summary.valuation.pricedSubtotalUsd, null);
        assert.equal(initial.summary.valuation.completeEstimateUsd, null);
        assert.equal(initial.turns.items[0]?.valuation.pricedSubtotalUsd, null);
        const domain = initial.turns.items[0]!.identity.sourceDomain;
        const repeated = JSON.parse(receipt("response-shared", 10)) as { payload: object };
        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            transcript,
            row("turn_context", {
              turn_id: "codex-turn",
              root_turn_id: "codex-turn",
              model: "gpt-5.6-luna",
            }) +
              receipt("response-shared", 10) +
              row("compacted", { latest_token_usage_record: repeated.payload }),
          ),
        );
        const enriched = yield* run(
          Effect.gen(function* () {
            const ledger = yield* CodexLedgerService;
            yield* ledger.getSummary();
            const detail = yield* ledger.getTurn({
              sourceDomain: domain,
              codexThreadId: "codex-thread",
              codexTurnId: "codex-turn",
            });
            const override = { ...CODEX_STANDARD_RATE_SNAPSHOT, id: "after-enrichment" };
            yield* ledger.createRateSnapshot({
              snapshotId: override.id,
              rulesJson: JSON.stringify(override),
            });
            yield* ledger.selectRateSnapshot(override.id);
            const repriced = yield* ledger.getSummary();
            const sql = yield* SqlClient.SqlClient;
            const valuations =
              yield* sql`SELECT valuation_id,total_usd FROM codex_ledger_valuations WHERE response_id='response-shared'`;
            return { detail, valuations, repriced };
          }),
        );
        assert.equal(enriched.detail?.responses[0]?.model, "gpt-5.6-luna");
        assert.equal(enriched.detail?.responses[0]?.kind, "compaction");
        assert.equal(enriched.detail?.responses[0]?.observationCount, 3);
        assert.equal(enriched.detail?.turn.coverage.pricing, "partial");
        assert.notEqual(enriched.repriced.valuation.pricedSubtotalUsd, null);
        assert.equal(enriched.valuations.length, 3);
        assert.equal(enriched.repriced.valuation.unpricedResponseCount, 0);
        assert.equal(
          typeof enriched.valuations.find((row) => row.valuation_id === "scenario:after-enrichment")
            ?.total_usd,
          "string",
        );
        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            transcript,
            row("token_usage_record", { ...repeated.payload, model: "gpt-5.6-sol" }),
          ),
        );
        const conflicted = yield* run(
          Effect.gen(function* () {
            const ledger = yield* CodexLedgerService;
            const summary = yield* ledger.getSummary();
            const detail = yield* ledger.getTurn({
              sourceDomain: domain,
              codexThreadId: "codex-thread",
              codexTurnId: "codex-turn",
            });
            const sql = yield* SqlClient.SqlClient;
            const conflicts =
              yield* sql`SELECT * FROM codex_ledger_conflicts WHERE response_id='response-shared'`;
            const observations =
              yield* sql`SELECT * FROM codex_ledger_observations WHERE response_id='response-shared'`;
            return { summary, detail, conflicts, observations };
          }),
        );
        assert.equal(conflicted.summary.conflictCount, 1);
        assert.equal(conflicted.summary.valuation.completeEstimateUsd, null);
        assert.equal(conflicted.detail?.responses[0]?.status, "conflict");
        assert.equal(conflicted.detail?.turn.coverage.pricing, "partial");
        assert.equal(conflicted.conflicts.length, 1);
        assert.equal(conflicted.observations.length, 4);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);
