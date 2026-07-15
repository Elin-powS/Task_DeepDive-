"""
TakaPay Social Listening — Data Preprocessing
================================================
Reads the raw social media sample data and produces a single, clean,
pre-aggregated JSON file that the frontend dashboard consumes directly.

No LLM calls here — pure deterministic data processing (pandas/stdlib).

Design principles:
- Never silently "fix" a label we can't verify (e.g. sentiment/score
  mismatches). Flag it, report it, let the human/brand-manager know.
- Separate "posts that mention the brand" noise (off_topic labeled rows)
  from genuine brand-sentiment metrics, but keep the raw count visible
  so nothing is hidden.
- Every number that lands on the dashboard should be traceable back to
  a specific slice of the raw records.
"""

import json
import os
from dotenv import load_dotenv
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent

RAW_PATH = PROJECT_ROOT / "takapay-dashboard" / "public" / "data" / "takapay_sample_data.json"
OUT_PATH = PROJECT_ROOT / "takapay-dashboard" / "public" / "data" / "processed_takapay_data.json"

# Assumes all topic="competitor" posts refer to a single named competitor
# in this dataset. If more than one competitor appears, this needs to
# become a per-post lookup instead of a single constant.
COMPETITOR_NAME = "NgoodPay"

# LLM enrichment (optional). Set GROQ_API_KEY to turn it on; leave it unset
# and the script runs exactly as before, using the deterministic f-string
# headlines that are already in the code below.

load_dotenv()  # Loads variables from .env
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")




