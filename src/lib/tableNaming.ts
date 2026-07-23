// Naming standards for agent-created tables in the `canvas` warehouse.
//
// Goal: predictable, source-tagged, non-colliding names so fetched tables don't
// sprawl with random model-chosen identifiers, and so the dashboard + refresh
// cron can recognise and re-fetch them. The connector assigns the standard name
// and returns it to the model, which then queries that name.

import { assertIdent } from "./clickhouse";

export type SourceKind = "open_meteo" | "url";

// Seed warehouse tables the agent must never shadow.
const RESERVED = new Set(["events", "logs", "deploys"]);

// One short, human prefix per source kind so a table's origin is obvious.
const PREFIX: Record<SourceKind, string> = {
  open_meteo: "wx", // weather + air quality
  url: "ext", // external ingested dataset (CSV/JSON)
};

/** snake_case, alnum-only, trimmed, capped — safe as part of an identifier. */
export function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "data"
  );
}

/**
 * Canonical table name for a fetched dataset: `<prefix>_<slug>`.
 * e.g. standardTableName("open_meteo", "Amsterdam") -> "wx_amsterdam".
 * Guaranteed a valid identifier and never a reserved warehouse table.
 */
export function standardTableName(kind: SourceKind, hint: string): string {
  const s = slug(hint);
  const p = PREFIX[kind];
  // Idempotent: if the hint is already a standard name (the cron re-fetches by
  // passing the stored table name back in), don't prefix it twice.
  let name = s.startsWith(`${p}_`) ? s : `${p}_${s}`;
  if (RESERVED.has(name)) name = `${name}_data`;
  return assertIdent(name);
}

/** True if a table name follows the fetched-dataset convention (has a known prefix). */
export function isFetchedTable(name: string): boolean {
  return Object.values(PREFIX).some((p) => name.startsWith(`${p}_`));
}
