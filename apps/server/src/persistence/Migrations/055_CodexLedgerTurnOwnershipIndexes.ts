import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import Migration0054 from "./054_CodexUsageLedger.ts";

export default Effect.gen(function* () {
  // Upstream also used slot 54. Its databases need the ledger before this index.
  yield* Migration0054;
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_responses_owner
    ON codex_ledger_responses(source_domain, codex_turn_id, codex_thread_id)
  `;
});
