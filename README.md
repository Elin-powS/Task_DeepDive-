# TakaPay Social Listening Dashboard

A social-listening dashboard that turns 660 raw, multilingual (Bangla/English) social media posts mentioning **TakaPay** (fictional mobile-wallet brand) into a sentiment and topic overview a non-technical brand manager can act on.

Built for the Associate Product Engineer take-home task — DeepDive, Markopolo AI.

**Live demo:** [INSERT LIVE URL HERE]

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Data Pipeline](#data-pipeline)
- [Dashboard Features](#dashboard-features)
- [Product Call: Chosen Insight](#product-call-chosen-insight)
- [Data Quality Notes](#data-quality-notes)
- [Running Locally](#running-locally)
- [Deployment (Vercel)](#deployment-vercel)
- [What I'd Improve With Another Week](#what-id-improve-with-another-week)
- [Where AI Helped, and Where I Overrode It](#where-ai-helped-and-where-i-overrode-it)
- [Project Structure](#project-structure)

---

## Overview

DeepDive's raw feed for TakaPay contains 660 records across seven platforms (Facebook, Reddit, Instagram, YouTube, TikTok, Twitter, News/Media), with sentiment, topic, and engagement fields already labeled — but not all of those labels are trustworthy as-is. This project:

1. **Cleans and aggregates** the raw dataset deterministically (Python), without silently "fixing" any label it can't verify.
2. **Presents it as a static, deployable dashboard** (React + Vite) that reads a single pre-computed JSON file — no backend, no live API calls, no runtime dependency on the raw dataset.
3. **Surfaces one clear, defensible product insight** beyond the required sentiment/topic overview, chosen for what a brand manager would actually act on first.

## Tech Stack

| Layer | Choice |
|---|---|
| Preprocessing (sample data) | Python (stdlib + `pandas`/`statistics`/`collections`), `python-dotenv` for local secrets |
| Preprocessing (user-uploaded data) | Client-side JS (`src/lib/aggregate.js`, `src/lib/csvToJson.js`) — mirrors `pre_process.py`'s aggregation logic so uploaded CSV/JSON gets the same metrics as the sample dataset |
| Optional LLM enrichment | Groq API (`llama-3.3-70b-versatile`), phrasing-only, no numeric generation — called from `pre_process.py` for the sample data, and from a `/api/generate-insights` serverless function for user-uploaded data |
| Frontend | React + Vite |
| Charts | Recharts (sentiment trend line/stacked bars) |
| Styling | Plain CSS (custom design system, no framework) |
| Hosting | Vercel (static build + one serverless function) |

## Architecture

There are two data paths into the same dashboard components:

**1. Sample data (default view) — fully static, computed ahead of time**

```
takapay_sample_data.json (raw, 660 records)
          │
          ▼
   pre_process.py   ──▶  processed_takapay_data.json  ──▶  React dashboard (Vite build)
   (deterministic          (single source of truth
    aggregation +           for the frontend)
    optional LLM
    headline phrasing)
```

**2. "Try It On Your Data" — computed live, in the browser + one serverless call**

```
user's CSV/JSON upload
          │
          ▼
  csvToJson.js (if CSV)  ──▶  aggregate.js  ──▶  same aggregate shape as pre_process.py
                                    │
                                    ▼
                    POST /api/generate-insights (Vercel serverless function)
                                    │
                                    ▼
                         Groq phrases 3 headline strings
                         (never invents/changes a number)
                                    │
                                    ▼
                         same React dashboard components
```

For the sample-data path, the frontend never touches raw records or performs aggregation itself — it renders the pre-computed `processed_takapay_data.json`, keeping those numbers traceable back to one auditable script. For the upload path, the same deterministic aggregation logic runs client-side (`src/lib/aggregate.js`), and only the *phrasing* of a few headline sentences is delegated to Groq — the underlying numbers are still 100% deterministic in both paths. If the Groq call fails or isn't configured, the upload path falls back to deterministic f-string headlines identical in spirit to the sample report's.

## Data Pipeline

`pre_process.py` runs a data-quality pass before computing any metric:

- **Off-topic exclusion** — every raw record is flagged `brand_mention=True`, including posts that are clearly unrelated to TakaPay (traffic, food, exam stress, etc.). These are identified via `topic="off_topic"` and excluded from all brand-sentiment metrics, with the excluded count preserved and shown on the dashboard rather than hidden.
- **Sentiment/score mismatch detection** — a small number of records have a `sentiment` label that disagrees with their numeric `sentiment_score` (e.g., labeled `negative` with a score above 50). These are **not auto-corrected**, since it's not possible to know which field is wrong from the data alone. They're counted and flagged instead.
- **Duplicate/templated text detection** — several posts are near-identical templates with a swapped noun (operator name, area name), consistent with synthetically generated sample data. They're kept in aggregate counts (they still represent real topic/sentiment signal) but flagged so it isn't mistaken for organic repetition.
- **Repeat-author check** — a handful of accounts post more than once. Flagged as a possible brigading/bot signal (not confirmed), so raw post volume isn't mistaken for unique-voice volume.

Every aggregate the dashboard shows — overview sentiment, per-platform/per-language/per-topic breakdowns, daily/weekly trend, top posts, engagement-weighted sentiment — is computed from the same `brand_records` (raw minus off-topic), so nothing on the dashboard silently includes noise.

## Dashboard Features

**Core**
- Overall sentiment picture (positive/negative/neutral split, average sentiment score)
- Topic/theme breakdown with post share and a confidence band per topic (low-n topics are visibly flagged as "don't trust the %" rather than presented with false confidence)
- Platform and language breakdowns
- Daily and weekly sentiment trend

**Product call**
- Failed-transaction deep dive (see below)

**Stretch**
- TakaPay vs. competitor (NgoodPay) comparison, with keyword-bucketed reasons the competitor is favored (cashback/bonus, agent availability, customer care, fees)
- Engagement-weighted sentiment (raw post-count sentiment vs. sentiment weighted by reactions + comments — the two can tell different stories)
- Filterable, searchable post feed — clicking a topic row, platform card, or sentiment segment elsewhere on the dashboard cross-filters the feed below, in addition to manual search/sort controls
- **"Try It On Your Data"** — drag-and-drop a CSV or JSON export of your own and see the same dashboard rebuilt from it live, entirely client-side (never touches the sample report). Missing columns fall back to sensible defaults (unknown platform, neutral sentiment, today's date) so a rough export still renders.

## Product Call: Chosen Insight

**Failed/stuck transactions are the single largest driver of negative sentiment** — roughly 58% of all negative posts, ahead of fees, agent access, or app bugs individually.

Why this over other candidate insights: a wallet's core promise is that money moves reliably. A failed-transaction complaint is a trust issue, not a UX annoyance, and it's the one lever most likely to move the overall negative-sentiment number if fixed. The dashboard surfaces this as its own section with:
- Share of all posts and share of all negative posts
- Average sentiment score for failed-transaction posts vs. negative posts overall
- Platform breakdown (where the complaints concentrate)
- Time-of-day / day-of-week pattern (useful for support staffing decisions, not just a monthly summary number)
- The most-viral failed-transaction complaints, so a brand manager can see the actual voice behind the number

## Data Quality Notes

Summarized from the exploratory analysis (`takapay_analysis.ipynb`) and the preprocessing script's own quality pass:

- **~9% of "TakaPay" mentions (61 of 660) are off-topic** — content incorrectly flagged as a brand mention. This is a data-collection issue worth fixing upstream before trusting brand-mention volume as a KPI on its own.
- **6 records have a sentiment label that disagrees with their numeric sentiment_score.** Left as-is and flagged rather than auto-corrected, since the source of truth between the two fields can't be determined from the data.
- **A number of posts are near-duplicate templates** with a swapped noun (operator/area name), consistent with synthetically generated sample data.
- **72 authors posted more than once** (out of 583 unique authors), with the most active author posting 3 times — worth a light watch, not currently large enough to call it brigading.
- **NgoodPay (the competitor) appears exclusively in a negative context relative to TakaPay**, concentrated around cashback/bonus offers and fees — suggesting a pricing/promotions gap rather than a product-quality gap.

## Running Locally

**1. Preprocess the data**

```bash
cd path/to/project
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python pre_process.py
```

This reads `takapay-dashboard/public/data/takapay_sample_data.json` and writes `takapay-dashboard/public/data/processed_takapay_data.json`.

Optional LLM headline phrasing (off by default): create a `.env` file in the project root with `GROQ_API_KEY=your_key_here` (loaded automatically via `python-dotenv`, which searches upward from wherever you run the script). If it's unset, or if the request fails for any reason, the script falls back to deterministic f-string headlines — the build never breaks because of a missing key or a network issue. **Do not commit `.env` — it should be listed in `.gitignore`.**

**2. Run the dashboard**

```bash
cd takapay-dashboard
npm install
npm run dev
```

To also test the **"Try It On Your Data"** upload feature locally (not required just to view the sample report), the frontend's dev server needs its own `.env`: Vite's `loadEnv` only reads the exact directory you run it from and does **not** search upward like `python-dotenv` does, so add a second `.env` (or copy the project-root one) directly inside `takapay-dashboard/`, next to `package.json`:

```bash
cp ../.env .env   # from inside takapay-dashboard/
```

Without it, uploads still work end-to-end — headlines just fall back to the deterministic wording instead of Groq's phrasing.

## Deployment (Vercel)

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. `processed_takapay_data.json` is a static asset under `public/data/` and ships with the build — the **sample report** needs no environment variables or serverless functions at runtime.
5. The **"Try It On Your Data" upload feature** does call Groq live, via the `api/generate-insights.js` serverless function that Vercel auto-deploys from the `api/` folder. For that to work in production:
   - Add `GROQ_API_KEY` under Project Settings → Environment Variables (Production, and Preview if you want PR previews to have it too).
   - Redeploy after adding/changing it — env vars aren't picked up by already-built deployments.
   - If it's left unset, the upload feature still works end-to-end; it just silently falls back to the same deterministic f-string headlines the sample report uses, instead of Groq-phrased ones.
6. Locally, `npm run dev` (plain Vite) doesn't understand `/api` routes the way Vercel does — `vite-dev-api-plugin.js` emulates that route in dev only, using the exact same logic (`api/_lib/groqInsights.js`) so local and production behave identically. Nothing extra to configure for this in Vercel itself; it's dev-only plumbing.
7. Deploy. Live URL: **[INSERT LIVE URL HERE]**

## What I'd Improve With Another Week

- Fix off-topic mislabeling upstream instead of filtering it downstream, so "brand mention volume" can be trusted as a tracked metric without caveats.
- Replace the hardcoded `COMPETITOR_NAME` constant with a name derived/verified from the actual post text, so the label doesn't silently mislabel a second competitor if one appears in future data.
- Add a lightweight backend (or scheduled job) so the dashboard reflects new data automatically instead of requiring a manual `pre_process.py` re-run before each deploy.
- Expand the keyword-based "why the competitor is favored" bucketing into something more robust than substring matching.
- Add automated tests around the data-quality pass (off-topic exclusion, mismatch detection) so a future dataset change can't silently break the guarantees this README describes.

## Where AI Helped, and Where I Overrode It

- AI assistance was used for scaffolding the preprocessing script's aggregation functions, the exploratory notebook structure, and drafting dashboard CSS/layout.
- I overrode/caught the following:
  - An early version of the preprocessing script auto-corrected sentiment/score mismatches rather than flagging them — I rejected this, since neither field can be independently verified as correct from the data alone.
  - The optional Groq LLM enrichment step was scoped and constrained deliberately: it only rephrases numbers already computed deterministically, and is explicitly instructed never to invent or round a figure — this was a product decision, not a default the AI suggested.
  - An early draft of the script read the Groq key incorrectly (`os.environ.get()` was passed the literal key instead of the variable name `"GROQ_API_KEY"`), which would have leaked the key into version control. Caught during review and fixed to load the key from a `.env` file via `python-dotenv`, with `.env` excluded from Git.
  - The `COMPETITOR_NAME` constant was flagged as a fragile assumption (documented above) rather than accepted as a permanent design choice.

> **Security note:** `pre_process.py` now loads `GROQ_API_KEY` from a local `.env` file via `python-dotenv`, and no key is hardcoded in source. Confirm `.env` is listed in `.gitignore` before pushing to a public repository, and rotate any key that may have been exposed during earlier local testing.

## Project Structure

```
.
├── pre_process.py                          # Deterministic data cleaning & aggregation (sample data)
├── requirements.txt                        # Python dependencies (pandas, requests, python-dotenv)
├── .env                                    # Local-only, holds GROQ_API_KEY for pre_process.py (not committed)
├── takapay_analysis.ipynb                  # Exploratory data analysis
├── README.md
│
└── takapay-dashboard/
    ├── .env                                 # Local-only copy, holds GROQ_API_KEY for `npm run dev` (not committed)
    ├── vite.config.js                       # Wires up devApiPlugin() + loads GROQ_API_KEY for local dev only
    ├── vite-dev-api-plugin.js               # Dev-only: makes plain `vite dev` understand POST /api/generate-insights
    │
    ├── public/
    │   └── data/
    │       ├── takapay_sample_data.json     # Raw input (660 records)
    │       └── processed_takapay_data.json  # Aggregated output consumed by the frontend
    │
    ├── api/
    │   ├── generate-insights.js             # Vercel serverless function — the real production endpoint
    │   └── _lib/
    │       └── groqInsights.js              # Shared Groq-calling logic, reused by vite-dev-api-plugin.js in dev
    │
    ├── src/
    │   ├── lib/
    │   │   ├── aggregate.js                 # Client-side aggregation (mirrors pre_process.py, for uploaded data)
    │   │   └── csvToJson.js                 # Dependency-free CSV → JSON parser for uploaded data
    │   │
    │   ├── App.jsx
    │   ├── App.css
    │   ├── index.css
    │   ├── main.jsx
    │   ├── InsightDashboard.jsx             # Main dashboard component (sample + uploaded-data modes)
    │   └── InsightDashboard.css
    │
    └── index.html
```