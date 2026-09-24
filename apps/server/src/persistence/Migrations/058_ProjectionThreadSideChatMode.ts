import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN side_chat_mode TEXT`;
  yield* sql`UPDATE projection_threads SET side_chat_mode = 'discuss' WHERE parent_thread_id IS NOT NULL`;
});
