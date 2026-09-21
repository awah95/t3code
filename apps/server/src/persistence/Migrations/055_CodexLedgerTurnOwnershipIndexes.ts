import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS codex_ledger_responses_owner
    ON codex_ledger_responses(source_domain, codex_turn_id, codex_thread_id)
  `;
});