def load_data():
    with open(RAW_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Data quality pass
# ---------------------------------------------------------------------------

def run_data_quality_checks(records):
    """
    Identify (but do not silently alter) rows with data issues.
    Returns a report dict + a set of ids to exclude from brand-sentiment
    metrics (off_topic rows), plus a set of ids whose sentiment label
    and sentiment_score disagree.
    """
    off_topic_ids = set()
    mismatch_ids = set()
    text_counts = Counter()
    author_counts = Counter()

    for r in records:
        text_counts[r["text"]] += 1
        author_counts[r["author"]] += 1

        if r["topic"] == "off_topic":
            off_topic_ids.add(r["id"])

        s, sc = r["sentiment"], r["sentiment_score"]
        is_mismatch = (
            (s == "positive" and sc < 50)
            or (s == "negative" and sc > 50)
            or (s == "neutral" and (sc > 70 or sc < 30))
        )
        if is_mismatch:
            mismatch_ids.add(r["id"])

    duplicate_texts = {t: c for t, c in text_counts.items() if c > 1}
    duplicate_record_count = sum(duplicate_texts.values())

    repeat_authors = {a: c for a, c in author_counts.items() if c > 1}
    top_repeat_authors = sorted(repeat_authors.items(), key=lambda kv: -kv[1])[:10]

    report = {
        "total_records": len(records),
        "off_topic_excluded_count": len(off_topic_ids),
        "sentiment_score_mismatch_count": len(mismatch_ids),
        "duplicate_or_templated_text_count": duplicate_record_count,
        "distinct_duplicated_texts": len(duplicate_texts),
        "repeat_authors": {
            "unique_author_count": len(author_counts),
            "authors_with_multiple_posts": len(repeat_authors),
            "max_posts_by_single_author": max(author_counts.values()) if author_counts else 0,
            "top_repeat_authors": [{"author": a, "post_count": c} for a, c in top_repeat_authors],
        },
        "notes": [
            "Every record has brand_mention=True in the raw data, including "
            "posts unrelated to TakaPay (e.g. traffic, food, exam stress). "
            "These are identified via topic='off_topic' and excluded from "
            "all brand-sentiment metrics below, but the count is preserved "
            "here for transparency.",
            "A small number of records have a sentiment label that "
            "disagrees with their numeric sentiment_score (e.g. labeled "
            "negative but score > 50). These are NOT auto-corrected since "
            "we cannot verify which field is right; they are counted here "
            "and left as-is in the underlying data.",
            "Some posts are near-duplicate templates with a swapped noun "
            "(operator name, area name) — consistent with synthetically "
            "generated sample data. They are kept in aggregate counts "
            "since they still represent real topic/sentiment signal, but "
            "flagged here so it isn't mistaken for organic repetition.",
            "A handful of accounts post more than once; checked here so "
            "raw post-volume isn't mistaken for unique-voice volume "
            "(possible brigading/bot signal, though not confirmed as such).",
        ],
    }
    return report, off_topic_ids, mismatch_ids


# ---------------------------------------------------------------------------
# Core aggregates
# ---------------------------------------------------------------------------

def pct(n, d):
    return round(100 * n / d, 1) if d else 0.0


def sentiment_breakdown(records):
    c = Counter(r["sentiment"] for r in records)
    total = len(records)
    return {
        "total": total,
        "positive": c.get("positive", 0),
        "negative": c.get("negative", 0),
        "neutral": c.get("neutral", 0),
        "positive_pct": pct(c.get("positive", 0), total),
        "negative_pct": pct(c.get("negative", 0), total),
        "neutral_pct": pct(c.get("neutral", 0), total),
        "avg_sentiment_score": round(statistics.mean(r["sentiment_score"] for r in records), 1) if records else 0,
    }


def by_platform(records):
    platforms = defaultdict(list)
    for r in records:
        platforms[r["platform"]].append(r)
    out = {}
    for platform, rows in platforms.items():
        out[platform] = {
            "post_count": len(rows),
            **sentiment_breakdown(rows),
            "avg_reactions": round(statistics.mean(r["reactions"] for r in rows), 1),
            "avg_comments": round(statistics.mean(r["comments"] for r in rows), 1),
        }
    return dict(sorted(out.items(), key=lambda kv: -kv[1]["post_count"]))


def by_language(records):
    langs = defaultdict(list)
    for r in records:
        langs[r["language"]].append(r)
    out = {}
    for lang, rows in langs.items():
        out[lang] = {"post_count": len(rows), **sentiment_breakdown(rows)}
    return dict(sorted(out.items(), key=lambda kv: -kv[1]["post_count"]))


def confidence_band(n):
    """Sample-size caution flag, mirrors the reliability table in the
    analysis notebook — a striking percentage from 2 posts isn't a signal."""
    if n < 10:
        return "low (n<10) - don't trust the %"
    if n < 30:
        return "moderate (n<30)"
    return "solid"


def by_topic(records):
    topics = defaultdict(list)
    for r in records:
        topics[r["topic"]].append(r)
    out = {}
    for topic, rows in topics.items():
        breakdown = sentiment_breakdown(rows)
        out[topic] = {
            "post_count": len(rows),
            "confidence": confidence_band(len(rows)),
            "share_of_all_posts_pct": pct(len(rows), len(records)),
            **breakdown,
            "avg_reactions": round(statistics.mean(r["reactions"] for r in rows), 1),
            "avg_comments": round(statistics.mean(r["comments"] for r in rows), 1),
            "total_engagement": sum(r["reactions"] + r["comments"] for r in rows),
        }
    return dict(sorted(out.items(), key=lambda kv: -kv[1]["post_count"]))


def daily_trend(records):
    days = defaultdict(list)
    for r in records:
        day = r["timestamp"][:10]  # YYYY-MM-DD
        days[day].append(r)
    out = []
    for day in sorted(days.keys()):
        rows = days[day]
        b = sentiment_breakdown(rows)
        out.append({
            "date": day,
            "post_count": len(rows),
            "positive": b["positive"],
            "negative": b["negative"],
            "neutral": b["neutral"],
            "avg_sentiment_score": b["avg_sentiment_score"],
        })
    return out


def weekly_trend(daily):
    """Roll the daily trend up into ISO weeks for a calmer chart."""
    weeks = defaultdict(lambda: {"post_count": 0, "positive": 0, "negative": 0, "neutral": 0, "scores": []})
    for d in daily:
        dt = datetime.strptime(d["date"], "%Y-%m-%d")
        wk = f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
        w = weeks[wk]
        w["post_count"] += d["post_count"]
        w["positive"] += d["positive"]
        w["negative"] += d["negative"]
        w["neutral"] += d["neutral"]
        w["scores"].append(d["avg_sentiment_score"])
    out = []
    for wk in sorted(weeks.keys()):
        w = weeks[wk]
        out.append({
            "week": wk,
            "post_count": w["post_count"],
            "positive": w["positive"],
            "negative": w["negative"],
            "neutral": w["neutral"],
            "avg_sentiment_score": round(statistics.mean(w["scores"]), 1),
        })
    return out


def top_posts(records, sentiment=None, topic=None, n=5):
    rows = records
    if sentiment:
        rows = [r for r in rows if r["sentiment"] == sentiment]
    if topic:
        rows = [r for r in rows if r["topic"] == topic]
    ranked = sorted(rows, key=lambda r: r["reactions"] + r["comments"], reverse=True)[:n]
    return [
        {
            "id": r["id"],
            "platform": r["platform"],
            "text": r["text"],
            "sentiment": r["sentiment"],
            "sentiment_score": r["sentiment_score"],
            "topic": r["topic"],
            "reactions": r["reactions"],
            "comments": r["comments"],
            "engagement": r["reactions"] + r["comments"],
        }
        for r in ranked
    ]


# ---------------------------------------------------------------------------
# Product insight #1 (required "your product call"):
# Failed transactions as the dominant driver of negative sentiment
# ---------------------------------------------------------------------------

def failed_transaction_time_pattern(failed_all):
    """When do failed-transaction complaints spike? Mirrors the day/hour
    heatmap in the analysis notebook — actionable for support staffing,
    not just a monthly summary stat."""
    by_hour = Counter()
    by_day = Counter()
    for r in failed_all:
        dt = datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S")
        by_hour[dt.hour] += 1
        by_day[dt.strftime("%A")] += 1

    day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    return {
        "by_hour": {str(h): by_hour.get(h, 0) for h in range(24)},
        "by_day": {d: by_day.get(d, 0) for d in day_order},
        "busiest_hour": by_hour.most_common(1)[0][0] if by_hour else None,
        "busiest_day": by_day.most_common(1)[0][0] if by_day else None,
    }


def failed_transaction_deep_dive(records):
    negatives = [r for r in records if r["sentiment"] == "negative"]
    failed_all = [r for r in records if r["topic"] == "failed_transaction"]
    failed_negative = [r for r in failed_all if r["sentiment"] == "negative"]

    platform_split = Counter(r["platform"] for r in failed_all)

    return {
        "headline": (
            f"{pct(len(failed_negative), len(negatives))}% of all negative "
            f"posts about TakaPay are specifically about failed or stuck "
            f"transactions — the single largest driver of negative "
            f"sentiment, ahead of fees, agent access, or app bugs combined."
        ),
        "failed_transaction_post_count": len(failed_all),
        "failed_transaction_share_of_all_posts_pct": pct(len(failed_all), len(records)),
        "failed_transaction_share_of_negative_posts_pct": pct(len(failed_negative), len(negatives)),
        "avg_sentiment_score_failed_transaction": round(statistics.mean(r["sentiment_score"] for r in failed_all), 1) if failed_all else 0,
        "avg_sentiment_score_overall_negative": round(statistics.mean(r["sentiment_score"] for r in negatives), 1) if negatives else 0,
        "platform_breakdown": dict(platform_split.most_common()),
        "total_engagement_on_failed_transaction_posts": sum(r["reactions"] + r["comments"] for r in failed_all),
        "most_viral_failed_transaction_complaints": top_posts(records, topic="failed_transaction", sentiment="negative", n=5),
        "time_pattern": failed_transaction_time_pattern(failed_all),
    }


# ---------------------------------------------------------------------------
# Stretch: TakaPay vs competitor (NgoodPay) comparison
# ---------------------------------------------------------------------------

def competitor_comparison(records):
    competitor_posts = [r for r in records if r["topic"] == "competitor"]
    sentiment_dist = sentiment_breakdown(competitor_posts)

    # Which "loss reasons" show up — cheap keyword bucketing, no LLM.
    reason_keywords = {
        "cashback_or_bonus": ["cashback", "bonus", "offer"],
        "agent_availability": ["agent"],
        "customer_care": ["customer care", "helpline", "support"],
        "fees_or_charges": ["charge", "fee", "extra"],
    }
    reason_counts = Counter()
    for r in competitor_posts:
        text_lower = r["text"].lower()
        for reason, keywords in reason_keywords.items():
            if any(kw in text_lower for kw in keywords):
                reason_counts[reason] += 1

    return {
        "competitor_name": COMPETITOR_NAME,
        "mention_count": len(competitor_posts),
        "share_of_all_posts_pct": pct(len(competitor_posts), len(records)),
        **sentiment_dist,
        "why_competitor_is_favored": dict(reason_counts.most_common()),
        "sample_posts": top_posts(records, topic="competitor", n=6),
    }


# ---------------------------------------------------------------------------
# Engagement-weighted sentiment (a quieter but important extra signal)
# ---------------------------------------------------------------------------

def engagement_weighted_view(records):
    by_sent = defaultdict(list)
    for r in records:
        by_sent[r["sentiment"]].append(r)

    out = {}
    total_engagement_all = sum(r["reactions"] + r["comments"] for r in records)
    for sentiment, rows in by_sent.items():
        eng = sum(r["reactions"] + r["comments"] for r in rows)
        out[sentiment] = {
            "post_count": len(rows),
            "post_share_pct": pct(len(rows), len(records)),
            "total_engagement": eng,
            "engagement_share_pct": pct(eng, total_engagement_all),
            "avg_engagement_per_post": round(eng / len(rows), 1) if rows else 0,
        }
    return out


# ---------------------------------------------------------------------------
# Optional LLM enrichment — rewrites a couple of headline strings using Groq.
# Everything the LLM sees is a number we already computed; it is only asked
# to phrase it, never to produce or change any number itself.
# ---------------------------------------------------------------------------

def _groq_chat(prompt, system):
    import requests  # only imported if this path actually runs
    resp = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
        json={
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
            "max_tokens": 120,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def enrich_headlines_with_llm(processed):
    """Rewrite a couple of headline strings via Groq. No-op (returns the
    dict unchanged) if GROQ_API_KEY isn't set, or if the call fails for
    any reason — the deterministic headlines already in `processed` are
    always a safe fallback, so a bad network day never breaks the build.
    """
    if not GROQ_API_KEY:
        return processed

    system = (
        "You write one-sentence headlines for a brand social-listening "
        "dashboard. Use ONLY the numbers given to you — never invent, "
        "round differently, or add any figure not provided. No hashtags, "
        "no emoji, no quotation marks around the sentence."
    )

    ft = processed["insight_failed_transactions"]
    try:
        ft["headline"] = _groq_chat(
            system=system,
            prompt=(
                f"failed_transaction posts are {ft['failed_transaction_share_of_all_posts_pct']}% "
                f"of all posts and {ft['failed_transaction_share_of_negative_posts_pct']}% of all "
                f"negative posts, with an average sentiment score of "
                f"{ft['avg_sentiment_score_failed_transaction']} (vs "
                f"{ft['avg_sentiment_score_overall_negative']} for negative posts overall). "
                "Write the headline."
            ),
        )
    except Exception as e:
        print(f"[groq] skipped failed_transaction headline: {e}")

    # Header subtitle — a one-sentence "brand manager's read" of the month,
    # built from overview + the single biggest topic + biggest platform.
    o = processed["overview"]
    top_topic_name, top_topic = max(processed["by_topic"].items(), key=lambda kv: kv[1]["post_count"])
    top_platform_name, top_platform = max(processed["by_platform"].items(), key=lambda kv: kv[1]["post_count"])
    try:
        processed["meta"]["summary_line"] = _groq_chat(
            system=(
                "You write a one-sentence, plain-English opening line for a brand "
                "social-listening dashboard, addressed to a brand manager. Use ONLY "
                "the numbers given — never invent or add any figure not provided. "
                "No hashtags, no emoji, no quotation marks."
            ),
            prompt=(
                f"{o['total']} posts mention the brand, {o['negative_pct']}% negative vs "
                f"{o['positive_pct']}% positive. The single biggest topic is "
                f"'{top_topic_name}' ({top_topic['post_count']} posts). The platform with "
                f"the most posts is {top_platform_name} ({top_platform['post_count']} posts). "
                "Write the one-sentence summary."
            ),
        )
    except Exception as e:
        print(f"[groq] skipped summary_line: {e}")

    cc = processed["insight_competitor_comparison"]
    try:
        top_reason = next(iter(cc["why_competitor_is_favored"]), None)
        cc["headline"] = _groq_chat(
            system=system,
            prompt=(
                f"{cc['competitor_name']} is mentioned in {cc['mention_count']} posts "
                f"({cc['share_of_all_posts_pct']}% of all posts), {cc['negative_pct']}% of "
                f"which are negative toward our brand, with the top cited reason being "
                f"'{top_reason}'. Write the headline."
            ),
        )
    except Exception as e:
        print(f"[groq] skipped competitor headline: {e}")

    return processed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    raw_records = load_data()

    quality_report, off_topic_ids, mismatch_ids = run_data_quality_checks(raw_records)

    # "Brand sentiment" records = everything genuinely about TakaPay
    brand_records = [r for r in raw_records if r["id"] not in off_topic_ids]

    processed = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_record_count": len(raw_records),
            "brand_relevant_record_count": len(brand_records),
            "date_range": {
                "start": min(r["timestamp"] for r in raw_records),
                "end": max(r["timestamp"] for r in raw_records),
            },
        },
        "data_quality": quality_report,
        "overview": sentiment_breakdown(brand_records),
        "by_platform": by_platform(brand_records),
        "by_language": by_language(brand_records),
        "by_topic": by_topic(brand_records),
        "trend": {
            "daily": daily_trend(brand_records),
            "weekly": weekly_trend(daily_trend(brand_records)),
        },
        "top_posts": {
            "most_viral_overall": top_posts(brand_records, n=5),
            "most_viral_negative": top_posts(brand_records, sentiment="negative", n=5),
            "most_viral_positive": top_posts(brand_records, sentiment="positive", n=5),
        },
        "engagement_weighted_sentiment": engagement_weighted_view(brand_records),
        "insight_failed_transactions": failed_transaction_deep_dive(brand_records),
        "insight_competitor_comparison": competitor_comparison(brand_records),
    }

    processed = enrich_headlines_with_llm(processed)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(processed, f, ensure_ascii=False, indent=2)

    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes)")
    print(f"Source records: {len(raw_records)} | Brand-relevant: {len(brand_records)} "
          f"| Off-topic excluded: {quality_report['off_topic_excluded_count']}")
    print(f"Sentiment mismatches flagged: {quality_report['sentiment_score_mismatch_count']}")
    print(f"Failed-transaction share of negative posts: "
          f"{processed['insight_failed_transactions']['failed_transaction_share_of_negative_posts_pct']}%")


if __name__ == "__main__":
    main()