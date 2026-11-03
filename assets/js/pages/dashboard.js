// NavAble admin dashboard: every number on this page comes from the Supabase
// database (see supabase-client.js). Nothing is sampled or generated.
//
// Metric definitions
//   Open reports            reports.status is Pending or Verified (not yet Resolved/Rejected)
//   Locations to verify     locations.verification_status = Pending
//   AI detections to confirm ai_results.detection_status = Needs Verification and verified = false
//   Reviews to moderate     reviews.review_status = Pending Review
//   New bug reports         bug_reports.status = New
//   Registered users        users.role = User (staff accounts excluded)
//   Verified locations      locations.verification_status = Verified, out of all locations
//   Average rating          mean of reviews.rating where review_status = Published
//   Resolved reports        reports.status = Resolved, out of all reports
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const db = window.NavAbleDB?.client;
  const main = document.getElementById("main-content");
  const updated = document.getElementById("dashUpdated");
  const refreshButton = document.getElementById("dashRefresh");
  const downloadButton = document.getElementById("dashDownload");
  const banner = document.getElementById("dashBanner");
  const bannerText = document.getElementById("dashBannerText");

  const OPEN_REPORT_STATUSES = ["Pending", "Verified"];
  const WEEKS = 8;
  const AUTO_REFRESH_AFTER_MS = 60_000;

  let loading = false;
  let lastLoadedAt = 0;
  let summaryRows = [];

  const number = new Intl.NumberFormat();
  const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  // ---------- small DOM helpers ----------

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    });
    children.flat().forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  const icon = (name) => el("span", { className: "material-symbols-outlined", "aria-hidden": "true", text: name });

  function stateBox(kind, title, message, action) {
    const box = el("div", { className: "nv-state", "data-kind": kind },
      el("strong", {}, icon(kind === "error" ? "error" : "inbox"), title),
      message ? el("span", { text: message }) : null);
    if (action) box.append(action);
    return box;
  }

  function retryButton() {
    const button = el("button", { className: "nv-btn", type: "button" }, icon("refresh"), "Try again");
    button.addEventListener("click", () => load({ announce: true }));
    return button;
  }

  const panel = (name) => main.querySelector(`[data-panel="${name}"]`);

  function relativeTime(value) {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const steps = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [unit, size] of steps) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return "just now";
  }

  // ---------- badges ----------

  const STATUS_BADGES = {
    Pending: ["warning", "schedule", "Pending"],
    Verified: ["info", "fact_check", "Verified"],
    Resolved: ["success", "check_circle", "Resolved"],
    Rejected: ["neutral", "block", "Rejected"]
  };
  const PRIORITY_BADGES = {
    High: ["danger", "priority_high", "High"],
    Medium: ["warning", "drag_handle", "Medium"],
    Low: ["neutral", "south", "Low"]
  };
  const REPORT_TYPE_ICONS = {
    "Broken Ramp": "accessible",
    "Broken Elevator": "elevator",
    "Blocked Entrance": "door_front",
    Construction: "construction",
    Others: "help"
  };

  function badge(map, value) {
    const [tone, iconName, label] = map[value] || ["neutral", "help", value || "Unknown"];
    return el("span", { className: "nv-badge", "data-tone": tone }, icon(iconName), label);
  }

  // ---------- queries ----------

  async function count(table, filter) {
    let query = db.from(table).select("*", { count: "exact", head: true });
    if (filter) query = filter(query);
    const { count: total, error } = await query;
    if (error) throw error;
    return total ?? 0;
  }

  async function rows(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // Supabase caps each response (1,000 rows by default), so totals built from
  // rows are fetched page by page to stay correct as the data grows.
  const PAGE_SIZE = 1000;
  async function allRows(makeQuery) {
    const out = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = await rows(makeQuery().range(from, from + PAGE_SIZE - 1));
      out.push(...page);
      if (page.length < PAGE_SIZE) return out;
    }
  }

  function weekStart(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  const QUERIES = {
    openReports: () => count("reports", (q) => q.in("status", OPEN_REPORT_STATUSES)),
    openHighPriority: () => count("reports", (q) => q.in("status", OPEN_REPORT_STATUSES).eq("priority_level", "High")),
    pendingLocations: () => count("locations", (q) => q.eq("verification_status", "Pending")),
    aiToReview: () => count("ai_results", (q) => q.eq("detection_status", "Needs Verification").eq("verified", false)),
    reviewsToModerate: () => count("reviews", (q) => q.eq("review_status", "Pending Review")),
    newBugs: () => count("bug_reports", (q) => q.eq("status", "New")),
    newHighBugs: () => count("bug_reports", (q) => q.eq("status", "New").eq("priority", "High")),
    users: () => count("users", (q) => q.eq("role", "User")),
    activeUsers: () => count("users", (q) => q.eq("role", "User").eq("account_status", "Active")),
    locations: () => count("locations"),
    verifiedLocations: () => count("locations", (q) => q.eq("verification_status", "Verified")),
    publishedRatings: () => allRows(() => db.from("reviews").select("rating").eq("review_status", "Published").order("review_id")),
    reports: () => count("reports"),
    resolvedReports: () => count("reports", (q) => q.eq("status", "Resolved")),
    recentReports: () => rows(db.from("reports")
      .select("report_id, report_type, status, priority_level, created_at, locations(location_name, address)")
      .order("created_at", { ascending: false })
      .limit(6)),
    weeklyReports: () => {
      const from = weekStart(new Date());
      from.setDate(from.getDate() - (WEEKS - 1) * 7);
      return allRows(() => db.from("reports").select("created_at").gte("created_at", from.toISOString()).order("report_id"));
    },
    features: () => allRows(() => db.from("accessibility_features").select("feature_id, feature_name").eq("status", "Active").order("feature_id")),
    locationFeatures: () => allRows(() => db.from("location_features").select("feature_id, location_id").eq("availability", true).order("location_feature_id"))
  };

  // ---------- stat tiles ----------

  function setStat(metric, { value, meta, textValue = false, error = false }) {
    const card = main.querySelector(`[data-metric="${metric}"]`);
    if (!card) return;
    const valueNode = card.querySelector("[data-value]");
    const metaNode = card.querySelector("[data-meta]");
    valueNode.classList.toggle("is-text", textValue || error);
    valueNode.replaceChildren(error ? "Unavailable" : value);
    metaNode.replaceChildren(...(error ? [icon("error"), " Could not load"] : [meta]));
    metaNode.style.color = error ? "var(--admin-danger)" : "";
  }

  // Returns the settled result, or undefined when the query failed.
  const ok = (result) => (result?.status === "fulfilled" ? result.value : undefined);

  function renderStats(r) {
    const summary = [];
    const add = (label, value, definition) => summary.push([label, value, definition]);

    // Needs your review
    const open = ok(r.openReports);
    const high = ok(r.openHighPriority);
    if (open === undefined) setStat("openReports", { error: true });
    else setStat("openReports", {
      value: number.format(open),
      meta: high === undefined ? "Priority breakdown unavailable" : high ? `${number.format(high)} high priority` : "None high priority"
    });
    add("Open reports", open, "Reports with status Pending or Verified");

    const pending = ok(r.pendingLocations);
    const totalLocations = ok(r.locations);
    if (pending === undefined) setStat("pendingLocations", { error: true });
    else setStat("pendingLocations", {
      value: number.format(pending),
      meta: totalLocations === undefined ? "Awaiting verification" : totalLocations ? `of ${number.format(totalLocations)} total locations` : "No locations added yet"
    });
    add("Locations to verify", pending, "Locations with verification status Pending");

    const ai = ok(r.aiToReview);
    if (ai === undefined) setStat("aiToReview", { error: true });
    else setStat("aiToReview", { value: number.format(ai), meta: "Flagged Needs Verification" });
    add("AI detections to confirm", ai, "AI results marked Needs Verification and not yet verified");

    const moderate = ok(r.reviewsToModerate);
    if (moderate === undefined) setStat("reviewsToModerate", { error: true });
    else setStat("reviewsToModerate", { value: number.format(moderate), meta: "Held as Pending Review" });

    const bugs = ok(r.newBugs);
    const highBugs = ok(r.newHighBugs);
    if (bugs === undefined) setStat("newBugs", { error: true });
    else setStat("newBugs", { value: number.format(bugs), meta: highBugs ? `${number.format(highBugs)} high priority` : "Not looked at yet" });
    add("New bug reports", bugs, "Bug reports with status New");
    add("Reviews to moderate", moderate, "Reviews with status Pending Review");

    // Platform overview
    const users = ok(r.users);
    const active = ok(r.activeUsers);
    if (users === undefined) setStat("users", { error: true });
    else setStat("users", {
      value: number.format(users),
      meta: active === undefined ? "Active count unavailable" : `${number.format(active)} active accounts`
    });
    add("Registered users", users, "Accounts with role User (staff excluded)");

    const verified = ok(r.verifiedLocations);
    if (verified === undefined || totalLocations === undefined) setStat("verifiedLocations", { error: true });
    else if (totalLocations === 0) setStat("verifiedLocations", { value: "0", meta: "No locations added yet" });
    else setStat("verifiedLocations", {
      value: number.format(verified),
      meta: `${Math.round((verified / totalLocations) * 100)}% of ${number.format(totalLocations)} locations`
    });
    add("Verified locations", verified, "Locations with verification status Verified");
    add("Total locations", totalLocations, "All location records");

    const ratings = ok(r.publishedRatings);
    let average;
    if (ratings === undefined) setStat("averageRating", { error: true });
    else if (!ratings.length) setStat("averageRating", { value: "No ratings yet", textValue: true, meta: "Shows once reviews are published" });
    else {
      average = ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length;
      setStat("averageRating", {
        value: `${average.toFixed(1)} / 5`,
        meta: `From ${number.format(ratings.length)} published review${ratings.length === 1 ? "" : "s"}`
      });
    }
    add("Average rating", average === undefined ? (ratings ? "No ratings yet" : undefined) : average.toFixed(2), "Mean rating of Published reviews");

    const resolved = ok(r.resolvedReports);
    const totalReports = ok(r.reports);
    if (resolved === undefined || totalReports === undefined) setStat("resolvedReports", { error: true });
    else setStat("resolvedReports", {
      value: number.format(resolved),
      meta: totalReports ? `of ${number.format(totalReports)} reports submitted` : "No reports submitted yet"
    });
    add("Resolved reports", resolved, "Reports with status Resolved");
    add("Total reports", totalReports, "All report records");

    return summary;
  }

  // ---------- panels ----------

  function renderRecentReports(result) {
    const target = panel("recentReports");
    if (result.status === "rejected") {
      target.replaceChildren(stateBox("error", "Latest reports could not load", result.reason?.message, retryButton()));
      return;
    }
    const data = result.value;
    if (!data.length) {
      target.replaceChildren(stateBox("empty", "No reports yet", "Reports submitted from the NavAble app will appear here."));
      return;
    }

    const body = el("tbody", {}, data.map((report) => el("tr", {},
      el("td", {},
        el("div", { className: "nv-cell-main", text: report.locations?.location_name || "Unknown location" }),
        report.locations?.address ? el("div", { className: "nv-cell-sub nv-hide-sm", text: report.locations.address }) : null,
        el("div", { className: "nv-cell-sub nv-show-sm", text: report.report_type })),
      el("td", { className: "nv-hide-sm" }, el("span", { className: "nv-badge", "data-tone": "neutral" }, icon(REPORT_TYPE_ICONS[report.report_type] || "help"), report.report_type)),
      el("td", { className: "nv-hide-sm" }, badge(PRIORITY_BADGES, report.priority_level)),
      el("td", {}, badge(STATUS_BADGES, report.status)),
      el("td", { className: "nv-hide-sm nv-cell-sub" },
        el("time", { datetime: report.created_at, title: fullDate.format(new Date(report.created_at)), text: relativeTime(report.created_at) }))
    )));

    const table = el("table", { className: "nv-table" },
      el("caption", { className: "sr-only", text: "Six most recent accessibility reports" }),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col", text: "Location" }),
        el("th", { scope: "col", className: "nv-hide-sm", text: "Issue" }),
        el("th", { scope: "col", className: "nv-hide-sm", text: "Priority" }),
        el("th", { scope: "col", text: "Status" }),
        el("th", { scope: "col", className: "nv-hide-sm", text: "Submitted" }))),
      body);
    target.replaceChildren(el("div", { className: "nv-table-scroll" }, table));
  }

  function renderWeeklyReports(result) {
    const target = panel("weeklyReports");
    if (result.status === "rejected") {
      target.replaceChildren(stateBox("error", "Weekly totals could not load", result.reason?.message, retryButton()));
      return;
    }

    const first = weekStart(new Date());
    first.setDate(first.getDate() - (WEEKS - 1) * 7);
    const weeks = Array.from({ length: WEEKS }, (_, index) => {
      const start = new Date(first);
      start.setDate(first.getDate() + index * 7);
      return { start, total: 0 };
    });
    result.value.forEach(({ created_at: createdAt }) => {
      const index = Math.floor((weekStart(new Date(createdAt)) - first) / (7 * 86400000));
      if (weeks[index]) weeks[index].total += 1;
    });

    const total = weeks.reduce((sum, week) => sum + week.total, 0);
    if (!total) {
      target.replaceChildren(stateBox("empty", "No reports in the last 8 weeks", "Weekly totals appear once reports are submitted."));
      return;
    }

    const max = Math.max(...weeks.map((week) => week.total));
    const list = el("ol", { className: "nv-columns", "aria-label": `Reports per week, ${number.format(total)} in total` },
      weeks.map((week) => el("li", { className: "nv-column" },
        el("span", { className: "nv-column-value", "aria-hidden": "true", text: number.format(week.total) }),
        el("span", { className: "nv-column-track", "aria-hidden": "true" },
          el("span", { className: "nv-column-fill", style: `height:${week.total ? Math.max(4, (week.total / max) * 100) : 0}%` })),
        el("span", { className: "nv-column-label", "aria-hidden": "true", text: shortDate.format(week.start) }),
        el("span", { className: "sr-only", text: `Week of ${shortDate.format(week.start)}: ${number.format(week.total)} report${week.total === 1 ? "" : "s"}` }))));
    target.replaceChildren(list);
  }

  function renderFeatures(featuresResult, linksResult, locationsResult) {
    const target = panel("features");
    const failed = [featuresResult, linksResult, locationsResult].find((item) => item.status === "rejected");
    if (failed) {
      target.replaceChildren(stateBox("error", "Feature totals could not load", failed.reason?.message, retryButton()));
      return;
    }

    const features = featuresResult.value;
    if (!features.length) {
      const link = el("a", { className: "nv-link", href: "accss-data.html" }, "Manage accessibility features", icon("arrow_forward"));
      target.replaceChildren(stateBox("empty", "No accessibility features defined", "Add features such as ramps or elevators to start tracking them.", link));
      return;
    }

    const locationsByFeature = new Map();
    linksResult.value.forEach(({ feature_id: featureId, location_id: locationId }) => {
      if (!locationsByFeature.has(featureId)) locationsByFeature.set(featureId, new Set());
      locationsByFeature.get(featureId).add(locationId);
    });
    const totalLocations = locationsResult.value;
    const ranked = features
      .map((feature) => ({ name: feature.feature_name, total: locationsByFeature.get(feature.feature_id)?.size || 0 }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    if (!ranked.some((feature) => feature.total)) {
      target.replaceChildren(stateBox("empty", "No features recorded at locations yet", `${number.format(features.length)} active feature${features.length === 1 ? " is" : "s are"} defined, but no location lists them as available.`));
      return;
    }

    const shown = ranked.slice(0, 8);
    const list = el("ul", { className: "nv-bars" }, shown.map((feature) => {
      const share = totalLocations ? Math.round((feature.total / totalLocations) * 100) : 0;
      return el("li", { className: "nv-bar-row" },
        el("span", { text: feature.name }),
        el("strong", { text: `${number.format(feature.total)} (${share}%)` }),
        el("span", { className: "nv-bar-track", role: "img", "aria-label": `${feature.name}: available at ${number.format(feature.total)} of ${number.format(totalLocations)} locations` },
          el("span", { className: "nv-bar-fill", style: `width:${share}%` })));
    }));
    const note = ranked.length > shown.length
      ? el("p", { className: "nv-cell-sub", style: "margin-top:12px", text: `Showing the top ${shown.length} of ${ranked.length} active features.` })
      : null;
    target.replaceChildren(list, ...(note ? [note] : []));
  }

  // ---------- load cycle ----------

  function setLoading(isLoading) {
    loading = isLoading;
    main.setAttribute("aria-busy", String(isLoading));
    refreshButton.disabled = isLoading;
    refreshButton.querySelector("span:last-child").textContent = !isLoading ? "Refresh" : lastLoadedAt ? "Refreshing…" : "Loading…";
  }

  async function load({ announce = false } = {}) {
    if (loading || !db) return;
    setLoading(true);
    if (lastLoadedAt) updated.textContent = "Refreshing…";

    const names = Object.keys(QUERIES);
    const settled = await Promise.allSettled(names.map((name) => QUERIES[name]()));
    const results = Object.fromEntries(names.map((name, index) => [name, settled[index]]));

    summaryRows = renderStats(results);
    renderRecentReports(results.recentReports);
    renderWeeklyReports(results.weeklyReports);
    renderFeatures(results.features, results.locationFeatures, results.locations);

    const failures = settled.filter((item) => item.status === "rejected");
    if (failures.length) {
      const reason = failures[0].reason?.message || "Unknown error";
      bannerText.textContent = failures.length === settled.length
        ? `Dashboard data could not be loaded from the database. ${reason}`
        : `Some dashboard data could not be loaded (${failures.length} of ${settled.length} queries failed). ${reason}`;
      banner.hidden = false;
      failures.forEach((item) => console.error("NavAble dashboard query failed.", item.reason));
    } else {
      banner.hidden = true;
    }

    lastLoadedAt = Date.now();
    updated.textContent = failures.length === settled.length ? "Not loaded" : `Updated ${clock.format(new Date(lastLoadedAt))}`;
    downloadButton.disabled = failures.length === settled.length;
    setLoading(false);

    if (announce) {
      NavAbleAdmin.showToast(failures.length ? "Dashboard refreshed with some data missing." : "Dashboard refreshed.", { assertive: Boolean(failures.length) });
    }
  }

  function downloadSummary() {
    const rowsOut = [["Metric", "Value", "Definition"], ...summaryRows.map(([label, value, definition]) => [label, value ?? "Unavailable", definition])];
    rowsOut.push(["Generated", new Date(lastLoadedAt).toISOString(), "Time the data was loaded"]);
    NavAbleAdmin.downloadCsv(`navable-dashboard-${new Date(lastLoadedAt).toISOString().slice(0, 10)}.csv`, rowsOut);
  }

  refreshButton.addEventListener("click", () => load({ announce: true }));
  downloadButton.addEventListener("click", downloadSummary);
  banner.querySelector("[data-retry]").addEventListener("click", () => load({ announce: true }));

  // Pick up changes made on other pages or by other admins when returning to this tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && lastLoadedAt && Date.now() - lastLoadedAt > AUTO_REFRESH_AFTER_MS) load();
  });

  if (!db) {
    bannerText.textContent = "The database connection is unavailable, so no dashboard data can be shown.";
    banner.hidden = false;
    updated.textContent = "Not loaded";
    return;
  }

  // Wait for admin-guard.js to confirm access before querying.
  if (window.NavAbleStaff) load();
  else document.addEventListener("navable:admin-ready", () => load(), { once: true });
});
