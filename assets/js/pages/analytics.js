// Analytics: trends and breakdowns computed from NavAble records for the
// selected period. Rows are fetched page by page (see NavAbleKit.allRows), so
// totals stay correct past the 1,000-row response limit.
//
// Period filters: users.created_at (role User), reports.created_at,
// reviews.review_date, locations.created_at, ai_results.analyzed_at.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const periodSelect = document.getElementById("periodSelect");
  const periodLabel = document.getElementById("periodLabel");
  const downloadButton = document.getElementById("analyticsDownload");
  const panel = (name) => main.querySelector(`[data-panel="${name}"]`);

  const PERIODS = {
    30: { days: 30, label: "the last 30 days" },
    90: { days: 90, label: "the last 90 days" },
    365: { days: 365, label: "the last 12 months" },
    all: { days: null, label: "all time" }
  };
  const REPORT_STATUSES = ["Pending", "Verified", "Resolved", "Rejected"];
  const AI_STATUSES = ["Detected", "Not Detected", "Needs Verification"];

  const initialPeriod = K.param("period");
  if (initialPeriod && PERIODS[initialPeriod]) periodSelect.value = initialPeriod;
  let csvRows = [];

  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "short" });
  const monthYearLabel = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });

  // ---------- helpers ----------

  function periodStart() {
    const { days } = PERIODS[periodSelect.value];
    return days ? new Date(Date.now() - days * 86400000) : null;
  }

  const withSince = (query, column, since) => (since ? query.gte(column, since.toISOString()) : query);

  function weekStart(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  // Builds time buckets from start to now and counts dates into them.
  function bucketize(dates, start, unit) {
    const now = new Date();
    const list = [];
    let cursor;
    if (unit === "week") cursor = weekStart(start);
    else if (unit === "month") cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    else cursor = new Date(start.getFullYear(), 0, 1);
    while (cursor <= now) {
      list.push({ start: new Date(cursor), total: 0 });
      if (unit === "week") cursor.setDate(cursor.getDate() + 7);
      else if (unit === "month") cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setFullYear(cursor.getFullYear() + 1);
    }
    dates.forEach((value) => {
      const time = new Date(value).getTime();
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (list[index].start.getTime() <= time) {
          list[index].total += 1;
          break;
        }
      }
    });
    return list;
  }

  function bucketLabel(date, unit, spansYears) {
    if (unit === "week") return K.format.shortDate.format(date);
    if (unit === "month") return (spansYears ? monthYearLabel : monthLabel).format(date);
    return String(date.getFullYear());
  }

  function bucketPlan(since, allDates) {
    if (since) return { start: since, unit: PERIODS[periodSelect.value].days <= 90 ? "week" : "month" };
    if (!allDates.length) return null;
    const earliest = new Date(allDates.reduce((min, value) => Math.min(min, new Date(value).getTime()), Infinity));
    const months = (new Date().getFullYear() - earliest.getFullYear()) * 12 + new Date().getMonth() - earliest.getMonth() + 1;
    return { start: earliest, unit: months > 24 ? "year" : "month" };
  }

  function renderColumns(target, buckets, unit, noun, emptyTitle) {
    const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
    if (!total) {
      target.replaceChildren(K.stateBox("empty", emptyTitle, `No ${noun}s in ${PERIODS[periodSelect.value].label}.`));
      return;
    }
    const max = Math.max(...buckets.map((bucket) => bucket.total));
    const spansYears = buckets.length && buckets[0].start.getFullYear() !== buckets[buckets.length - 1].start.getFullYear();
    const unitWord = unit === "week" ? "Week of" : unit === "month" ? "" : "Year";
    // With many columns, label every few so the dates stay readable.
    const labelEvery = Math.ceil(buckets.length / 7);
    target.replaceChildren(el("ol", { className: "nv-columns", "aria-label": `${noun[0].toUpperCase()}${noun.slice(1)}s per ${unit}, ${K.format.number.format(total)} in total` },
      buckets.map((bucket, index) => {
        const label = bucketLabel(bucket.start, unit, spansYears);
        const showLabel = (buckets.length - 1 - index) % labelEvery === 0;
        return el("li", { className: "nv-column" },
          el("span", { className: "nv-column-value", "aria-hidden": "true", text: K.format.number.format(bucket.total) }),
          el("span", { className: "nv-column-track", "aria-hidden": "true" },
            el("span", { className: "nv-column-fill", style: `height:${bucket.total ? Math.max(4, (bucket.total / max) * 100) : 0}%` })),
          el("span", { className: labelEvery > 1 ? "nv-column-label is-spread" : "nv-column-label", "aria-hidden": "true", text: showLabel ? label : " " }),
          el("span", { className: "sr-only", text: `${unitWord ? `${unitWord} ` : ""}${unit === "month" ? monthYearLabel.format(bucket.start) : label}: ${K.plural(bucket.total, noun)}` }));
      })));
  }

  function renderBars(target, entries, denominator, emptyTitle, emptyMessage, note) {
    if (!denominator) {
      target.replaceChildren(K.stateBox("empty", emptyTitle, emptyMessage));
      return;
    }
    const list = el("ul", { className: "nv-bars" }, entries.map(({ label, total }) => {
      const share = K.percent(total, denominator);
      return el("li", { className: "nv-bar-row" },
        el("span", { text: label }),
        el("strong", { text: `${K.format.number.format(total)} (${share}%)` }),
        el("span", { className: "nv-bar-track", role: "img", "aria-label": `${label}: ${K.format.number.format(total)}, ${share}%` },
          el("span", { className: "nv-bar-fill", style: `width:${share}%` })));
    }));
    target.replaceChildren(list, ...(note ? [el("p", { className: "nv-cell-sub", style: "margin-top:12px", text: note })] : []));
  }

  const tally = (rows, key, order) => {
    const counts = new Map();
    rows.forEach((row) => counts.set(row[key], (counts.get(row[key]) || 0) + 1));
    const keys = order || [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || String(a).localeCompare(String(b)));
    return keys.map((label) => ({ label: label ?? "Not set", total: counts.get(label) || 0 }));
  };

  const failBox = (target, title, reason) => target.replaceChildren(K.errorBox(title, reason, () => view.load({ announce: true })));

  // ---------- load ----------

  async function run() {
    const since = periodStart();
    const { label } = PERIODS[periodSelect.value];
    periodLabel.textContent = since ? `Records created in ${label} (since ${K.format.mediumDate.format(since)}).` : "Records created at any time.";
    downloadButton.disabled = true;
    main.querySelectorAll("[data-panel]").forEach((target) => {
      target.replaceChildren(target.dataset.panel.endsWith("Trend") ? el("span", { className: "nv-skeleton is-block" }) : K.skeletonLines(3));
    });

    const names = ["reports", "users", "reviews", "locations", "ai"];
    const settled = await Promise.allSettled([
      K.allRows(() => withSince(db.from("reports").select("created_at, report_type, status"), "created_at", since).order("report_id")),
      K.allRows(() => withSince(db.from("users").select("created_at").eq("role", "User"), "created_at", since).order("user_id")),
      K.allRows(() => withSince(db.from("reviews").select("rating, review_status"), "review_date", since).order("review_id")),
      K.allRows(() => withSince(db.from("locations").select("category, verification_status"), "created_at", since).order("location_id")),
      K.allRows(() => withSince(db.from("ai_results").select("detection_status, confidence_score, verified"), "analyzed_at", since).order("result_id"))
    ]);
    const data = Object.fromEntries(names.map((name, index) => [name, K.ok(settled[index])]));
    const reasons = Object.fromEntries(names.map((name, index) => [name, settled[index].reason]));
    csvRows = [];
    const add = (section, rowLabel, value) => csvRows.push([section, rowLabel, value]);
    add("Period", "Range", since ? `${since.toISOString()} to ${new Date().toISOString()}` : "All time");

    // Activity tiles
    const tiles = [["users", "New users", "users", "joined"], ["reports", "Reports submitted", "reports", "submitted"], ["reviews", "Reviews written", "reviews", "written"], ["locations", "Locations added", "locations", "added"]];
    tiles.forEach(([metric, title, key]) => {
      if (!data[key]) K.setStat(metric, { error: true });
      else {
        const meta = {
          users: "Accounts with role User",
          reports: `${K.format.number.format(data.reports.filter((r) => r.status === "Resolved").length)} resolved so far`,
          reviews: `${K.format.number.format(data.reviews.filter((r) => r.review_status === "Published").length)} published`,
          locations: `${K.format.number.format(data.locations.filter((l) => l.verification_status === "Verified").length)} verified so far`
        }[key];
        K.setStat(metric, { value: K.format.number.format(data[key].length), meta });
        add("Activity", title, data[key].length);
      }
    });

    // Trends share one time axis.
    const plan = bucketPlan(since, [...(data.reports || []), ...(data.users || [])].map((row) => row.created_at));
    const note = plan ? (plan.unit === "week" ? "Grouped by week, starting Monday." : plan.unit === "month" ? "Grouped by month." : "Grouped by year.") : "";
    main.querySelectorAll("[data-bucket-note]").forEach((node) => { node.textContent = note; });
    [["reportsTrend", "reports", "report", "No reports in this period"], ["usersTrend", "users", "new user", "No new users in this period"]].forEach(([panelName, key, noun, emptyTitle]) => {
      if (!data[key]) return failBox(panel(panelName), `${noun[0].toUpperCase()}${noun.slice(1)} trend could not load`, reasons[key]);
      if (!plan) return panel(panelName).replaceChildren(K.stateBox("empty", emptyTitle, "Nothing has been recorded yet."));
      const buckets = bucketize(data[key].map((row) => row.created_at), plan.start, plan.unit);
      renderColumns(panel(panelName), buckets, plan.unit, noun, emptyTitle);
      buckets.forEach((bucket) => add(`${noun} per ${plan.unit}`, bucket.start.toISOString().slice(0, 10), bucket.total));
    });

    // Breakdowns
    if (!data.reports) {
      failBox(panel("reportTypes"), "Report types could not load", reasons.reports);
      failBox(panel("reportStatuses"), "Report statuses could not load", reasons.reports);
    } else {
      const types = tally(data.reports, "report_type", K.REPORT_TYPES).sort((a, b) => b.total - a.total);
      renderBars(panel("reportTypes"), types, data.reports.length, "No reports in this period", "Issue types appear once reports are submitted.");
      types.forEach((entry) => add("Reports by type", entry.label, entry.total));
      const statuses = tally(data.reports, "status", REPORT_STATUSES);
      renderBars(panel("reportStatuses"), statuses, data.reports.length, "No reports in this period", "Statuses appear once reports are submitted.");
      statuses.forEach((entry) => add("Reports by status", entry.label, entry.total));
    }

    if (!data.reviews) failBox(panel("ratings"), "Ratings could not load", reasons.reviews);
    else {
      const published = data.reviews.filter((r) => r.review_status === "Published");
      const entries = [5, 4, 3, 2, 1].map((stars) => ({ label: `${stars} star${stars === 1 ? "" : "s"}`, total: published.filter((r) => r.rating === stars).length }));
      const average = published.length ? published.reduce((sum, r) => sum + r.rating, 0) / published.length : null;
      renderBars(panel("ratings"), entries, published.length, "No published reviews in this period", "Ratings appear once reviews are published.",
        average === null ? null : `Average ${K.format.decimal.format(average)} out of 5 across ${K.plural(published.length, "published review")}.`);
      entries.forEach((entry) => add("Published ratings", entry.label, entry.total));
      if (average !== null) add("Published ratings", "Average", average.toFixed(2));
    }

    if (!data.locations) failBox(panel("categories"), "Location categories could not load", reasons.locations);
    else {
      const categories = tally(data.locations, "category");
      const shown = categories.slice(0, 8);
      renderBars(panel("categories"), shown, data.locations.length, "No locations added in this period", "Categories appear once locations are added.",
        categories.length > shown.length ? `Showing the top ${shown.length} of ${categories.length} categories.` : null);
      categories.forEach((entry) => add("Locations by category", entry.label, entry.total));
    }

    if (!data.ai) failBox(panel("ai"), "AI outcomes could not load", reasons.ai);
    else {
      const outcomes = tally(data.ai, "detection_status", AI_STATUSES).map((entry) => ({ ...entry, label: entry.label === "Needs Verification" ? "Needs verification" : entry.label === "Not Detected" ? "Not detected" : entry.label }));
      const reviewed = data.ai.filter((r) => r.verified).length;
      const confidence = data.ai.length ? data.ai.reduce((sum, r) => sum + Number(r.confidence_score), 0) / data.ai.length : null;
      renderBars(panel("ai"), outcomes, data.ai.length, "No photos analyzed in this period", "Outcomes appear once the AI analyzes uploaded photos.",
        confidence === null ? null : `Average confidence ${K.format.decimal.format(confidence)}%. ${K.format.number.format(reviewed)} of ${K.format.number.format(data.ai.length)} reviewed by an admin.`);
      outcomes.forEach((entry) => add("AI outcomes", entry.label, entry.total));
      if (confidence !== null) add("AI outcomes", "Average confidence (%)", confidence.toFixed(2));
    }

    downloadButton.disabled = settled.every((item) => item.status === "rejected");
    return settled;
  }

  function download() {
    K.downloadCsv(`navable-analytics-${periodSelect.value === "all" ? "all-time" : `${periodSelect.value}-days`}-${K.today()}.csv`, [["Section", "Item", "Value"], ...csvRows]);
  }

  downloadButton.addEventListener("click", download);
  periodSelect.addEventListener("change", () => view.load());

  const view = K.createPage({ name: "Analytics", run });
});
