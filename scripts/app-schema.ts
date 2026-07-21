/**
 * Creates the `prism_app` database that holds app metadata — users and the
 * per-user session index for the sidebar. Kept in a SEPARATE database from the
 * `canvas` warehouse so the agent's introspect() never sees (or exposes) it.
 *
 * Run with: npm run db:app
 */
import { clickhouse } from "../src/lib/clickhouse";

async function main() {
  const ch = clickhouse();

  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS prism_app` });

  // Dedup on user_id so re-logins don't pile up rows.
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS prism_app.users (
      user_id String,
      username String,
      created_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree ORDER BY user_id`,
  });

  // Append-only: create + rename/touch both insert a row; queries fold with
  // argMax(title, updated_at) / min(created_at) / max(updated_at) per session.
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS prism_app.sessions (
      session_id String,
      user_id String,
      title String,
      created_at DateTime DEFAULT now(),
      updated_at DateTime DEFAULT now()
    ) ENGINE = MergeTree ORDER BY (user_id, session_id)`,
  });

  // Full UI-message transcript per session (JSON), so reopening a session
  // rehydrates the conversation. Latest snapshot wins via ReplacingMergeTree.
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS prism_app.transcripts (
      session_id String,
      user_id String,
      messages String,
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY session_id`,
  });

  console.log("prism_app schema ready (users, sessions, transcripts).");
  await ch.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
