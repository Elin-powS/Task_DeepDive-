/**
 * aggregate.js
 * ---------------------------------------------------------------
 * Client-side JS port of pre_process.py's deterministic aggregation.
 * No LLM calls here — pure math, mirrors the Python script line for
 * line so numbers computed for the "try your own data" mode are
 * arrived at the exact same way as the numbers baked into the
 * default TakaPay dataset by pre_process.py.
 *
 * Input: an array of raw records. Each record is expected to have
 * (any missing field is defaulted so the dashboard never crashes):
 *   id, text, author, platform, language, topic,
 *   sentiment ("positive"|"negative"|"neutral"), sentiment_score (0-100),
 *   timestamp ("YYYY-MM-DD HH:MM:SS" or ISO), reactions, comments
 *
 * Output: a PROCESSED object with the same shape the dashboard
 * components already expect (overview, by_platform, by_language,
 * by_topic, trend, top_posts, engagement_weighted_sentiment,
 * insight_failed_transactions, insight_competitor_comparison, meta,
 * data_quality) — except the two "insight_*" sections are now
 * generic/best-effort instead of TakaPay-hardcoded, and are simply
 * omitted (set to null) when the uploaded data has no matching topic.
 * ---------------------------------------------------------------
 */

function pct(n, d) {
  return d ? Math.round((100 * n / d) * 10) / 10 : 0.0;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Normalize a raw uploaded row into the shape the rest of the app expects.
function normalizeRecord(r, i) {
  const reactions = Number(r.reactions ?? r.likes ?? r.upvotes ?? 0) || 0;
  const comments = Number(r.comments ?? r.replies ?? 0) || 0;
  let score = Number(r.sentiment_score ?? r.score ?? 50);
  if (Number.isNaN(score)) score = 50;
  let sentiment = (r.sentiment || "").toString().toLowerCase();
  if (!["positive", "negative", "neutral"].includes(sentiment)) {
    // Derive a sentiment label from the score if none was supplied.
    sentiment = score >= 60 ? "positive" : score <= 40 ? "negative" : "neutral";
  }
  let ts = r.timestamp || r.date || r.created_at || new Date().toISOString();
  ts = ts.toString().replace("T", " ").slice(0, 19);

  return {
    id: r.id ?? `row_${i}`,
    text: r.text ?? r.content ?? r.post ?? "",
    author: r.author ?? r.user ?? "unknown",
    platform: r.platform ?? r.source ?? "Unknown",
    language: r.language ?? "unknown",
    topic: (r.topic ?? r.category ?? "general").toString(),
    sentiment,
    sentiment_score: Math.max(0, Math.min(100, Math.round(score))),
    timestamp: ts,
    reactions,
    comments,
  };
}

function isMismatch(r) {
  const { sentiment: s, sentiment_score: sc } = r;
  return (
    (s === "positive" && sc < 50) ||
    (s === "negative" && sc > 50) ||
    (s === "neutral" && (sc > 70 || sc < 30))
  );
}

function runDataQualityChecks(records) {
  const offTopicIds = new Set();
  const mismatchIds = new Set();
  const textCounts = new Map();
  const authorCounts = new Map();

  records.forEach((r) => {
    textCounts.set(r.text, (textCounts.get(r.text) || 0) + 1);
    authorCounts.set(r.author, (authorCounts.get(r.author) || 0) + 1);
    if (r.topic === "off_topic") offTopicIds.add(r.id);
    if (isMismatch(r)) mismatchIds.add(r.id);
  });

  let duplicateRecordCount = 0;
  let distinctDuplicated = 0;
  textCounts.forEach((c) => {
    if (c > 1) {
      duplicateRecordCount += c;
      distinctDuplicated += 1;
    }
  });

  const repeatAuthors = [...authorCounts.entries()].filter(([, c]) => c > 1);
  repeatAuthors.sort((a, b) => b[1] - a[1]);
  const maxByAuthor = authorCounts.size ? Math.max(...authorCounts.values()) : 0;

  const report = {
    total_records: records.length,
    off_topic_excluded_count: offTopicIds.size,
    sentiment_score_mismatch_count: mismatchIds.size,
    duplicate_or_templated_text_count: duplicateRecordCount,
    distinct_duplicated_texts: distinctDuplicated,
    repeat_authors: {
      unique_author_count: authorCounts.size,
      authors_with_multiple_posts: repeatAuthors.length,
      max_posts_by_single_author: maxByAuthor,
      top_repeat_authors: repeatAuthors.slice(0, 10).map(([author, post_count]) => ({ author, post_count })),
    },
    notes: [
      "Rows tagged topic='off_topic' are excluded from brand-sentiment metrics below, but the raw count is kept here for transparency.",
      "Rows whose sentiment label disagrees with their numeric sentiment_score are NOT auto-corrected — we can't verify which field is right — just counted and flagged.",
      "Near-duplicate/templated text is kept in aggregate counts (still real signal) but flagged so it isn't mistaken for organic repetition.",
      "Authors who posted more than once are surfaced here so raw volume isn't mistaken for unique-voice volume.",
    ],
  };
  return { report, offTopicIds, mismatchIds };
}

function sentimentBreakdown(records) {
  const total = records.length;
  const c = { positive: 0, negative: 0, neutral: 0 };
  records.forEach((r) => { c[r.sentiment] = (c[r.sentiment] || 0) + 1; });
  return {
    total,
    positive: c.positive,
    negative: c.negative,
    neutral: c.neutral,
    positive_pct: pct(c.positive, total),
    negative_pct: pct(c.negative, total),
    neutral_pct: pct(c.neutral, total),
    avg_sentiment_score: round1(mean(records.map((r) => r.sentiment_score))),
  };
}

function groupBy(records, keyFn) {
  const map = new Map();
  records.forEach((r) => {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

function byPlatform(records) {
  const groups = groupBy(records, (r) => r.platform);
  const out = {};
  groups.forEach((rows, platform) => {
    out[platform] = {
      post_count: rows.length,
      ...sentimentBreakdown(rows),
      avg_reactions: round1(mean(rows.map((r) => r.reactions))),
      avg_comments: round1(mean(rows.map((r) => r.comments))),
    };
  });
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].post_count - a[1].post_count));
}

function byLanguage(records) {
  const groups = groupBy(records, (r) => r.language);
  const out = {};
  groups.forEach((rows, lang) => {
    out[lang] = { post_count: rows.length, ...sentimentBreakdown(rows) };
  });
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].post_count - a[1].post_count));
}

