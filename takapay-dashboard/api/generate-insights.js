/**
 * /api/generate-insights
 * -----------------------------------------------------------------
 * Server-side only. Reads GROQ_API_KEY from Vercel's environment
 * variables (never exposed to the browser) and asks Groq to phrase
 * a handful of headline strings from numbers the client already
 * computed with lib/aggregate.js. The model is only ever given
 * numbers — it is never allowed to invent or change a figure, only
 * to phrase it in a sentence.
 *
 * Request body: { PROCESSED }  (the object returned by aggregateRecords)
 * Response body: { summary_line, failed_transaction_headline, competitor_headline }
 *   — any of these may be null if that section wasn't present in the
 *   uploaded data, or if the Groq call failed (never throws — the
 *   dashboard always has deterministic fallback text).
 * -----------------------------------------------------------------
 */

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

async function groqChat(system, prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set in environment");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 120,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { PROCESSED } = req.body || {};
  if (!PROCESSED) return res.status(400).json({ error: "Missing PROCESSED in request body" });

  const headlineSystem =
    "You write one-sentence headlines for a brand social-listening dashboard. " +
    "Use ONLY the numbers given to you — never invent, round differently, or add " +
    "any figure not provided. No hashtags, no emoji, no quotation marks.";

  const out = { summary_line: null, failed_transaction_headline: null, competitor_headline: null };

  const tasks = [];

  const o = PROCESSED.overview;
  if (o && PROCESSED.by_topic && PROCESSED.by_platform) {
    const topicEntries = Object.entries(PROCESSED.by_topic);
    const platformEntries = Object.entries(PROCESSED.by_platform);
    if (topicEntries.length && platformEntries.length) {
      const [topTopicName, topTopic] = topicEntries.reduce((a, b) => (b[1].post_count > a[1].post_count ? b : a));
      const [topPlatformName, topPlatform] = platformEntries.reduce((a, b) => (b[1].post_count > a[1].post_count ? b : a));
      tasks.push(
        groqChat(
          "You write a one-sentence, plain-English opening line for a brand social-listening dashboard, addressed to a brand manager. Use ONLY the numbers given — never invent or add any figure not provided. No hashtags, no emoji, no quotation marks.",
          `${o.total} posts analyzed, ${o.negative_pct}% negative vs ${o.positive_pct}% positive. The single biggest topic is '${topTopicName}' (${topTopic.post_count} posts). The platform with the most posts is ${topPlatformName} (${topPlatform.post_count} posts). Write the one-sentence summary.`
        ).then((text) => { out.summary_line = text; }).catch((e) => console.error("[groq] summary_line failed:", e.message))
      );
    }
  }

  const ft = PROCESSED.insight_failed_transactions;
  if (ft) {
    tasks.push(
      groqChat(
        headlineSystem,
        `'${ft.driver_topic}' posts are ${ft.failed_transaction_share_of_all_posts_pct}% of all posts and ${ft.failed_transaction_share_of_negative_posts_pct}% of all negative posts, with an average sentiment score of ${ft.avg_sentiment_score_failed_transaction} (vs ${ft.avg_sentiment_score_overall_negative} for negative posts overall). Write the headline.`
      ).then((text) => { out.failed_transaction_headline = text; }).catch((e) => console.error("[groq] failed_transaction headline failed:", e.message))
    );
  }

  const cc = PROCESSED.insight_competitor_comparison;
  if (cc) {
    const topReason = Object.keys(cc.why_competitor_is_favored || {})[0] || null;
    tasks.push(
      groqChat(
        headlineSystem,
        `A competitor is mentioned in ${cc.mention_count} posts (${cc.share_of_all_posts_pct}% of all posts), ${cc.negative_pct}% of which are negative toward our brand${topReason ? `, with the top cited reason being '${topReason}'` : ""}. Write the headline.`
      ).then((text) => { out.competitor_headline = text; }).catch((e) => console.error("[groq] competitor headline failed:", e.message))
    );
  }

  await Promise.all(tasks);
  return res.status(200).json(out);
}
