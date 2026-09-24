import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN side_chat_owns_worktree INTEGER NOT NULL DEFAULT 0`;
  yield* sql`UPDATE projection_threads SET side_chat_owns_worktree = 1 WHERE side_chat_mode = 'implement' AND worktree_path IS NOT NULL`;
});