function confidenceBand(n) {
  if (n < 10) return "low (n<10) - don't trust the %";
  if (n < 30) return "moderate (n<30)";
  return "solid";
}

function byTopic(records) {
  const groups = groupBy(records, (r) => r.topic);
  const out = {};
  groups.forEach((rows, topic) => {
    const breakdown = sentimentBreakdown(rows);
    out[topic] = {
      post_count: rows.length,
      confidence: confidenceBand(rows.length),
      share_of_all_posts_pct: pct(rows.length, records.length),
      ...breakdown,
      avg_reactions: round1(mean(rows.map((r) => r.reactions))),
      avg_comments: round1(mean(rows.map((r) => r.comments))),
      total_engagement: rows.reduce((a, r) => a + r.reactions + r.comments, 0),
    };
  });
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].post_count - a[1].post_count));
}

function dailyTrend(records) {
  const groups = groupBy(records, (r) => r.timestamp.slice(0, 10));
  const days = [...groups.keys()].sort();
  return days.map((day) => {
    const rows = groups.get(day);
    const b = sentimentBreakdown(rows);
    return {
      date: day,
      post_count: rows.length,
      positive: b.positive,
      negative: b.negative,
      neutral: b.neutral,
      avg_sentiment_score: b.avg_sentiment_score,
    };
  });
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weeklyTrend(daily) {
  const weeks = new Map();
  daily.forEach((d) => {
    const wk = isoWeekKey(d.date);
    if (!weeks.has(wk)) weeks.set(wk, { post_count: 0, positive: 0, negative: 0, neutral: 0, scores: [] });
    const w = weeks.get(wk);
    w.post_count += d.post_count;
    w.positive += d.positive;
    w.negative += d.negative;
    w.neutral += d.neutral;
    w.scores.push(d.avg_sentiment_score);
  });
  return [...weeks.keys()].sort().map((wk) => {
    const w = weeks.get(wk);
    return {
      week: wk,
      post_count: w.post_count,
      positive: w.positive,
      negative: w.negative,
      neutral: w.neutral,
      avg_sentiment_score: round1(mean(w.scores)),
    };
  });
}

function topPosts(records, { sentiment = null, topic = null, n = 5 } = {}) {
  let rows = records;
  if (sentiment) rows = rows.filter((r) => r.sentiment === sentiment);
  if (topic) rows = rows.filter((r) => r.topic === topic);
  rows = [...rows].sort((a, b) => (b.reactions + b.comments) - (a.reactions + a.comments)).slice(0, n);
  return rows.map((r) => ({
    id: r.id, platform: r.platform, text: r.text, sentiment: r.sentiment,
    sentiment_score: r.sentiment_score, topic: r.topic, reactions: r.reactions,
    comments: r.comments, engagement: r.reactions + r.comments,
  }));
}

function engagementWeightedView(records) {
  const groups = groupBy(records, (r) => r.sentiment);
  const totalEngagementAll = records.reduce((a, r) => a + r.reactions + r.comments, 0);
  const out = {};
  groups.forEach((rows, sentiment) => {
    const eng = rows.reduce((a, r) => a + r.reactions + r.comments, 0);
    out[sentiment] = {
      post_count: rows.length,
      post_share_pct: pct(rows.length, records.length),
      total_engagement: eng,
      engagement_share_pct: pct(eng, totalEngagementAll),
      avg_engagement_per_post: rows.length ? round1(eng / rows.length) : 0,
    };
  });
  ["positive", "negative", "neutral"].forEach((s) => {
    if (!out[s]) out[s] = { post_count: 0, post_share_pct: 0, total_engagement: 0, engagement_share_pct: 0, avg_engagement_per_post: 0 };
  });
  return out;
}

// Generic version of the Python "product call" deep dive: instead of a
// hardcoded topic name ("failed_transaction"), pick whichever topic drives
// the largest share of negative sentiment in THIS dataset.
function biggestNegativeDriverInsight(records) {
  const negatives = records.filter((r) => r.sentiment === "negative");
  if (!negatives.length) return null;

  const negByTopic = groupBy(negatives, (r) => r.topic);
  let bestTopic = null, bestCount = -1;
  negByTopic.forEach((rows, topic) => {
    if (rows.length > bestCount) { bestTopic = topic; bestCount = rows.length; }
  });
  if (!bestTopic) return null;

  const topicAll = records.filter((r) => r.topic === bestTopic);
  const topicNegative = topicAll.filter((r) => r.sentiment === "negative");
  const platformSplit = {};
  topicAll.forEach((r) => { platformSplit[r.platform] = (platformSplit[r.platform] || 0) + 1; });

  const byHour = new Array(24).fill(0);
  const byDayMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
  topicAll.forEach((r) => {
    const dt = new Date(r.timestamp.replace(" ", "T"));
    if (!Number.isNaN(dt.getTime())) {
      byHour[dt.getHours()] += 1;
      const dayName = dt.toLocaleDateString("en-US", { weekday: "long" });
      if (dayName in byDayMap) byDayMap[dayName] += 1;
    }
  });
  const busiestHour = byHour.indexOf(Math.max(...byHour));
  const busiestDay = Object.entries(byDayMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    driver_topic: bestTopic,
    headline: `${pct(topicNegative.length, negatives.length)}% of all negative posts are about '${bestTopic.replace(/_/g, " ")}' — the single largest driver of negative sentiment in this dataset.`,
    failed_transaction_post_count: topicAll.length,
    failed_transaction_share_of_all_posts_pct: pct(topicAll.length, records.length),
    failed_transaction_share_of_negative_posts_pct: pct(topicNegative.length, negatives.length),
    avg_sentiment_score_failed_transaction: topicAll.length ? round1(mean(topicAll.map((r) => r.sentiment_score))) : 0,
    avg_sentiment_score_overall_negative: round1(mean(negatives.map((r) => r.sentiment_score))),
    platform_breakdown: Object.fromEntries(Object.entries(platformSplit).sort((a, b) => b[1] - a[1])),
    total_engagement_on_failed_transaction_posts: topicAll.reduce((a, r) => a + r.reactions + r.comments, 0),
    most_viral_failed_transaction_complaints: topPosts(records, { topic: bestTopic, sentiment: "negative", n: 5 }),
    time_pattern: {
      by_hour: Object.fromEntries(byHour.map((v, h) => [String(h), v])),
      by_day: byDayMap,
      busiest_hour: busiestHour,
      busiest_day: busiestDay,
    },
  };
}

// Generic competitor read: only produced if a topic literally called
// "competitor" (case-insensitive) exists in the uploaded data.
function competitorComparison(records) {
  const competitorPosts = records.filter((r) => r.topic.toLowerCase() === "competitor");
  if (!competitorPosts.length) return null;

  const sentimentDist = sentimentBreakdown(competitorPosts);
  const reasonKeywords = {
    cashback_or_bonus: ["cashback", "bonus", "offer"],
    agent_availability: ["agent"],
    customer_care: ["customer care", "helpline", "support"],
    fees_or_charges: ["charge", "fee", "extra"],
  };
  const reasonCounts = {};
  competitorPosts.forEach((r) => {
    const t = r.text.toLowerCase();
    Object.entries(reasonKeywords).forEach(([reason, kws]) => {
      if (kws.some((kw) => t.includes(kw))) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });
  });

  return {
    competitor_name: "Competitor",
    mention_count: competitorPosts.length,
    share_of_all_posts_pct: pct(competitorPosts.length, records.length),
    ...sentimentDist,
    why_competitor_is_favored: Object.fromEntries(Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])),
    sample_posts: topPosts(records, { topic: "competitor", n: 6 }),
    headline: `${sentimentDist.negative_pct}% of posts mentioning the competitor skew negative toward your brand.`,
  };
}

