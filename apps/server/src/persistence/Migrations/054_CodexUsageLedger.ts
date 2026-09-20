import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      capture_active INTEGER NOT NULL DEFAULT 1,
      active_snapshot_id TEXT NOT NULL DEFAULT 'openai-standard-scenario-2026-09-20-v1',
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT OR IGNORE INTO codex_ledger_settings (id, capture_active, updated_at)
    VALUES (1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_sources (
      source_id TEXT PRIMARY KEY,
      source_domain TEXT NOT NULL,
      path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      resume_offset INTEGER NOT NULL DEFAULT 0,
      guard_length INTEGER NOT NULL DEFAULT 0,
      guard_hash TEXT NOT NULL DEFAULT '',
      generation TEXT NOT NULL DEFAULT '',
      skipping_oversized_line INTEGER NOT NULL DEFAULT 0,
      parser_state_json TEXT NOT NULL DEFAULT '{}',
      file_fingerprint TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'ready',
      malformed_record_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_captured_at TEXT,
      UNIQUE(source_domain, path)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_observations (
      source_id TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      response_id TEXT,
      kind TEXT NOT NULL,
      occurred_at TEXT,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(source_id, observation_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_observations_response
    ON codex_ledger_observations(source_domain, response_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_responses (
      source_domain TEXT NOT NULL,
      response_id TEXT NOT NULL,
      codex_thread_id TEXT,
      codex_turn_id TEXT,
      root_turn_id TEXT,
      session_id TEXT,
      occurred_at TEXT NOT NULL,
      model TEXT,
      model_provenance TEXT NOT NULL,
      effort TEXT,
      scope TEXT NOT NULL,
      response_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      tokens_json TEXT NOT NULL,
      fact_hash TEXT NOT NULL,
      observation_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(source_domain, response_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_responses_turn
    ON codex_ledger_responses(source_domain, codex_thread_id, codex_turn_id, occurred_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_responses_root
    ON codex_ledger_responses(source_domain, root_turn_id, occurred_at)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_conflicts (
      source_domain TEXT NOT NULL,
      response_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      canonical_hash TEXT NOT NULL,
      conflicting_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(source_domain, response_id, source_id, observation_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_threads (
      source_domain TEXT NOT NULL,
      codex_thread_id TEXT NOT NULL,
      parent_thread_id TEXT,
      forked_from_id TEXT,
      scope TEXT NOT NULL,
      cli_version TEXT,
      PRIMARY KEY(source_domain,codex_thread_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_turns (
      source_domain TEXT NOT NULL,
      codex_thread_id TEXT NOT NULL,
      codex_turn_id TEXT NOT NULL,
      root_turn_id TEXT,
      t3_environment_id TEXT,
      t3_project_id TEXT,
      t3_thread_id TEXT,
      t3_turn_id TEXT,
      t3_message_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      lifecycle TEXT NOT NULL DEFAULT 'unknown',
      copied INTEGER NOT NULL DEFAULT 0,
      provisional_tokens_json TEXT,
      provisional_model TEXT,
      turn_checkpoint_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(source_domain, codex_thread_id, codex_turn_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_turns_started
    ON codex_ledger_turns(started_at DESC, source_domain, codex_thread_id, codex_turn_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_turns_t3
    ON codex_ledger_turns(t3_thread_id, t3_turn_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_tools (
      source_domain TEXT NOT NULL,
      call_id TEXT NOT NULL,
      codex_thread_id TEXT,
      codex_turn_id TEXT,
      name TEXT,
      status TEXT,
      output_bytes INTEGER,
      occurred_at TEXT,
      PRIMARY KEY(source_domain, call_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_spawn_hints (
      source_domain TEXT NOT NULL,
      tool_use_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      parent_thread_id TEXT,
      parent_turn_id TEXT,
      PRIMARY KEY(source_domain,tool_use_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_child_hints (
      source_domain TEXT NOT NULL,
      child_thread_id TEXT NOT NULL,
      agent_path TEXT NOT NULL,
      parent_thread_id TEXT,
      root_turn_id TEXT,
      PRIMARY KEY(source_domain,child_thread_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_lineage_edges (
      source_domain TEXT NOT NULL,
      tool_use_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL,
      parent_thread_id TEXT NOT NULL,
      parent_turn_id TEXT,
      root_turn_id TEXT,
      PRIMARY KEY(source_domain,tool_use_id,child_thread_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_quota (
      source_domain TEXT NOT NULL,
      bucket_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      used_percent REAL,
      window_duration_mins INTEGER,
      resets_at TEXT,
      plan TEXT,
      observation_id TEXT NOT NULL,
      PRIMARY KEY(source_domain, bucket_id, observation_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_quota_timeline
    ON codex_ledger_quota(source_domain, bucket_id, observed_at DESC)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_rate_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      rules_json TEXT NOT NULL,
      calculation_version TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_valuations (
      source_domain TEXT NOT NULL,
      response_id TEXT NOT NULL,
      valuation_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      estimate_kind TEXT NOT NULL,
      components_json TEXT NOT NULL,
      total_usd TEXT,
      missing_reasons_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(source_domain, response_id, valuation_id)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_experiments (
      experiment_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_runs (
      run_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      cohort TEXT NOT NULL,
      source_domain TEXT,
      root_turn_id TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      outcome_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES codex_ledger_experiments(experiment_id)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_ledger_jev_receipts (
      request_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      root_turn_id TEXT,
      tool_use_id TEXT,
      identity_json TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      dispatch_json TEXT,
      reported_cost_usd TEXT,
      estimated_cost_usd TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(request_id, attempt_id)
    ) WITHOUT ROWID
  `;
  yield* sql`CREATE TABLE IF NOT EXISTS codex_ledger_export_jobs (
    export_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    snapshot_id TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS codex_ledger_export_rows (
    export_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    jsonl TEXT NOT NULL,
    PRIMARY KEY(export_id,ordinal),
    FOREIGN KEY(export_id) REFERENCES codex_ledger_export_jobs(export_id) ON DELETE CASCADE
  ) WITHOUT ROWID`;
});
