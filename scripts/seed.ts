/**
 * Seeds ClickHouse with demo datasets containing planted, discoverable stories:
 *
 * 1. canvas.events (~30 days of SaaS product analytics)
 *    - Mobile (ios/android) signups collapse to ~28% of baseline after the
 *      "mobile v2.4.0" deploy 6 days ago at 14:00 UTC. Web is unaffected.
 *    - German web traffic spikes ~3x on days -12/-11 (marketing campaign).
 *
 * 2. canvas.logs (~14 days of request logs)
 *    - Last Tuesday 13:00-13:45 UTC: db connection pool exhaustion (deployed
 *      12:55) -> db latency x60 + 35% errors, cascading into checkout.
 *    - Correlated traces (gateway -> api -> checkout -> db) during the window.
 *
 * 3. canvas.deploys — deploy markers incl. the two culprits.
 *
 * All timestamps are UTC to match ClickHouse's now()/today().
 */
import { createTable, insertRows } from "../src/lib/clickhouse";
import type { Row } from "../src/lib/spec";

// Deterministic PRNG so reseeding reproduces the same story.
let seedState = 1337;
function rand(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const utcHour = (t: number) => new Date(t).getUTCHours();
const fmt = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
const fmtMs = (t: number) => new Date(t).toISOString().slice(0, 23).replace("T", " ");

// Diurnal curve: trough ~04:00, peak ~15:00 UTC.
const diurnal = (t: number) => 0.55 + 0.45 * Math.sin(((utcHour(t) - 9) / 24) * 2 * Math.PI) + 0.25;
const isWeekend = (t: number) => [0, 6].includes(new Date(t).getUTCDay());
const dayFactor = (t: number) => (isWeekend(t) ? 0.62 : 1);

// --- planted moments ---------------------------------------------------------
const mobileDeployAt = startOfUtcDay(now - 6 * DAY) + 14 * HOUR; // signups story
const lastTuesday = (() => {
  let d = startOfUtcDay(now - DAY);
  while (new Date(d).getUTCDay() !== 2) d -= DAY;
  return d;
})();
const incidentStart = lastTuesday + 13 * HOUR;
const incidentEnd = incidentStart + 45 * 60_000;
const campaignStart = startOfUtcDay(now - 12 * DAY);
const campaignEnd = campaignStart + 2 * DAY;

function startOfUtcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// --- events ------------------------------------------------------------------

const COUNTRIES: [string, number][] = [
  ["US", 30], ["GB", 12], ["DE", 10], ["FR", 8], ["NL", 6], ["IN", 10], ["BR", 6], ["ES", 5],
  ["PL", 4], ["JP", 4], ["CA", 3], ["AU", 2],
];
const countryTotal = COUNTRIES.reduce((s, [, w]) => s + w, 0);
function pickCountry(): string {
  let r = rand() * countryTotal;
  for (const [c, w] of COUNTRIES) {
    r -= w;
    if (r <= 0) return c;
  }
  return "US";
}

async function seedEvents() {
  await createTable(
    "events",
    [
      { name: "ts", type: "DateTime" },
      { name: "event", type: "LowCardinality(String)" },
      { name: "platform", type: "LowCardinality(String)" },
      { name: "country", type: "LowCardinality(String)" },
      { name: "user_id", type: "String" },
      { name: "revenue", type: "Float64" },
    ],
    "ts"
  );

  const basePv: Record<string, number> = { web: 300, ios: 130, android: 110 };
  let batch: Row[] = [];
  let total = 0;
  const flush = async (force = false) => {
    if (batch.length >= 50_000 || (force && batch.length)) {
      await insertRows("events", batch);
      total += batch.length;
      batch = [];
    }
  };
  const emit = (t: number, event: string, platform: string, country: string, revenue = 0) => {
    batch.push({
      ts: fmt(t + rand() * HOUR),
      event,
      platform,
      country,
      user_id: "u_" + hex(10),
      revenue: Math.round(revenue * 100) / 100,
    });
  };

  for (let t = now - 30 * DAY; t < now; t += HOUR) {
    for (const platform of ["web", "ios", "android"]) {
      const pv = Math.round(basePv[platform] * diurnal(t) * dayFactor(t) * (0.9 + 0.2 * rand()));
      const mobileBroken = platform !== "web" && t >= mobileDeployAt;
      for (let i = 0; i < pv; i++) emit(t, "page_view", platform, pickCountry());
      // campaign: extra German web pageviews
      if (platform === "web" && t >= campaignStart && t < campaignEnd) {
        const extra = Math.round(pv * 0.2);
        for (let i = 0; i < extra; i++) emit(t, "page_view", "web", "DE");
      }
      const signups = Math.round(pv * 0.034 * (mobileBroken ? 0.28 : 1) * (0.85 + 0.3 * rand()));
      for (let i = 0; i < signups; i++) emit(t, "signup", platform, pickCountry());
      const starts = Math.round(pv * 0.021 * (0.85 + 0.3 * rand()));
      for (let i = 0; i < starts; i++) emit(t, "checkout_start", platform, pickCountry());
      const completes = Math.round(starts * 0.62);
      for (let i = 0; i < completes; i++)
        emit(t, "checkout_complete", platform, pickCountry(), 20 + rand() * 70);
    }
    await flush();
  }
  await flush(true);
  console.log(`events: ${total.toLocaleString()} rows`);
}

// --- logs --------------------------------------------------------------------

const SERVICES: Record<string, { perMin: number; median: number; endpoints: string[] }> = {
  gateway: { perMin: 10, median: 14, endpoints: ["/", "/api/*", "/static/*"] },
  api: { perMin: 8, median: 42, endpoints: ["/api/products", "/api/cart", "/api/user", "/api/search"] },
  checkout: { perMin: 4, median: 85, endpoints: ["/api/checkout/pay", "/api/checkout/validate"] },
  db: { perMin: 7, median: 8, endpoints: ["query.select", "query.insert", "pool.acquire"] },
  auth: { perMin: 2, median: 28, endpoints: ["/api/login", "/api/token/refresh"] },
  search: { perMin: 2, median: 65, endpoints: ["/api/search"] },
};

async function seedLogs() {
  await createTable(
    "logs",
    [
      { name: "ts", type: "DateTime64(3)" },
      { name: "service", type: "LowCardinality(String)" },
      { name: "endpoint", type: "LowCardinality(String)" },
      { name: "level", type: "LowCardinality(String)" },
      { name: "status", type: "UInt16" },
      { name: "latency_ms", type: "Float64" },
      { name: "trace_id", type: "String" },
      { name: "message", type: "String" },
    ],
    "ts"
  );

  let batch: Row[] = [];
  let total = 0;
  const flush = async (force = false) => {
    if (batch.length >= 50_000 || (force && batch.length)) {
      await insertRows("logs", batch);
      total += batch.length;
      batch = [];
    }
  };
  const emit = (r: Row) => batch.push(r);

  const mkRow = (t: number, service: string, inIncident: boolean, traceId?: string): Row => {
    const cfg = SERVICES[service];
    let latency = cfg.median * Math.exp(gauss() * 0.7);
    let level = "info";
    let status = 200;
    let message = "ok";
    const endpoint = pick(cfg.endpoints);

    if (inIncident && service === "db") {
      latency = Math.min(400 + cfg.median * 60 * Math.exp(gauss() * 0.4), 5200);
      if (rand() < 0.35) {
        level = "error";
        status = 500;
        message = "DB::Exception: connection pool exhausted (max=20)";
      } else {
        level = rand() < 0.5 ? "warn" : "info";
        message = "pool.acquire slow: waited for free connection";
      }
    } else if (inIncident && service === "checkout") {
      latency = Math.min(300 + cfg.median * 35 * Math.exp(gauss() * 0.4), 8000);
      if (rand() < 0.28) {
        level = "error";
        status = 504;
        message = "timeout waiting for db connection (5000ms)";
      }
    } else if (inIncident && service === "api") {
      latency *= 2.5;
    } else {
      const r = rand();
      if (r < 0.004) {
        level = "error";
        status = 500;
        message = "unhandled exception";
      } else if (r < 0.014 && (service === "gateway" || service === "api")) {
        level = "warn";
        status = 404;
        message = "not found";
      }
    }
    return {
      ts: fmtMs(t + rand() * 60_000),
      service,
      endpoint,
      level,
      status,
      latency_ms: Math.round(latency * 10) / 10,
      trace_id: traceId ?? hex(12),
      message,
    };
  };

  for (let t = now - 14 * DAY; t < now; t += 60_000) {
    const inIncident = t >= incidentStart && t < incidentEnd;
    for (const service of Object.keys(SERVICES)) {
      const n = Math.max(
        1,
        Math.round(SERVICES[service].perMin * diurnal(t) * dayFactor(t) * (0.8 + 0.4 * rand()))
      );
      for (let i = 0; i < n; i++) emit(mkRow(t, service, inIncident));
    }
    // correlated traces through the stack during the incident
    if (inIncident && rand() < 0.6) {
      const traceId = "tr" + hex(10);
      const t0 = t + rand() * 50_000;
      emit({ ...mkRow(t0, "gateway", false, traceId), latency_ms: 18 + rand() * 10 });
      emit({ ...mkRow(t0 + 20, "api", true, traceId) });
      emit(mkRow(t0 + 45, "checkout", true, traceId));
      emit(mkRow(t0 + 60, "db", true, traceId));
    }
    await flush();
  }
  await flush(true);
  console.log(`logs: ${total.toLocaleString()} rows (incident ${fmt(incidentStart)} → ${fmt(incidentEnd)})`);
}

// --- deploys -----------------------------------------------------------------

async function seedDeploys() {
  await createTable(
    "deploys",
    [
      { name: "ts", type: "DateTime" },
      { name: "service", type: "LowCardinality(String)" },
      { name: "version", type: "String" },
      { name: "description", type: "String" },
    ],
    "ts"
  );

  const rows: Row[] = [];
  const routine = [
    ["api", "dependency bumps"],
    ["gateway", "routing config update"],
    ["search", "index tuning"],
    ["auth", "session hardening"],
    ["api", "new products endpoint fields"],
    ["gateway", "TLS cert rotation"],
  ];
  let v = 1;
  for (let t = now - 29 * DAY; t < now - DAY; t += (2 + rand() * 2) * DAY) {
    const [service, description] = pick(routine);
    rows.push({ ts: fmt(t + (9 + rand() * 8) * HOUR), service, version: `v1.${v++}.0`, description });
  }
  rows.push({
    ts: fmt(mobileDeployAt),
    service: "mobile",
    version: "v2.4.0",
    description: "signup & checkout flow refactor (ios + android)",
  });
  rows.push({
    ts: fmt(incidentStart - 5 * 60_000),
    service: "db",
    version: "v1.9.2",
    description: "connection pool tuning (max_pool_size 50 -> 20)",
  });
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  await insertRows("deploys", rows);
  console.log(`deploys: ${rows.length} rows (mobile deploy ${fmt(mobileDeployAt)})`);
}

async function main() {
  console.log("Seeding ClickHouse…");
  await seedEvents();
  await seedLogs();
  await seedDeploys();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
