import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Cell,
} from "recharts";
import {
  ChevronDown, ChevronUp, Search, TrendingDown, TrendingUp, AlertTriangle,
  Facebook, Instagram, Youtube, Twitter, MessageCircle, Newspaper, Music2,
  UploadCloud, FileJson, FileSpreadsheet, Sparkles, RotateCcw, CheckCircle2, Loader2,
} from "lucide-react";
import './InsightDashboard.css';
import { aggregateRecords } from './lib/aggregate';
import { csvToJson } from './lib/csvToJson';

/* ============================================================
   DATA CONTEXT
   Data is now fetched at runtime from /data/*.json (see bottom
   of file for the fetch + provider) instead of being embedded
   here as static JSON. Regenerate those files with pre_process.py
   whenever the source data changes — no rebuild/redeploy of this
   component needed for new numbers, just refresh the JSON files.
   ============================================================ */
const DataContext = createContext(null);
function useData() {
  return useContext(DataContext);
}


/* ============================================================
   HELPERS
   ============================================================ */
const SENT_COLOR = { positive: "#4FD8A8", negative: "#E8664A", neutral: "#93A39D" };
const PLATFORM_ICON = {
  Facebook: Facebook, Instagram: Instagram, YouTube: Youtube, Twitter: Twitter,
  Reddit: MessageCircle, "News/Media": Newspaper, TikTok: Music2,
};

function isMismatch(r) {
  const { sentiment: s, sentiment_score: sc } = r;
  return (s === "positive" && sc < 50) || (s === "negative" && sc > 50) || (s === "neutral" && (sc > 70 || sc < 30));
}

