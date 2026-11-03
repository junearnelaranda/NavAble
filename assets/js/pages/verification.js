// AI Verification: features detected by the AI in uploaded photos (table
// `ai_results`, joined to `images`). Admins confirm a detection (Detected),
// reject it (Not Detected), or reopen a reviewed result. Reviewed results
// have verified = true.
//
// "Waiting for review" matches the dashboard: detection_status is
// Needs Verification and verified is false.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, icon, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("resultsDownload");
  const form = document.getElementById("resultFilters");

  const PAGE_SIZE = 12;
  const PERSON = "email, user_profiles(first_name, last_name)";
  const LIST_COLUMNS = `result_id, detected_feature, confidence_score, detection_status, ai_model, analyzed_at, verified, images(image_url, image_name, upload_date, locations(location_name, address), users(${PERSON}))`;

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  const waiting = (query) => query.eq("detection_status", "Needs Verification").eq("verified", false);

  function applyFilters(query) {
    if (filters.queue === "waiting") query = waiting(query);
    else if (filters.queue === "unreviewed") query = query.eq("verified", false);
    else if (filters.queue === "reviewed") query = query.eq("verified", true);
    if (filters.confidence === "low") query = query.lt("confidence_score", 70);
    if (filters.confidence === "mid") query = query.gte("confidence_score", 70).lt("confidence_score", 90);
    if (filters.confidence === "high") query = query.gte("confidence_score", 90);
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("detected_feature", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("ai_results").select(columns, options))
    .order("analyzed_at", { ascending: false })
    .order("result_id");

  const filtersActive = () => Boolean(filters.search || filters.confidence || filters.queue !== "waiting");

  // ---------- stats ----------

  async function loadStats() {
    const settled = await Promise.allSettled([
      K.allRows(() => waiting(db.from("ai_results").select("confidence_score")).order("result_id")),
      K.count("ai_results", (q) => q.eq("verified", true)),
      K.count("ai_results"),
      K.count("ai_results", (q) => q.eq("verified", false))
    ]);
    const [waitingResult, reviewedResult, totalResult, unreviewedResult] = settled;
    const fmt = K.format.number;

    if (waitingResult.status === "rejected") {
      K.setStat("waiting", { error: true });
      K.setStat("confidence", { error: true });
    } else {
      const rows = waitingResult.value;
      const low = rows.filter((r) => Number(r.confidence_score) < 70).length;
      K.setStat("waiting", { value: fmt.format(rows.length), meta: rows.length ? `${fmt.format(low)} below 70% confidence` : "Nothing waiting" });
      if (!rows.length) K.setStat("confidence", { value: "Nothing waiting", textValue: true, meta: "Shows when results need review" });
      else K.setStat("confidence", { value: `${K.format.decimal.format(rows.reduce((sum, r) => sum + Number(r.confidence_score), 0) / rows.length)}%`, meta: `Across ${K.plural(rows.length, "waiting result")}` });
    }

    const reviewed = K.ok(reviewedResult);
    const total = K.ok(totalResult);
    const unreviewed = K.ok(unreviewedResult);
    if (reviewed === undefined) K.setStat("confirmed", { error: true });
    else K.setStat("confirmed", { value: fmt.format(reviewed), meta: total ? `${K.percent(reviewed, total)}% of all results` : "No results yet" });
    if (total === undefined) K.setStat("total", { error: true });
    else K.setStat("total", { value: fmt.format(total), meta: unreviewed === undefined ? "" : `${fmt.format(unreviewed)} not yet reviewed` });
    return settled;
  }

  // ---------- list ----------

  async function loadList() {
    const current = isLatest();
    K.loadingPanel(listPanel);
    try {
      const result = await K.pageOf(listQuery(LIST_COLUMNS, { count: "exact" }), page, PAGE_SIZE);
      if (!current()) return { status: "fulfilled" };
      if (result.outOfRange && page > 0) {
        page = 0;
        return loadList();
      }
      renderList(result);
      K.settleFocus(listPanel);
      downloadButton.disabled = !result.total;
      return { status: "fulfilled", value: result };
    } catch (error) {
      if (current()) {
        listPanel.replaceChildren(K.errorBox("AI results could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  const photoUrl = (image) => (/^https?:\/\//i.test(image?.image_url || "") ? image.image_url : null);

  function thumbnail(image, feature) {
    const url = photoUrl(image);
    if (!url) return el("div", { className: "nv-thumb", title: image?.image_url || "No photo" }, icon("image_not_supported"));
    const img = el("img", { src: url, alt: `Uploaded photo analyzed for ${feature}`, loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(icon("broken_image")), { once: true });
    return el("a", { className: "nv-thumb", href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open the full photo for ${feature} in a new tab` }, img);
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "result")}${filtersActive() ? " match these filters" : " waiting for review"}. Newest first.`
      : "No matching results.";

    if (!total) {
      const onlyQueue = !filters.search && !filters.confidence;
      listPanel.replaceChildren(onlyQueue && filters.queue === "waiting"
        ? K.stateBox("empty", "Nothing waiting for review", "Results the AI marks as Needs Verification will appear here.")
        : onlyQueue && !filters.queue
          ? K.stateBox("empty", "No AI results yet", "Results appear when the AI analyzes photos uploaded in the NavAble app.")
          : K.stateBox("empty", "No results match these filters", "Try a different view, confidence range, or feature name."));
      return;
    }

    const items = rows.map((result) => {
      const image = K.one(result.images);
      const location = K.one(image?.locations);
      const uploader = K.one(image?.users);
      const feature = result.detected_feature;
      const actions = result.verified
        ? [K.button("Reopen for review", { iconName: "undo", small: true, ariaLabel: `Reopen ${feature} result for review`, onClick: (event) => K.withBusy(event.currentTarget, () => review(result, { detection_status: "Needs Verification", verified: false }, `${feature} result reopened for review.`)) })]
        : [
          K.button("Feature is present", { iconName: "check", tone: "primary", small: true, ariaLabel: `Confirm ${feature} is present`, onClick: (event) => K.withBusy(event.currentTarget, () => review(result, { detection_status: "Detected", verified: true }, `${feature} confirmed as present.`)) }),
          K.button("Not present", { iconName: "close", small: true, ariaLabel: `Mark ${feature} as not present`, onClick: (event) => K.withBusy(event.currentTarget, () => review(result, { detection_status: "Not Detected", verified: true }, `${feature} marked as not present.`)) })
        ];
      return el("li", { className: "nv-item" },
        el("div", { className: "nv-item-media" },
          thumbnail(image, feature),
          el("div", { style: "display:grid;gap:8px;min-width:0" },
            el("div", { className: "nv-item-head" },
              el("div", { className: "nv-item-meta" },
                el("strong", { style: "color:var(--admin-text);font-size:0.95rem", text: feature }),
                el("span", { text: `${K.format.decimal.format(Number(result.confidence_score))}% confidence` })),
              el("div", { className: "nv-item-meta" },
                badge("aiStatus", result.detection_status),
                result.verified ? badge({ yes: ["success", "verified_user", "Reviewed"] }, "yes") : null)),
            el("div", { className: "nv-item-meta" },
              el("span", { className: "nv-cell-main", text: location?.location_name || "Unknown location" }),
              el("span", { text: `Uploaded by ${K.personName(uploader)}` }),
              el("span", {}, "Analyzed ", K.timeEl(result.analyzed_at)),
              el("span", { text: `Model ${result.ai_model}` })),
            el("div", { className: "nv-row-actions", style: "justify-content:flex-start" }, actions))));
    });

    listPanel.replaceChildren(
      el("ul", { className: "nv-list", "aria-label": "AI detections" }, items),
      K.pager({ page, size: PAGE_SIZE, total, noun: "results", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  async function review(result, values, success) {
    const saved = await K.mutate(() => db.from("ai_results")
      .update(values)
      .eq("result_id", result.result_id)
      .select("result_id"), { success, failure: "The AI result was not updated." });
    if (saved) await view.load();
  }

  // ---------- CSV ----------

  async function download() {
    downloadButton.disabled = true;
    try {
      const data = await K.allRows(() => listQuery(LIST_COLUMNS));
      K.downloadCsv(`navable-ai-results-${K.today()}.csv`, [
        ["Result ID", "Detected feature", "Confidence (%)", "Status", "Reviewed", "Model", "Analyzed", "Location", "Uploaded by", "Photo URL"],
        ...data.map((r) => {
          const image = K.one(r.images);
          return [r.result_id, r.detected_feature, r.confidence_score, r.detection_status, r.verified ? "Yes" : "No", r.ai_model, r.analyzed_at, K.one(image?.locations)?.location_name, K.personName(K.one(image?.users)), image?.image_url];
        })
      ]);
    } catch (error) {
      K.toast(`The CSV could not be created. ${K.friendlyError(error)}`, { assertive: true });
    } finally {
      downloadButton.disabled = false;
    }
  }

  // ---------- start ----------

  filters = K.bindFilters(form, {
    initial: { queue: K.param("queue"), confidence: K.param("confidence") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  downloadButton.addEventListener("click", download);

  const view = K.createPage({
    name: "AI results",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      return [...stats, list];
    }
  });
});
