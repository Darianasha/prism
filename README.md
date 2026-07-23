# ◇ Saddle — Mounted to success

A chat agent where **the response is the product**: every answer is a rendered, interactive
component — annotated charts, heatmaps, verdict cards — never a wall of text. Built on
**Trigger.dev** (a durable `chat.agent` runs the whole conversation as one long-lived task, plus a
scheduled cron) and **ClickHouse** (every number on screen comes from a real query). When the
warehouse can't answer, Saddle goes and gets the data — from the open web or public APIs — and
charts that instead.

## Features

**Answers as visuals, not prose**
- The agent may emit at most one verdict sentence, then answers exclusively through
  `render_component`. Component types: annotated timeseries (with deploy/incident/threshold
  markers), bar, multi-unit "strips" (each metric its own mini-panel on a shared axis), heatmap,
  scatter, bignumber verdict cards, and tables.
- Chart craft: gradient fills, rounded bars, value labels, compact strips, clean dark theme.

**Real data, never fabricated**
- Every number comes from a ClickHouse query. The SQL travels inside the tool call; the tool runs
  it server-side and streams the spec + rows straight to the UI, while the model only gets back a
  token-cheap receipt (`toModelOutput`).

**Reaches beyond the warehouse**
- `web_search` + `web_fetch` (provider-native): for real-world questions — sports, prices,
  populations, current events — the agent searches the open web, and the UI shows the **actual
  source URLs** it consulted as clickable citations.
- `fetch_dataset`: pulls **Open-Meteo** (hourly weather + air quality, keyless) or **any CSV/JSON
  URL** into ClickHouse, then queries it like everything else.

**Adapts to who's asking**
- Infers audience (engineer / exec / casual) and depth from wording, stores it in the durable
  session, shows it as a chip, and reshapes metrics, grain, and language. Override any time with
  the header picker — same data, different framing.

**Accounts, history, durable sessions**
- Shared-password login; a sidebar of your past conversations; full transcripts saved to
  ClickHouse and rehydrated when you reopen a chat. The Trigger.dev session is durable — refresh
  mid-answer and the stream resumes.

**Dashboards**
- Save any chart straight from chat (**＋ Dashboard**), or add tables from the manage page. Group
  them under a name; open one from the sidebar in the same window (sidebar stays put). Saved charts
  re-run **live** each visit, so they stay current.