function fmtDate(ts) {
  const d = new Date(ts.replace(" ", "T"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Standard ISO-8601 week key, e.g. "2026-W27" — matches how the weekly
// trend data was aggregated on the backend, so we can tell which weeks
// only have a partial set of days (currently just the last week in range).
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // move to this week's Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function daysPerWeekMap(PROCESSED) {
  const counts = {};
  PROCESSED.trend.daily.forEach((d) => {
    const key = isoWeekKey(d.date);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

function Header() {
  const { PROCESSED, brandName, mode } = useData();
  const { meta } = PROCESSED;
  const start = (meta.date_range.start || "").slice(0, 10);
  const end = (meta.date_range.end || "").slice(0, 10);
  return (
    <div className="tp-header">
      <div className="tp-eyebrow">Insight Starts Here · Social Listening Statement</div>
      <h1 className="tp-title tp-display">{brandName} <span>Public Sentiment</span></h1>
      <p className="tp-subtitle">
        {meta.summary_line || (
          <>A brand-manager's read of {meta.source_record_count} social posts mentioning {brandName}
          {" "}— what people are saying, where it hurts, and where the momentum's going.</>
        )}
      </p>
      <div className="tp-period">
        <b>STATEMENT PERIOD</b>
        {start && end ? `${start} — ${end}` : "—"}
        {mode === "custom" && <div className="tp-source-tag">your uploaded data</div>}
      </div>
    </div>
  );
}

function DataQualityNote() {
  const { PROCESSED } = useData();
  const [open, setOpen] = useState(false);
  const dq = PROCESSED.data_quality;
  return (
    <div className="tp-note">
      <div className="tp-note-head" onClick={() => setOpen(!open)}>
        <div className="tp-note-title">
          <AlertTriangle size={16} color="var(--gold)" />
          Footnotes on this data — {dq.off_topic_excluded_count + dq.sentiment_score_mismatch_count} items flagged, none hidden
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      {open && (
        <div className="tp-note-body">
          <ul>
            {dq.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <div className="tp-note-metrics">
            <div className="tp-note-metric"><b>{dq.total_records}</b><span>raw posts collected</span></div>
            <div className="tp-note-metric"><b>{dq.off_topic_excluded_count}</b><span>off-topic, excluded from metrics</span></div>
            <div className="tp-note-metric"><b>{dq.sentiment_score_mismatch_count}</b><span>label/score mismatches (kept, flagged)</span></div>
            <div className="tp-note-metric"><b>{dq.distinct_duplicated_texts}</b><span>templated texts ({dq.duplicate_or_templated_text_count} posts)</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero() {
  const { PROCESSED } = useData();
  const o = PROCESSED.overview;
  return (
    <div className="tp-section" style={{ paddingTop: 30 }}>
      <div className="tp-hero-row">
        <div className="tp-hero-cell">
          <div className="tp-hero-num tp-mono" style={{ color: SENT_COLOR.negative }}>{o.negative_pct}%</div>
          <div className="tp-hero-label"><TrendingDown size={13} /> Negative</div>
          <div className="tp-hero-sub">{o.negative} of {o.total} posts</div>
        </div>
        <div className="tp-hero-cell">
          <div className="tp-hero-num tp-mono" style={{ color: SENT_COLOR.positive }}>{o.positive_pct}%</div>
          <div className="tp-hero-label"><TrendingUp size={13} /> Positive</div>
          <div className="tp-hero-sub">{o.positive} of {o.total} posts</div>
        </div>
        <div className="tp-hero-cell">
          <div className="tp-hero-num tp-mono" style={{ color: SENT_COLOR.neutral }}>{o.neutral_pct}%</div>
          <div className="tp-hero-label">Neutral</div>
          <div className="tp-hero-sub">avg score {o.avg_sentiment_score} / 100</div>
        </div>
      </div>
      <div className="tp-stackbar">
        <div className="tp-stackbar-seg" style={{ width: `${o.negative_pct}%`, background: SENT_COLOR.negative }} />
        <div className="tp-stackbar-seg" style={{ width: `${o.neutral_pct}%`, background: SENT_COLOR.neutral }} />
        <div className="tp-stackbar-seg" style={{ width: `${o.positive_pct}%`, background: SENT_COLOR.positive }} />
      </div>
      <div style={{ marginTop: 18 }}>
        <DataQualityNote />
      </div>
    </div>
  );
}

function TrendSection() {
  const { PROCESSED } = useData();
  const dayCounts = daysPerWeekMap(PROCESSED);
  const weekly = PROCESSED.trend.weekly.map((w) => ({
    ...w,
    daysCounted: dayCounts[w.week] || 7,
    isPartial: (dayCounts[w.week] || 7) < 7,
  }));
  const partialWeek = weekly.find((w) => w.isPartial);

  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Weekly Ledger</div>
          <div className="tp-section-title tp-display">How sentiment moved through June</div>
        </div>
        <div className="tp-section-note">Stacked bars = post volume by sentiment. Gold line = average sentiment score (0–100).</div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={weekly} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(243,239,228,0.08)" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fill: "#A9B8B2", fontSize: 11, fontFamily: "IBM Plex Mono" }}
            axisLine={{ stroke: "rgba(243,239,228,0.2)" }}
            tickLine={false}
            tickFormatter={(w, idx) => {
              const short = w.split("-")[1];
              return weekly[idx] && weekly[idx].isPartial ? `${short}*` : short;
            }}
          />
          <YAxis yAxisId="left" tick={{ fill: "#A9B8B2", fontSize: 11, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: "#A9B8B2", fontSize: 11, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#163A32", border: "1px solid rgba(243,239,228,0.2)", borderRadius: 8, fontSize: 12, fontFamily: "IBM Plex Sans" }}
            labelStyle={{ color: "#EAC17A" }}
            formatter={(value, name) => [value, name]}
            labelFormatter={(label, payload) => {
              const row = payload && payload[0] && payload[0].payload;
              if (row && row.isPartial) return `${label} — partial (${row.daysCounted}/7 days)`;
              return label;
            }}
          />
          <Bar yAxisId="left" dataKey="negative" stackId="s" fill={SENT_COLOR.negative} radius={[0, 0, 0, 0]}>
            {weekly.map((w, i) => (
              <Cell key={i} fillOpacity={w.isPartial ? 0.45 : 1} />
            ))}
          </Bar>
          <Bar yAxisId="left" dataKey="neutral" stackId="s" fill={SENT_COLOR.neutral}>
            {weekly.map((w, i) => (
              <Cell key={i} fillOpacity={w.isPartial ? 0.45 : 1} />
            ))}
          </Bar>
          <Bar yAxisId="left" dataKey="positive" stackId="s" fill={SENT_COLOR.positive} radius={[3, 3, 0, 0]}>
            {weekly.map((w, i) => (
              <Cell key={i} fillOpacity={w.isPartial ? 0.45 : 1} />
            ))}
          </Bar>
          <Line yAxisId="right" dataKey="avg_sentiment_score" stroke="#D4A24C" strokeWidth={2.5} dot={{ r: 3, fill: "#D4A24C" }} />
        </ComposedChart>
      </ResponsiveContainer>
      {partialWeek && (
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 8, fontFamily: "IBM Plex Mono, monospace" }}>
          * {partialWeek.week} only has {partialWeek.daysCounted} of 7 days in range — its shorter bar reflects less
          data collected, not a real drop in activity or sentiment.
        </div>
      )}
    </div>
  );
}

function TopicLedger({ activeTopic, setActiveTopic }) {
  const { PROCESSED } = useData();
  const topics = Object.entries(PROCESSED.by_topic).sort((a, b) => b[1].post_count - a[1].post_count);
  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Line Items</div>
          <div className="tp-section-title tp-display">What people are talking about</div>
        </div>
        <div className="tp-section-note">Bar shows negative share (coral) vs positive (mint). Click a row to filter the feed below.</div>
      </div>
      <div>
        {topics.map(([topic, d]) => (
          <div
            key={topic}
            className={`tp-ledger-row ${activeTopic === topic ? "active" : ""}`}
            onClick={() => setActiveTopic(activeTopic === topic ? null : topic)}
          >
            <div className="tp-ledger-name">{topic.replace(/_/g, " ")}</div>
            <div className="tp-ledger-track">
              <div style={{ display: "flex", height: "100%" }}>
                <div className="tp-ledger-fill" style={{ width: `${d.negative_pct}%`, background: SENT_COLOR.negative }} />
                <div className="tp-ledger-fill" style={{ width: `${d.neutral_pct}%`, background: SENT_COLOR.neutral }} />
                <div className="tp-ledger-fill" style={{ width: `${d.positive_pct}%`, background: SENT_COLOR.positive }} />
              </div>
            </div>
            <div className="tp-ledger-pct">{d.share_of_all_posts_pct}%</div>
            <div className="tp-ledger-count">{d.post_count} posts</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformGrid({ activePlatform, setActivePlatform }) {
  const { PROCESSED } = useData();
  const platforms = Object.entries(PROCESSED.by_platform);
  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">By Channel</div>
          <div className="tp-section-title tp-display">Where the conversation lives</div>
        </div>
        <div className="tp-section-note">Click a card to filter the feed below.</div>
      </div>
      <div className="tp-platform-grid">
        {platforms.map(([name, d]) => {
          const Icon = PLATFORM_ICON[name] || MessageCircle;
          const active = activePlatform === name;
          return (
            <div
              key={name}
              className="tp-platform-card"
              style={{ cursor: "pointer", borderColor: active ? "var(--gold)" : "var(--hairline)" }}
              onClick={() => setActivePlatform(active ? null : name)}
            >
              <div className="tp-platform-top">
                <Icon size={16} color="var(--gold)" />
                <span className="tp-platform-name">{name}</span>
                <span className="tp-platform-count">{d.post_count}</span>
              </div>
              <div className="tp-stackbar" style={{ height: 7 }}>
                <div className="tp-stackbar-seg" style={{ width: `${d.negative_pct}%`, background: SENT_COLOR.negative }} />
                <div className="tp-stackbar-seg" style={{ width: `${d.neutral_pct}%`, background: SENT_COLOR.neutral }} />
                <div className="tp-stackbar-seg" style={{ width: `${d.positive_pct}%`, background: SENT_COLOR.positive }} />
              </div>
              <div className="tp-platform-meta">
                <span>avg score {d.avg_sentiment_score}</span>
                <span>{Math.round(d.avg_reactions + d.avg_comments)} eng/post</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FailedTransactionInsight({ setActiveTopic, setActiveSentiment }) {
  const { PROCESSED, brandName, mode } = useData();
  const ft = PROCESSED.insight_failed_transactions;
  if (!ft) return null;
  const platformData = Object.entries(ft.platform_breakdown).map(([platform, count]) => ({ platform, count }));
  const driverLabel = ft.driver_topic ? ft.driver_topic.replace(/_/g, " ") : "failed transaction";
  const targetTopic = ft.driver_topic || "failed_transaction";
  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Our Product Call</div>
          <div className="tp-section-title tp-display">
            {mode === "custom" ? <>“{driverLabel}” is the #1 driver of negativity</> : "Failed transactions are the #1 problem"}
          </div>
        </div>
      </div>
      <div className="tp-ticket">
        <span className="tp-stamp">Priority fix</span>
        <p className="tp-headline">
          {mode === "custom" ? (
            <>{ft.headline}</>
          ) : (
            <><b>{ft.failed_transaction_share_of_negative_posts_pct}%</b> of all negative posts about {brandName} are about
            money stuck mid-transaction — more than fees, agent access, and app bugs combined. This is the single
            highest-leverage fix on the roadmap.</>
          )}
        </p>
        <div className="tp-stat-row">
          <div className="tp-stat">
            <div className="tp-stat-num" style={{ color: "var(--coral)" }}>{ft.failed_transaction_post_count}</div>
            <div className="tp-stat-label">posts about failed transactions</div>
          </div>
          <div className="tp-stat">
            <div className="tp-stat-num">{ft.failed_transaction_share_of_all_posts_pct}%</div>
            <div className="tp-stat-label">share of all brand posts</div>
          </div>
          <div className="tp-stat">
            <div className="tp-stat-num">{ft.avg_sentiment_score_failed_transaction}</div>
            <div className="tp-stat-label">avg score (vs {ft.avg_sentiment_score_overall_negative} for negative overall)</div>
          </div>
          <div className="tp-stat">
            <div className="tp-stat-num">{ft.total_engagement_on_failed_transaction_posts.toLocaleString()}</div>
            <div className="tp-stat-label">total reactions + comments</div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={platformData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="platform" width={80} tick={{ fill: "#A9B8B2", fontSize: 11.5, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#163A32", border: "1px solid rgba(243,239,228,0.2)", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "rgba(232,102,74,0.08)" }} />
              <Bar dataKey="count" fill="var(--coral)" radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <button
          className="tp-chip active"
          style={{ marginTop: 10 }}
          onClick={() => { setActiveTopic(targetTopic); setActiveSentiment("negative"); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }}
        >
          View these posts in the feed →
        </button>
      </div>
    </div>
  );
}

function CompetitorSection() {
  const { PROCESSED, brandName } = useData();
  const cc = PROCESSED.insight_competitor_comparison;
  const own = PROCESSED.overview;
  if (!cc) return null;
  const reasonLabels = {
    cashback_or_bonus: "Cashback / bonus offers",
    agent_availability: "Agent availability",
    customer_care: "Customer care",
    fees_or_charges: "Lower fees / charges",
  };
  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Stretch · Competitive Read</div>
          <div className="tp-section-title tp-display">{brandName} vs {cc.competitor_name}</div>
        </div>
        <div className="tp-section-note">
          {cc.mention_count} posts ({cc.share_of_all_posts_pct}% of volume) mention {cc.competitor_name} while
          discussing {brandName}.
        </div>
      </div>
      <div className="tp-vs-grid">
        <div className="tp-vs-card">
          <div className="tp-vs-name">{brandName} <span style={{ color: "var(--ink-faint)", fontSize: 13 }}>(overall)</span></div>
          <div className="tp-vs-line"><span>Avg sentiment score</span><span>{own.avg_sentiment_score}</span></div>
          <div className="tp-vs-line"><span>Negative share</span><span style={{ color: "var(--coral)" }}>{own.negative_pct}%</span></div>
          <div className="tp-vs-line"><span>Positive share</span><span style={{ color: "var(--mint)" }}>{own.positive_pct}%</span></div>
        </div>
        <div className="tp-vs-mid">vs</div>
        <div className="tp-vs-card">
          <div className="tp-vs-name">{cc.competitor_name} <span style={{ color: "var(--ink-faint)", fontSize: 13 }}>(in {brandName} posts)</span></div>
          <div className="tp-vs-line"><span>Avg sentiment score</span><span>{cc.avg_sentiment_score}</span></div>
          <div className="tp-vs-line"><span>Negative share</span><span style={{ color: "var(--coral)" }}>{cc.negative_pct}%</span></div>
          <div className="tp-vs-line"><span>Positive share</span><span style={{ color: "var(--mint)" }}>{cc.positive_pct}%</span></div>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <div className="tp-section-note" style={{ textAlign: "left", marginBottom: 10 }}>Why customers bring up {cc.competitor_name} instead:</div>
        {Object.entries(cc.why_competitor_is_favored).map(([reason, count]) => (
          <span className="tp-tag" key={reason}>{reasonLabels[reason] || reason} · {count}</span>
        ))}
      </div>
      <div className="tp-section-note" style={{ textAlign: "left", marginTop: 14, fontSize: 11.5 }}>
        Note: these two columns aren't perfectly apples-to-apples — the left is {brandName}'s whole conversation,
        the right is only the subset of {brandName} posts that also bring up {cc.competitor_name}. Read it as
        "how bad does it get when people are actively comparing," not a like-for-like brand score.
      </div>
    </div>
  );
}

function EngagementWeightedSection() {
  const { PROCESSED } = useData();
  const ew = PROCESSED.engagement_weighted_sentiment;
  const order = ["negative", "positive", "neutral"];
  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Quiet Signal</div>
          <div className="tp-section-title tp-display">Is negativity getting amplified?</div>
        </div>
        <div className="tp-section-note">Post share vs. share of total reactions + comments, per sentiment.</div>
      </div>
      {order.map((s) => {
        const d = ew[s];
        return (
          <div className="tp-eng-row" key={s}>
            <div style={{ textTransform: "capitalize", fontSize: 13, fontWeight: 500 }}>{s}</div>
            <div className="tp-eng-track">
              <div className="tp-eng-fill" style={{ width: `${d.post_share_pct}%`, background: SENT_COLOR[s], opacity: 0.55 }}>
                <span className="tp-eng-fill-label">posts {d.post_share_pct}%</span>
              </div>
            </div>
            <div className="tp-eng-track">
              <div className="tp-eng-fill" style={{ width: `${d.engagement_share_pct}%`, background: SENT_COLOR[s] }}>
                <span className="tp-eng-fill-label">engagement {d.engagement_share_pct}%</span>
              </div>
            </div>
            <div className="tp-eng-caption">{d.avg_engagement_per_post}/post avg</div>
          </div>
        );
      })}
      <div className="tp-section-note" style={{ textAlign: "left", marginTop: 14 }}>
        The two bars track closely for every sentiment — negative posts aren't getting disproportionately
        boosted by algorithms or virality here, they're just common.
      </div>
    </div>
  );
}

function PostFeed({ activeTopic, setActiveTopic, activePlatform, setActivePlatform, activeSentiment, setActiveSentiment }) {
  const { PROCESSED, RAW } = useData();
  const [search, setSearch] = useState("");
  const [showOffTopic, setShowOffTopic] = useState(false);
  const [sortBy, setSortBy] = useState("engagement");

  const topics = useMemo(() => ["all", ...Object.keys(PROCESSED.by_topic)], []);
  const platforms = useMemo(() => Object.keys(PROCESSED.by_platform), []);

  const filtered = useMemo(() => {
    let rows = RAW.filter((r) => showOffTopic || r.topic !== "off_topic");
    if (activeTopic) rows = rows.filter((r) => r.topic === activeTopic);
    if (activePlatform) rows = rows.filter((r) => r.platform === activePlatform);
    if (activeSentiment) rows = rows.filter((r) => r.sentiment === activeSentiment);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.text.toLowerCase().includes(q) || r.author.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => {
      if (sortBy === "engagement") return (b.reactions + b.comments) - (a.reactions + a.comments);
      if (sortBy === "recent") return new Date(b.timestamp) - new Date(a.timestamp);
      if (sortBy === "score_asc") return a.sentiment_score - b.sentiment_score;
      return b.sentiment_score - a.sentiment_score;
    });
    return rows.slice(0, 40);
  }, [activeTopic, activePlatform, activeSentiment, search, showOffTopic, sortBy]);

  const clearAll = () => { setActiveTopic(null); setActivePlatform(null); setActiveSentiment(null); setSearch(""); };
  const hasFilters = activeTopic || activePlatform || activeSentiment || search;

  return (
    <div className="tp-section">
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Raw Feed</div>
          <div className="tp-section-title tp-display">Read the actual posts</div>
        </div>
        <div className="tp-section-note">Showing top {filtered.length} of {RAW.length} raw posts, ranked by {sortBy === "engagement" ? "engagement" : sortBy === "recent" ? "most recent" : "sentiment score"}.</div>
      </div>

      <div className="tp-filter-bar">
        <div className="tp-search-wrap">
          <Search size={14} />
          <input className="tp-search" placeholder="Search text or author…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="tp-select" value={activeTopic || "all"} onChange={(e) => setActiveTopic(e.target.value === "all" ? null : e.target.value)}>
          {topics.map((t) => <option key={t} value={t}>{t === "all" ? "All topics" : t.replace(/_/g, " ")}</option>)}
        </select>
        <select className="tp-select" value={activePlatform || "all"} onChange={(e) => setActivePlatform(e.target.value === "all" ? null : e.target.value)}>
          <option value="all">All platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="tp-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="engagement">Most engagement</option>
          <option value="recent">Most recent</option>
          <option value="score_desc">Highest score</option>
          <option value="score_asc">Lowest score</option>
        </select>
        {["positive", "negative", "neutral"].map((s) => (
          <button key={s} className={`tp-chip ${activeSentiment === s ? "active" : ""}`} onClick={() => setActiveSentiment(activeSentiment === s ? null : s)}>
            {s}
          </button>
        ))}
        <button className="tp-chip" onClick={() => setShowOffTopic(!showOffTopic)} style={{ borderColor: showOffTopic ? "var(--gold)" : undefined, color: showOffTopic ? "var(--gold)" : undefined }}>
          {showOffTopic ? "hide" : "show"} off-topic (61)
        </button>
        {hasFilters && <button className="tp-chip" onClick={clearAll}>clear filters ×</button>}
      </div>

      <div className="tp-feed">
        {filtered.length === 0 && <div className="tp-empty">No posts match these filters.</div>}
        {filtered.map((r) => {
          const Icon = PLATFORM_ICON[r.platform] || MessageCircle;
          return (
            <div className="tp-feed-row" key={r.id}>
              <div className="tp-feed-platform">
                <Icon size={13} style={{ verticalAlign: -2, marginRight: 4 }} color="var(--gold)" />
                {r.platform}
                <div className="tp-feed-meta">{fmtDate(r.timestamp)}</div>
              </div>
              <div>
                <div className="tp-feed-text tp-bn">
                  {r.text}
                  {isMismatch(r) && <span className="tp-mismatch"><AlertTriangle size={10} /> label/score mismatch</span>}
                </div>
                <div className="tp-feed-meta">@{r.author} · {r.topic.replace(/_/g, " ")} · {r.language}</div>
              </div>
              <div className="tp-feed-sent" style={{ background: `${SENT_COLOR[r.sentiment]}22`, color: SENT_COLOR[r.sentiment] }}>
                {r.sentiment_score}
              </div>
              <div className="tp-feed-eng">{r.reactions.toLocaleString()} ♥ &nbsp;{r.comments} 💬</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   SITE BAR — the "Insight Starts Here" wordmark + mode switch
   ============================================================ */
function SiteBar({ mode, setMode, hasCustomData, onResetCustom }) {
  return (
    <div className="tp-sitebar">
      <div className="tp-sitebar-inner">
        <div className="tp-wordmark">
          <Sparkles size={16} color="var(--gold-bright)" />
          <span className="tp-display">Insight Starts Here</span>
        </div>
        <div className="tp-mode-switch">
          <button
            className={`tp-mode-btn ${mode === "sample" ? "active" : ""}`}
            onClick={() => setMode("sample")}
          >
            Sample report
          </button>
          <button
            className={`tp-mode-btn ${mode === "custom" ? "active" : ""}`}
            onClick={() => setMode("custom")}
          >
            Try it on your data
          </button>
          {mode === "custom" && hasCustomData && (
            <button className="tp-mode-reset" onClick={onResetCustom} title="Upload a different file">
              <RotateCcw size={13} /> new file
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   UPLOAD PANEL — "try it on your data" entry point
   Accepts CSV or JSON, converts CSV → JSON client-side, runs the
   same deterministic aggregation as pre_process.py (lib/aggregate.js),
   then asks the Groq-backed /api/generate-insights route to phrase
   the headline text from those numbers.
   ============================================================ */
function UploadPanel({ onReady }) {
  const [fileName, setFileName] = useState(null);
  const [brandName, setBrandName] = useState("");
  const [status, setStatus] = useState("idle"); // idle | reading | generating | error
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const requiredFieldsHint = "text, platform, sentiment, sentiment_score, topic, timestamp, reactions, comments";

  async function handleFile(file) {
    setError(null);
    setFileName(file.name);
    setStatus("reading");
    try {
      const raw = await file.text();
      let rows;
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(raw);
        rows = Array.isArray(parsed) ? parsed : parsed.records || parsed.data || [];
      } else {
        rows = csvToJson(raw);
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error("No rows found in that file.");
      }

      const { PROCESSED, RAW } = aggregateRecords(rows);
      const finalBrand = brandName.trim() || "Your Brand";

      setStatus("generating");
      try {
        const res = await fetch("/api/generate-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ PROCESSED }),
        });
        if (res.ok) {
          const gen = await res.json();
          if (gen.summary_line) PROCESSED.meta.summary_line = gen.summary_line;
          if (gen.failed_transaction_headline && PROCESSED.insight_failed_transactions) {
            PROCESSED.insight_failed_transactions.headline = gen.failed_transaction_headline;
          }
          if (gen.competitor_headline && PROCESSED.insight_competitor_comparison) {
            PROCESSED.insight_competitor_comparison.headline = gen.competitor_headline;
          }
        }
      } catch (e) {
        // Groq enrichment is best-effort — deterministic fallback headlines
        // already computed in aggregateRecords() carry the dashboard fine.
        console.warn("Groq enrichment skipped:", e.message);
      }

      onReady({ PROCESSED, RAW, brandName: finalBrand });
      setStatus("idle");
    } catch (e) {
      setError(e.message || "Couldn't read that file.");
      setStatus("error");
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="tp-section" style={{ paddingTop: 30 }}>
      <div className="tp-section-head">
        <div>
          <div className="tp-section-label">Try It On Your Data</div>
          <div className="tp-section-title tp-display">Upload your own social listening export</div>
        </div>
        <div className="tp-section-note">CSV or JSON. Your data replaces everything below — it never touches the sample report.</div>
      </div>

      <input
        placeholder="Brand name shown in the report (optional — defaults to “Your Brand”)"
        className="tp-search"
        style={{ marginBottom: 14, width: "100%", paddingLeft: 14 }}
        value={brandName}
        onChange={(e) => setBrandName(e.target.value)}
      />

      <div
        className={`tp-dropzone ${dragOver ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json,application/json,text/csv"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {status === "reading" || status === "generating" ? (
          <>
            <Loader2 size={26} className="tp-spin" color="var(--gold)" />
            <div className="tp-dropzone-title">{status === "reading" ? "Reading your file…" : "Generating insight text with Groq…"}</div>
            <div className="tp-dropzone-sub">{fileName}</div>
          </>
        ) : (
          <>
            <UploadCloud size={26} color="var(--gold)" />
            <div className="tp-dropzone-title">Drop a CSV or JSON file, or click to browse</div>
            <div className="tp-dropzone-sub">Expected columns: {requiredFieldsHint}</div>
            <div className="tp-dropzone-icons">
              <span><FileSpreadsheet size={13} /> .csv</span>
              <span><FileJson size={13} /> .json</span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="tp-upload-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="tp-section-note" style={{ textAlign: "left", marginTop: 16, maxWidth: "none" }}>
        Missing columns are filled with sensible defaults (unknown platform, neutral sentiment, today's date),
        so a rough export still renders — but the more of the expected columns you include, the more accurate
        the charts below will be.
      </div>
    </div>
  );
}

/* ============================================================
   ROOT
   ============================================================ */
// Where the two JSON files live. In Vite/CRA these paths resolve against
// the `public/` folder, so drop pre_process.py's output at:
//   public/data/processed_takapay_data.json
//   public/data/takapay_sample_data.json
// Re-running pre_process.py and refreshing the page is all it takes to
// pick up new numbers — no code change, no rebuild of this component.
const PROCESSED_URL = "/data/processed_takapay_data.json";
const RAW_URL = "/data/takapay_sample_data.json";

function DashboardBody({ data }) {
  const [activeTopic, setActiveTopic] = useState(null);
  const [activePlatform, setActivePlatform] = useState(null);
  const [activeSentiment, setActiveSentiment] = useState(null);

  return (
    <DataContext.Provider value={data}>
      <Header />
      <Hero />
      <TrendSection />
      <TopicLedger activeTopic={activeTopic} setActiveTopic={setActiveTopic} />
      <PlatformGrid activePlatform={activePlatform} setActivePlatform={setActivePlatform} />
      <FailedTransactionInsight setActiveTopic={setActiveTopic} setActiveSentiment={setActiveSentiment} />
      <CompetitorSection />
      <EngagementWeightedSection />
      <PostFeed
        activeTopic={activeTopic} setActiveTopic={setActiveTopic}
        activePlatform={activePlatform} setActivePlatform={setActivePlatform}
        activeSentiment={activeSentiment} setActiveSentiment={setActiveSentiment}
      />
      <div className="tp-footer">
        {data.mode === "custom"
          ? <>Insight Starts Here — generated from {data.PROCESSED.meta.source_record_count} of your uploaded posts</>
          : <>Insight Starts Here — generated from {data.PROCESSED.meta.source_record_count} sample posts · TakaPay demo report</>}
      </div>
    </DataContext.Provider>
  );
}

export default function InsightDashboard() {
  const [mode, setMode] = useState("sample"); // "sample" | "custom"
  const [sampleData, setSampleData] = useState(null);
  const [sampleError, setSampleError] = useState(null);
  const [customData, setCustomData] = useState(null); // { PROCESSED, RAW, brandName, mode } once uploaded

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pRes, rRes] = await Promise.all([fetch(PROCESSED_URL), fetch(RAW_URL)]);
        if (!pRes.ok) throw new Error(`Failed to load ${PROCESSED_URL} (${pRes.status})`);
        if (!rRes.ok) throw new Error(`Failed to load ${RAW_URL} (${rRes.status})`);
        const [PROCESSED, RAW] = await Promise.all([pRes.json(), rRes.json()]);
        if (!cancelled) setSampleData({ PROCESSED, RAW, brandName: "TakaPay", mode: "sample" });
      } catch (e) {
        if (!cancelled) setSampleError(e.message || "Failed to load sample dashboard data");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleReady = ({ PROCESSED, RAW, brandName }) => {
    setCustomData({ PROCESSED, RAW, brandName, mode: "custom" });
  };

  return (
    <div className="tp-root">
      <SiteBar
        mode={mode}
        setMode={setMode}
        hasCustomData={!!customData}
        onResetCustom={() => setCustomData(null)}
      />
      <div className="tp-shell">
        {mode === "sample" && (
          sampleError ? (
            <div className="tp-empty">Couldn't load the sample report: {sampleError}</div>
          ) : !sampleData ? (
            <div className="tp-empty">Loading sample social data…</div>
          ) : (
            <DashboardBody data={sampleData} />
          )
        )}

        {mode === "custom" && (
          customData ? (
            <DashboardBody data={customData} />
          ) : (
            <UploadPanel onReady={handleReady} />
          )
        )}
      </div>
    </div>
  );
}