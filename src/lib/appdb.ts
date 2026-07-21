import { clickhouse } from "./clickhouse";

// App metadata lives in a separate database from the `canvas` warehouse so the
// agent's introspect() never surfaces users/sessions to the model.
const DB = "prism_app";

export interface SessionRow {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function nowMs(): string {
  return new Date().toISOString().slice(0, 23).replace("T", " ");
}

export async function upsertUser(userId: string, username: string): Promise<void> {
  await clickhouse().insert({
    table: `${DB}.users`,
    values: [{ user_id: userId, username, created_at: nowStr() }],
    format: "JSONEachRow",
  });
}

export async function createSession(
  userId: string,
  sessionId: string,
  title = "New chat"
): Promise<void> {
  const ts = nowStr();
  await clickhouse().insert({
    table: `${DB}.sessions`,
    values: [{ session_id: sessionId, user_id: userId, title, created_at: ts, updated_at: ts }],
    format: "JSONEachRow",
  });
}

/** Insert a fresh row so argMax(title) / max(updated_at) pick up the new title. */
export async function renameSession(
  userId: string,
  sessionId: string,
  title: string
): Promise<void> {
  const ts = nowStr();
  await clickhouse().insert({
    table: `${DB}.sessions`,
    values: [{ session_id: sessionId, user_id: userId, title, created_at: ts, updated_at: ts }],
    format: "JSONEachRow",
  });
}

/** Folds the append-only rows into one entry per session, newest first. */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  // A real title always beats the "New chat" placeholder regardless of clock
  // ties or the create-vs-rename order (they fire near-simultaneously on the
  // first turn). Aliases must NOT reuse raw column names, or ClickHouse resolves
  // the args inside argMax/min/max to the aggregated alias.
  const rs = await clickhouse().query({
    query: `SELECT
        session_id,
        if(countIf(title != 'New chat') > 0,
           argMaxIf(title, updated_at, title != 'New chat'),
           'New chat') AS s_title,
        toString(min(created_at)) AS s_created,
        toString(max(updated_at)) AS s_updated
      FROM ${DB}.sessions
      WHERE user_id = {userId:String}
      GROUP BY session_id
      ORDER BY s_updated DESC
      LIMIT 100`,
    query_params: { userId },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    session_id: string;
    s_title: string;
    s_created: string;
    s_updated: string;
  }>();
  return rows.map((r) => ({
    session_id: r.session_id,
    title: r.s_title,
    created_at: r.s_created,
    updated_at: r.s_updated,
  }));
}

/** Returns the owning user_id of a session, or null if it doesn't exist yet. */
export async function getSessionOwner(sessionId: string): Promise<string | null> {
  const rs = await clickhouse().query({
    query: `SELECT user_id FROM ${DB}.sessions WHERE session_id = {sessionId:String} LIMIT 1`,
    query_params: { sessionId },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ user_id: string }>();
  return rows[0]?.user_id ?? null;
}

/**
 * Registers a new session under the user, or throws if it already belongs to
 * someone else. This is what makes sessions per-user and blocks opening
 * another user's chat by guessing its id.
 */
export async function ensureSession(userId: string, sessionId: string): Promise<void> {
  const owner = await getSessionOwner(sessionId);
  if (owner && owner !== userId) {
    throw new Error("This chat belongs to another user.");
  }
  if (!owner) {
    await createSession(userId, sessionId);
  }
}

/** Snapshots the full UI-message transcript (JSON) for a session. */
export async function putTranscript(
  userId: string,
  sessionId: string,
  messages: string
): Promise<void> {
  await clickhouse().insert({
    table: `${DB}.transcripts`,
    values: [{ session_id: sessionId, user_id: userId, messages, updated_at: nowMs() }],
    format: "JSONEachRow",
  });
}

/** Reads the latest transcript for a session owned by the user, or null. */
export async function getTranscript(userId: string, sessionId: string): Promise<string | null> {
  const rs = await clickhouse().query({
    query: `SELECT messages FROM ${DB}.transcripts FINAL
      WHERE session_id = {sessionId:String} AND user_id = {userId:String}
      LIMIT 1`,
    query_params: { sessionId, userId },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ messages: string }>();
  return rows[0]?.messages ?? null;
}
