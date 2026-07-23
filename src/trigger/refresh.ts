import { schedules } from "@trigger.dev/sdk";
import { listRefreshableSources, touchSource } from "../lib/sources";
import { fetchOpenMeteo, ingestUrl } from "../lib/connectors";

/**
 * Daily refresh: re-runs the stored fetch for every source marked refreshable
 * so weather forecasts and live datasets stay current. Each fetch re-creates
 * its table (CREATE OR REPLACE) under the same standard name.
 */
export const refreshSources = schedules.task({
  id: "refresh-sources",
  cron: "0 5 * * *", // every day at 05:00 UTC
  run: async () => {
    const sources = await listRefreshableSources();
    const results: { table: string; ok: boolean; rows?: number; error?: string }[] = [];

    for (const s of sources) {
      try {
        if (s.source_kind === "open_meteo") {
          const { latitude, longitude, location_name, days } = s.params;
          if (latitude == null || longitude == null) {
            results.push({ table: s.table_name, ok: false, error: "missing lat/lon" });
            continue;
          }
          const r = await fetchOpenMeteo({
            table: s.table_name,
            latitude,
            longitude,
            locationName: location_name ?? s.table_name,
            days,
          });
          results.push({ table: s.table_name, ok: true, rows: r.rowCount });
        } else if (s.source_kind === "url") {
          if (!s.params.url) {
            results.push({ table: s.table_name, ok: false, error: "missing url" });
            continue;
          }
          const r = await ingestUrl({
            table: s.table_name,
            url: s.params.url,
            format: s.params.format,
          });
          results.push({ table: s.table_name, ok: true, rows: r.rowCount });
        }
        await touchSource(s.table_name);
      } catch (e) {
        results.push({
          table: s.table_name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const refreshed = results.filter((r) => r.ok).length;
    return { total: sources.length, refreshed, results };
  },
});