**Provenance & freshness**
- A source registry records how each fetched table was obtained (kind, params, origin domain,
  whether it's refreshable). A **daily Trigger.dev cron** re-fetches refreshable sources so weather
  and live datasets don't go stale.
- Naming standard: fetched tables land as `wx_<place>` (weather) or `ext_<slug>` (URL ingests), so
  they never collide with the warehouse and are easy to recognise.

**Exports**
- Per chart: **CSV**, **JSON**, **PNG**.
- Per dashboard: **JSON**, **CSV**, and a self-contained **interactive HTML page** that re-renders
  the charts when opened.

## How it works

```
Browser (Next.js + useChat)            Trigger.dev chat.agent + cron
 login · sidebar · dashboards          tools:
      ▲                                  run_query / list_datasets  – explore the warehouse (read-only)
      │ streamed component parts         web_search / web_fetch     – reach the open web (cited sources)
      │ (specs + rows + citations)       fetch_dataset              – land weather / any CSV·JSON URL as a table
      └──────────────────────────────    render_component           – THE only way to answer
                                         update_profile / suggest_followups
                          │
                          ▼
   ClickHouse   canvas   → warehouse (events / logs / deploys) + fetched tables (wx_*, ext_*)
                prism_app → users, sessions, transcripts, sources, dashboards
                daily cron re-fetches refreshable sources
```

The agent is forbidden from answering in prose. It investigates first (`run_query`), then proves
the insight with one to a few `render_component` calls. For anything the warehouse can't hold it
searches the web or fetches a dataset first — it never refuses just because a local table is
missing, and it never invents numbers.

## Run it

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- **One LLM key** — `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `OPENAI_API_KEY`
  (optionally pin one with `PRISM_MODEL`, e.g. `openai:gpt-5.1`).
- **`TRIGGER_SECRET_KEY`** — a free dev key (`tr_dev_…`) from your Trigger.dev project.
- **`PRISM_DEMO_PASSWORD`** — the shared login password (`.env.example` uses `prism`).
- **`PRISM_AUTH_SECRET`** — any long random string (signs the login cookie).
- ClickHouse connection (defaults match `docker-compose.yml`).

```bash
# 1. ClickHouse + schemas + demo data
npm run db:up      # ClickHouse in Docker
npm run db:seed    # canvas warehouse: events / logs / deploys (planted incidents)
npm run db:app     # prism_app: users, sessions, transcripts, sources, dashboards

# 2. The agent (terminal A) and the app (terminal B)
npm run trigger:dev   # needs: npx trigger.dev@latest login  +  a project ref in trigger.config.ts
npm run dev           # → http://localhost:3000
```

Log in with **any username** + your `PRISM_DEMO_PASSWORD`.

Works with any of Anthropic / Google Gemini (free tier) / OpenAI — set the key you have, or pin one
via `PRISM_MODEL`. Provider-native web search runs on the same key (billed per search on OpenAI).
On Gemini's free tier (5 req/min) answers work but take ~1–2 minutes; the agent is tuned to a few
model calls per answer to fit.

## Demo script

1. **"Why did signups drop last week?"** — mobile signups collapsed 72% after the
   `mobile v2.4.0` deploy (Jul 13, 14:00). Web unaffected. The agent finds it and annotates the
   deploy on the chart.
2. **"Why was Tuesday slow?"** — db connection-pool exhaustion Tuesday 13:00–13:45 (a deploy at
   12:55 dropped the pool from 50 → 20), cascading into checkout timeouts.
3. **"Should I cycle tomorrow in Amsterdam?"** — no weather table exists; the agent fetches
   Open-Meteo (weather + air quality) into ClickHouse live as `wx_amsterdam`, then renders stacked
   weather strips (temperature / rain / wind on independent scales).
4. **"Why did Spain beat Argentina?"** — nothing in the warehouse; the agent runs `web_search`,
   shows the source domains it used, and charts the head-to-head (shots, possession, cards).
5. **The audience switch** — ask "why was Tuesday slow? I care about p99 latency" (chip flips to
   Engineer), then click **Exec** and re-ask: the same incident, reframed as customer impact.
6. **Save & export** — hit **＋ Dashboard** on a chart, open the dashboard from the sidebar, then
   **Export ▾ → Interactive page · HTML** for a shareable file.
7. **Refresh mid-answer** — the durable Trigger.dev session reconnects and the stream resumes.

## Data model

**`canvas`** — the warehouse the agent queries and charts:

| Table | Contents |
|---|---|
| `events` | 30 days of product analytics (page views, signups, checkouts × platform × country) |
| `logs` | 14 days of request logs across 6 services, with correlated incident traces |
| `deploys` | Deploy markers — the causes hiding behind both incidents |
| `wx_*`, `ext_*` | Fetched at runtime (weather / air quality, or ingested CSV·JSON) |

Re-seed anytime with `npm run db:seed` (deterministic PRNG, same story every time).

**`prism_app`** — app metadata, kept in a separate database so the agent's introspection never sees
it: `users`, `sessions`, `transcripts`, `sources` (provenance for fetched tables), `dashboard_items`
(saved charts). Created by `npm run db:app`.

## Trigger.dev tasks

Two tasks, both in `src/trigger/` (run locally with `npm run trigger:dev`):

1. **`prism`** — the `chat.agent` (`agent.ts`). The whole conversation runs as **one durable,
   resumable task**: it owns the tools, streams each turn, keeps per-session state (the audience/depth
   profile in `chat.local`), and survives a mid-answer refresh.
2. **`refresh-sources`** — a scheduled cron (`schedules.task` in `refresh.ts`, `0 5 * * *`). Once a
   day it re-fetches every source marked refreshable so weather and live datasets stay current.

## What we store (and where)

**ClickHouse — `canvas`** (the data the agent charts):
- `events` / `logs` / `deploys` — seeded demo data.
- `wx_*` / `ext_*` — tables fetched at runtime (weather/air quality, or ingested CSV·JSON). Fully
  replaced on each refresh.

**ClickHouse — `prism_app`** (app state; separate DB so the agent never introspects it):

| Table | Columns | Purpose |
|---|---|---|
| `users` | `user_id, username, created_at` | one row per account |
| `sessions` | `session_id, user_id, title, created_at, updated_at` | sidebar index of a user's chats (append-only, folded newest-title-wins) |
| `transcripts` | `session_id, user_id, messages, updated_at` | full UI-message JSON per session, so reopening rehydrates the conversation |
| `sources` | `table_name, source_kind, params, origin, refreshable, created_at, last_refreshed_at` | provenance + the **re-fetch recipe** for each fetched table (`params` is JSON: lat/lon/days, or url/format) — the daily cron reads this |
| `dashboard_items` | `user_id, dashboard, item_id, table_name, title, spec, active, added_at` | saved charts; `spec` is the full render spec (incl. its SQL), re-run live each visit; `active` handles add/remove |

**Trigger.dev cloud** (managed — not in our database):
- The **durable chat session** and its message history (owned by `chat.agent`).
- **`chat.local` `profile`** — the inferred `{audience, depth, signals}`, kept across turns.

**Browser:**
- A signed, HttpOnly **`prism_user` cookie** — `{userId, username}`, HMAC-signed with
  `PRISM_AUTH_SECRET` (not real auth; demo identity only).
- The **`chat` id** in the URL, so a mid-answer refresh reconnects to the same session.

**`.env`** (secrets — gitignored, never stored in a DB): the LLM key, `TRIGGER_SECRET_KEY`,
`PRISM_DEMO_PASSWORD`, `PRISM_AUTH_SECRET`.
