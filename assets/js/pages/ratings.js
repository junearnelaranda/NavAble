// Ratings & Reviews: user reviews of locations (table `reviews`). Admins
// moderate them by setting review_status to Published, Pending Review, or Hidden.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const breakdownPanel = main.querySelector('[data-panel="breakdown"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("reviewsDownload");
  const form = document.getElementById("reviewFilters");

  const PAGE_SIZE = 15;
  const PERSON = "email, user_profiles(first_name, last_name)";
  const LIST_COLUMNS = `review_id, rating, comment, accessibility_score, review_date, review_status, locations(location_name), users(${PERSON}), contribution_points(point_id, points, tier)`;

  // What each moderation button does, by the review's current status.
  const ACTIONS = {
    "Pending Review": [["Publish", "Published", "public", "primary"], ["Hide", "Hidden", "visibility_off"]],
    Published: [["Hold for review", "Pending Review", "rate_review"], ["Hide", "Hidden", "visibility_off"]],
    Hidden: [["Publish", "Published", "public"], ["Hold for review", "Pending Review", "rate_review"]]
  };
  const DONE = { Published: "published", "Pending Review": "held for review", Hidden: "hidden" };

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.status) query = query.eq("review_status", filters.status);
    if (filters.rating) query = query.eq("rating", Number(filters.rating));
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("comment", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("reviews").select(columns, options))
    .order("review_date", { ascending: false })
    .order("review_id");

  const filtersActive = () => Boolean(filters.search || filters.status || filters.rating);

  // ---------- stats and breakdown ----------

  async function loadStats() {
    const settled = await Promise.allSettled([
      K.allRows(() => db.from("reviews").select("rating").eq("review_status", "Published").order("review_id")),
      K.count("reviews", (q) => q.eq("review_status", "Pending Review")),
      K.count("reviews", (q) => q.eq("review_status", "Hidden")),
      K.count("reviews")
    ]);
    const [ratingsResult, pendingResult, hiddenResult, totalResult] = settled;
    const fmt = K.format.number;
    const total = K.ok(totalResult);

    if (ratingsResult.status === "rejected") {
      K.setStat("average", { error: true });
      K.setStat("published", { error: true });
      breakdownPanel.replaceChildren(K.errorBox("The rating breakdown could not load", ratingsResult.reason, () => view.load({ announce: true })));
    } else {
      const ratings = ratingsResult.value;
      if (!ratings.length) {
        K.setStat("average", { value: "No ratings yet", textValue: true, meta: "Shows once reviews are published" });
      } else {
        const average = ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length;
        K.setStat("average", { value: `${K.format.decimal.format(average)} / 5`, meta: `From ${K.plural(ratings.length, "published review")}` });
      }
      K.setStat("published", { value: fmt.format(ratings.length), meta: total ? `${K.percent(ratings.length, total)}% of ${fmt.format(total)} reviews` : "No reviews yet" });
      renderBreakdown(ratings);
    }

    const pending = K.ok(pendingResult);
    if (pending === undefined) K.setStat("pending", { error: true });
    else K.setStat("pending", { value: fmt.format(pending), meta: pending ? "Not shown in the app until published" : "Nothing waiting" });

    const hidden = K.ok(hiddenResult);
    if (hidden === undefined) K.setStat("hidden", { error: true });
    else K.setStat("hidden", { value: fmt.format(hidden), meta: "Not shown in the app" });
    return settled;
  }

  function renderBreakdown(ratings) {
    if (!ratings.length) {
      breakdownPanel.replaceChildren(K.stateBox("empty", "No published ratings", "The breakdown appears once reviews are published."));
      return;
    }
    const counts = [5, 4, 3, 2, 1].map((stars) => ({ stars, total: ratings.filter((row) => row.rating === stars).length }));
    breakdownPanel.replaceChildren(el("ul", { className: "nv-bars" }, counts.map(({ stars, total }) => {
      const share = K.percent(total, ratings.length);
      return el("li", { className: "nv-bar-row" },
        el("span", { text: `${stars} star${stars === 1 ? "" : "s"}` }),
        el("strong", { text: `${K.format.number.format(total)} (${share}%)` }),
        el("span", { className: "nv-bar-track", role: "img", "aria-label": `${stars} stars: ${K.plural(total, "review")}, ${share}% of published reviews` },
          el("span", { className: "nv-bar-fill", style: `width:${share}%` })));
    })));
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
        listPanel.replaceChildren(K.errorBox("Reviews could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "review")}${filtersActive() ? " match these filters" : ""}. Newest first.`
      : "No matching reviews.";

    if (!total) {
      const message = filters.status === "Pending Review" && !filters.search && !filters.rating
        ? K.stateBox("empty", "No reviews waiting for moderation", "New reviews held for moderation will appear here.")
        : filtersActive()
          ? K.stateBox("empty", "No reviews match these filters", "Try a different status, rating, or search term.")
          : K.stateBox("empty", "No reviews yet", "Reviews written in the NavAble app will appear here.");
      listPanel.replaceChildren(message);
      return;
    }

    const items = rows.map((review) => {
      const location = K.one(review.locations)?.location_name || "Unknown location";
      const author = K.personName(K.one(review.users));
      const actions = (ACTIONS[review.review_status] || []).map(([label, next, iconName, tone]) =>
        K.button(label, {
          iconName, tone, small: true, ariaLabel: `${label}: ${author}'s review of ${location}`,
          onClick: (event) => K.withBusy(event.currentTarget, () => setStatus(review, next, location))
        }));
      return el("li", { className: "nv-item" },
        el("div", { className: "nv-item-head" },
          el("div", { className: "nv-item-meta" },
            K.stars(review.rating),
            el("strong", { style: "color:var(--admin-text)", text: `${review.rating} / 5` }),
            el("span", { text: `Accessibility ${K.format.decimal.format(Number(review.accessibility_score) || 0)} / 5` })),
          badge("reviewStatus", review.review_status)),
        el("div", { className: "nv-item-meta" },
          el("span", { className: "nv-cell-main", text: location }),
          el("span", { text: author }),
          K.timeEl(review.review_date)),
        review.comment
          ? el("p", { className: "nv-quote", text: review.comment })
          : el("p", { className: "nv-cell-sub", text: "Rating only, no comment." }),
        el("div", { className: "nv-row-actions", style: "justify-content:flex-start" }, actions),
        K.pointsControl({
          source: "Review",
          sourceId: review.review_id,
          award: K.one(review.contribution_points),
          eligible: review.review_status === "Published",
          ineligibleHint: "Publish the review to award points.",
          label: `${author}'s review of ${location}`,
          onChange: () => view.load()
        }));
    });

    listPanel.replaceChildren(
      el("ul", { className: "nv-list", "aria-label": "Reviews" }, items),
      K.pager({ page, size: PAGE_SIZE, total, noun: "reviews", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  async function setStatus(review, next, location) {
    const saved = await K.mutate(() => db.from("reviews")
      .update({ review_status: next })
      .eq("review_id", review.review_id)
      .select("review_id"), {
      success: `Review of ${location} ${DONE[next]}.`,
      failure: "The review was not updated."
    });
    if (saved) await view.load();
  }

  // ---------- CSV ----------

  async function download() {
    downloadButton.disabled = true;
    try {
      const data = await K.allRows(() => listQuery(`review_id, rating, accessibility_score, review_status, comment, review_date, locations(location_name), users(${PERSON})`));
      K.downloadCsv(`navable-reviews-${K.today()}.csv`, [
        ["Review ID", "Location", "Reviewer", "Email", "Rating", "Accessibility score", "Status", "Comment", "Date"],
        ...data.map((r) => {
          const user = K.one(r.users);
          return [r.review_id, K.one(r.locations)?.location_name, K.personName(user), user?.email, r.rating, r.accessibility_score, r.review_status, r.comment, r.review_date];
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
    initial: { status: K.param("status"), rating: K.param("rating") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  downloadButton.addEventListener("click", download);

  const view = K.createPage({
    name: "Reviews",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      return [...stats, list];
    }
  });
});
