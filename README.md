# ◇ Prism — answers, not walls of text

A chat agent where **the response is the product**: every answer is a rendered, interactive
component — annotated charts, heatmaps, verdict cards — never a wall of text. Built on
**Trigger.dev** (durable `chat.agent` runs the whole conversation as one long-lived task) and
**ClickHouse** (every number on screen comes from a real query).

## How it works

```
Browser (Next.js + useChat) ──► Trigger.dev chat.agent (Claude)
      ▲                              │  tools:
      │ streamed tool parts          │   list_datasets      – introspect the warehouse
      │ (component specs + rows)     │   run_query          – investigate hypotheses (read-only)
      └──────────────────────────────┤   fetch_dataset      – acquire missing data (Open-Meteo / any CSV-JSON URL)
                                     │   render_component   – THE only way to answer
                                     ▼
                                 ClickHouse
```

The agent is forbidden from answering in prose: at most one verdict sentence, then
`render_component` calls. The SQL travels in the tool call; the tool executes it server-side and
streams spec + rows straight to the UI, while the model only sees a small receipt
(`toModelOutput`), keeping tokens cheap. If the warehouse lacks data for a question (e.g. weather),
the agent ingests it into ClickHouse first, then queries it like everything else.

The agent also adapts **depth and audience**: it infers who it's talking to from wording
(p99 → engineer; revenue → exec; weather → casual), keeps the profile in the durable session,
shows it as a chip, and reshapes charts, grain, and language accordingly. Override anytime
with the header picker — same data, different truths.

## Run it

```bash
npm install
cp .env.example .env   # fill in: one LLM key + TRIGGER_SECRET_KEY (both have free options)

# 1. ClickHouse + demo data (planted incidents included)
npm run db:up
npm run db:seed

# 2. The agent (terminal A) and the app (terminal B)
npm run trigger:dev    # requires: npx trigger.dev@latest login (free) + a project ref in trigger.config.ts
npm run dev            # → http://localhost:3000
```

Works with any of Anthropic / Google Gemini (free tier) / OpenAI — set the key you have,
or pin one via `PRISM_MODEL` (e.g. `openai:gpt-5.1`). On Gemini's free tier (5 req/min) answers
work but take ~1–2 minutes; the agent is tuned to ~3–4 model calls per answer to fit.

## Demo script

1. **"Why did signups drop last week?"** — mobile signups collapsed 72% after the
   `mobile v2.4.0` deploy (Jul 13, 14:00). Web unaffected. The agent finds it and annotates the
   deploy on the chart.
2. **"Why was Tuesday slow?"** — db connection-pool exhaustion Tuesday 13:00–13:45 (a deploy at
   12:55 dropped the pool from 50 → 20), cascading into checkout timeouts.
3. **"Should I cycle tomorrow in Amsterdam?"** — no weather table exists; the agent fetches
   Open-Meteo (weather + air quality) into ClickHouse live, then renders stacked weather strips
   (temperature / rain / wind on independent scales) with a shaded "recommended ride window".
4. **The audience switch** — ask "why was Tuesday slow? I care about p99 latency" (profile chip
   flips to Engineer), then click **Exec** and re-ask: the same incident comes back as customer
   impact in plain language.
5. Refresh mid-answer — the durable Trigger.dev session reconnects and the stream resumes.

## Datasets

| Table | Contents |
|---|---|
| `events` | 30 days of product analytics (page views, signups, checkouts × platform × country) |
| `logs` | 14 days of request logs across 6 services, with correlated incident traces |
| `deploys` | Deploy markers — the causes hiding behind both incidents |

Re-seed anytime with `npm run db:seed` (deterministic PRNG, same story every time).
