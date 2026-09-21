import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_turns_root
    ON codex_ledger_turns(source_domain, root_turn_id, started_at, codex_thread_id, codex_turn_id)
    WHERE root_turn_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_turns_codex_identity
    ON codex_ledger_turns(codex_turn_id, source_domain, codex_thread_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_jev_receipts_root_created
    ON codex_ledger_jev_receipts(root_turn_id, created_at DESC)
    WHERE root_turn_id IS NOT NULL
  `;
});