/**
 * Main entry point: takes raw uploaded rows, returns { PROCESSED, RAW }
 * in the exact shape the dashboard components already consume.
 */
export function aggregateRecords(rawRows) {
  const RAW = rawRows.map(normalizeRecord);
  const { report, offTopicIds } = runDataQualityChecks(RAW);
  const brandRecords = RAW.filter((r) => !offTopicIds.has(r.id));
  const useRecords = brandRecords.length ? brandRecords : RAW; // don't blank the dashboard if everything got excluded

  const daily = dailyTrend(useRecords);
  const timestamps = RAW.map((r) => r.timestamp).sort();

  const PROCESSED = {
    meta: {
      generated_at: new Date().toISOString(),
      source_record_count: RAW.length,
      brand_relevant_record_count: useRecords.length,
      date_range: {
        start: timestamps[0] || "",
        end: timestamps[timestamps.length - 1] || "",
      },
      summary_line: null, // filled in by the Groq API call, if available
    },
    data_quality: report,
    overview: sentimentBreakdown(useRecords),
    by_platform: byPlatform(useRecords),
    by_language: byLanguage(useRecords),
    by_topic: byTopic(useRecords),
    trend: { daily, weekly: weeklyTrend(daily) },
    top_posts: {
      most_viral_overall: topPosts(useRecords, { n: 5 }),
      most_viral_negative: topPosts(useRecords, { sentiment: "negative", n: 5 }),
      most_viral_positive: topPosts(useRecords, { sentiment: "positive", n: 5 }),
    },
    engagement_weighted_sentiment: engagementWeightedView(useRecords),
    insight_failed_transactions: biggestNegativeDriverInsight(useRecords),
    insight_competitor_comparison: competitorComparison(useRecords),
  };

  return { PROCESSED, RAW };
}
