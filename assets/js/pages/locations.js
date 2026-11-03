// Locations: places listed in NavAble (table `locations`). Admins verify or
// reject submitted locations, correct their details, and add new ones.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("locationsDownload");
  const addButton = document.getElementById("locationAdd");
  const form = document.getElementById("locationFilters");
  const categorySelect = document.getElementById("filterCategory");

  const PAGE_SIZE = 20;
  const STATUSES = ["Pending", "Verified", "Rejected"];
  const LIST_COLUMNS = "location_id, location_name, category, address, accessibility_score, verification_status, created_at";

  let filters = {};
  let page = 0;
  let categories = [];
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.status) query = query.eq("verification_status", filters.status);
    if (filters.category) query = query.eq("category", filters.category);
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.or(`location_name.ilike.${pattern},address.ilike.${pattern}`);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("locations").select(columns, options))
    .order("location_name")
    .order("location_id");

  const filtersActive = () => Boolean(filters.search || filters.status || filters.category);

  // ---------- stats ----------

  async function loadStats() {
    const settled = await Promise.allSettled([
      K.count("locations"),
      ...STATUSES.map((status) => K.count("locations", (q) => q.eq("verification_status", status))),
      K.count("locations", (q) => q.gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()))
    ]);
    const [total, pending, verified, rejected, newThisWeek] = settled.map(K.ok);
    const fmt = K.format.number;
    const share = (n) => (total ? `${K.percent(n, total)}% of all locations` : "No locations yet");

    if (total === undefined) K.setStat("total", { error: true });
    else K.setStat("total", { value: fmt.format(total), meta: newThisWeek === undefined ? "" : `${fmt.format(newThisWeek)} added in the last 7 days` });
    [["pending", pending], ["verified", verified], ["rejected", rejected]].forEach(([metric, value]) => {
      if (value === undefined) K.setStat(metric, { error: true });
      else K.setStat(metric, { value: fmt.format(value), meta: total === undefined ? "" : share(value) });
    });
    return settled;
  }

  // Category is free text, so the filter lists the values in use.
  async function loadCategories() {
    const data = await K.allRows(() => db.from("locations").select("category").order("location_id"));
    categories = [...new Set(data.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    // A category that is no longer in use falls back to all categories.
    if (filters.category && !categories.includes(filters.category)) filters.category = "";
    categorySelect.replaceChildren(el("option", { value: "" }, "All categories"),
      ...categories.map((category) => el("option", { value: category, selected: category === filters.category }, category)));
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
        listPanel.replaceChildren(K.errorBox("Locations could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "location")}${filtersActive() ? " match these filters" : ""}. Sorted by name.`
      : "No matching locations.";

    if (!total) {
      listPanel.replaceChildren(filtersActive()
        ? K.stateBox("empty", "No locations match these filters", "Try a different status, category, or search term.")
        : K.stateBox("empty", "No locations yet", "Locations added in the NavAble app or with Add location will appear here."));
      return;
    }

    const body = rows.map((location) => el("tr", {},
      el("td", {},
        el("div", { className: "nv-cell-main", text: location.location_name }),
        el("div", { className: "nv-cell-sub", text: location.address }),
        el("div", { className: "nv-cell-sub nv-show-sm", text: location.category })),
      el("td", { className: "nv-hide-sm", text: location.category }),
      el("td", { className: "nv-hide-sm" }, scoreText(location.accessibility_score)),
      el("td", {}, badge("locationStatus", location.verification_status)),
      el("td", { className: "nv-hide-sm nv-cell-sub" }, K.timeEl(location.created_at)),
      el("td", { className: "is-actions" },
        K.button("Review", {
          iconName: "open_in_new", small: true, ariaLabel: `Review ${location.location_name}`,
          onClick: (event) => { const trigger = event.currentTarget; K.withBusy(trigger, () => openLocation(location.location_id, trigger)); }
        }))));

    listPanel.replaceChildren(
      K.tableEl("Locations", [["Location"], ["Category", "nv-hide-sm"], ["Accessibility score", "nv-hide-sm"], ["Status"], ["Added", "nv-hide-sm"], ["Actions", "is-actions"]], body),
      K.pager({ page, size: PAGE_SIZE, total, noun: "locations", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  const scoreText = (score) => el("span", {}, el("strong", { text: K.format.decimal.format(Number(score) || 0) }), el("span", { className: "nv-cell-sub", text: " / 5" }));

  // ---------- form ----------

  // Cebu City: where Google results are centred when searching.
  const SEARCH_CENTER = { latitude: 10.3157, longitude: 123.8854 };

  // "Find on Google": pick the Google place this location is, so the app's
  // search results show this location's features and rating. Fills in name,
  // address, coordinates and category; only the Google place id is linked.
  function googleFinder(location) {
    const idInput = el("input", { type: "hidden", name: "google_place_id", value: location.google_place_id || "" });
    const status = el("p", { className: "nv-hint", "aria-live": "polite" });
    const query = el("input", { className: "nv-input", type: "search", placeholder: "Search Google, e.g. SM City Cebu", "aria-label": "Search Google places", autocomplete: "off" });
    const results = el("ul", { className: "nv-list" });

    const showStatus = () => {
      status.replaceChildren(idInput.value
        ? el("span", {}, "Linked to a Google place. ",
          el("button", { type: "button", className: "nv-link", onClick: () => { idInput.value = ""; showStatus(); }, text: "Unlink" }))
        : "Not linked. App search results won't show this location's accessibility.");
    };

    const pick = (place) => {
      const form = idInput.closest("form");
      const set = (name, value) => { if (form?.elements[name] && value !== null && value !== undefined && value !== "") form.elements[name].value = value; };
      set("location_name", place.name);
      set("address", place.address);
      set("latitude", place.latitude);
      set("longitude", place.longitude);
      if (form && !form.elements.category.value) set("category", place.type);
      idInput.value = place.id;
      results.replaceChildren();
      showStatus();
      K.toast(`Linked to ${place.name} on Google. Check the details, then save.`);
    };

    const search = async () => {
      const text = query.value.trim();
      if (!text) return;
      results.replaceChildren(el("li", { className: "nv-cell-sub", text: "Searching Google…" }));
      const { data, error } = await db.functions.invoke("places-search", { body: { query: text, ...SEARCH_CENTER } });
      if (error) {
        const notSetUp = error.context?.status === 503;
        results.replaceChildren(el("li", { className: "nv-cell-sub", text: notSetUp
          ? "Google search isn't set up yet: add GOOGLE_PLACES_API_KEY in Supabase Edge Function secrets."
          : `Google search failed. ${K.friendlyError(error)}` }));
        return;
      }
      const places = Array.isArray(data?.places) ? data.places : [];
      results.replaceChildren(...(places.length
        ? places.slice(0, 8).map((place) => el("li", { className: "nv-item" },
          el("div", { className: "nv-item-head" },
            el("div", {},
              el("div", { className: "nv-cell-main", text: place.name }),
              el("div", { className: "nv-cell-sub", text: place.address })),
            K.button("Use", { small: true, iconName: "link", ariaLabel: `Use ${place.name}`, onClick: () => pick(place) }))))
        : [el("li", { className: "nv-cell-sub", text: "No Google places found. Try another name." })]));
    };

    query.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault(); // Enter searches instead of saving the form.
        search();
      }
    });
    showStatus();
    return el("div", { className: "is-full nv-field" },
      el("label", { text: "Google place" }),
      el("div", { style: "display:flex;gap:8px" }, query, K.button("Find on Google", { iconName: "travel_explore", onClick: search })),
      status, idInput, results);
  }

  function locationFields(location = {}) {
    const listId = "locationCategoryOptions";
    const fields = el("div", { className: "nv-form-grid" },
      googleFinder(location),
      el("div", { className: "is-full" }, K.field({ label: "Name", name: "location_name", required: true, maxLength: 150, value: location.location_name })),
      K.field({ label: "Category", name: "category", required: true, value: location.category, hint: "For example Hospital, Mall, or Transit Station." }),
      K.field({ label: "Verification status", name: "verification_status", type: "select", value: location.verification_status || "Pending", options: STATUSES.map((s) => [s, s]) }),
      el("div", { className: "is-full" }, K.field({ label: "Address", name: "address", required: true, maxLength: 255, value: location.address })),
      K.field({ label: "Latitude", name: "latitude", type: "number", required: true, min: -90, max: 90, step: "any", value: location.latitude, inputMode: "decimal" }),
      K.field({ label: "Longitude", name: "longitude", type: "number", required: true, min: -180, max: 180, step: "any", value: location.longitude, inputMode: "decimal" }),
      K.field({ label: "Accessibility rating (0-5)", name: "accessibility_score", type: "number", min: 0, max: 5, step: "0.1", value: location.accessibility_score ?? 0, inputMode: "decimal", hint: "The green rating in the app. 0 means not rated yet." }),
      el("div", { className: "is-full" }, K.field({ label: "Description", name: "description", type: "textarea", rows: 3, maxLength: 500, value: location.description })));
    const categoryInput = fields.querySelector('[name="category"]');
    categoryInput.setAttribute("list", listId);
    categoryInput.setAttribute("autocomplete", "off");
    fields.append(el("datalist", { id: listId }, categories.map((category) => el("option", { value: category }))));
    return fields;
  }

  function readLocation(dialogForm, location = {}) {
    const googlePlaceId = dialogForm.elements.google_place_id.value || null;
    return {
      location_name: K.formText(dialogForm, "location_name"),
      category: K.formText(dialogForm, "category"),
      address: K.formText(dialogForm, "address"),
      latitude: Number(dialogForm.elements.latitude.value),
      longitude: Number(dialogForm.elements.longitude.value),
      description: K.formText(dialogForm, "description"),
      verification_status: dialogForm.elements.verification_status.value,
      accessibility_score: Number(dialogForm.elements.accessibility_score.value) || 0,
      // Sent when linked, or when the row has the column (so Unlink saves).
      // Before the google_place_id migration, unlinked saves still work.
      ...(googlePlaceId || "google_place_id" in location ? { google_place_id: googlePlaceId } : {})
    };
  }

  function addLocation() {
    K.openDialog({
      title: "Add location",
      description: "New locations appear in the NavAble app once their status is Verified.",
      content: locationFields(),
      submitLabel: "Add location",
      submitIcon: "add_location_alt",
      returnFocus: addButton,
      onSubmit: async (dialogForm, { showError }) => {
        const values = readLocation(dialogForm);
        const saved = await K.mutate(() => db.from("locations").insert(values).select("location_id"), {
          success: `${values.location_name} added.`,
          failure: "The location was not added.",
          onError: showError
        });
        if (!saved) return false;
        view.load();
        return true;
      }
    });
  }

  // ---------- review dialog ----------

  async function openLocation(locationId, trigger) {
    const [locationResult, reportsResult, openReportsResult, ratingsResult] = await Promise.allSettled([
      db.from("locations").select("*").eq("location_id", locationId).maybeSingle()
        .then(({ data, error }) => { if (error) throw error; return data; }),
      K.count("reports", (q) => q.eq("location_id", locationId)),
      K.count("reports", (q) => q.eq("location_id", locationId).in("status", ["Pending", "Verified"])),
      K.allRows(() => db.from("reviews").select("rating").eq("location_id", locationId).eq("review_status", "Published").order("review_id"))
    ]);

    if (locationResult.status === "rejected" || !locationResult.value) {
      K.toast(locationResult.status === "rejected"
        ? `The location could not be opened. ${K.friendlyError(locationResult.reason)}`
        : "This location no longer exists. The list has been refreshed.", { assertive: true });
      view.load();
      return;
    }

    const location = locationResult.value;
    const fmt = K.format.number;
    const mapUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(location.latitude)}&mlon=${encodeURIComponent(location.longitude)}#map=18/${encodeURIComponent(location.latitude)}/${encodeURIComponent(location.longitude)}`;

    const reportsText = reportsResult.status === "rejected" || openReportsResult.status === "rejected"
      ? "Could not load"
      : reportsResult.value
        ? el("a", { className: "nv-link", href: `reports.html?status=&search=${encodeURIComponent(location.location_name)}` }, `${fmt.format(reportsResult.value)} total, ${fmt.format(openReportsResult.value)} open`)
        : "None";

    let ratingText = "Could not load";
    if (ratingsResult.status === "fulfilled") {
      const ratings = ratingsResult.value;
      ratingText = ratings.length
        ? `${K.format.decimal.format(ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length)} / 5 from ${K.plural(ratings.length, "published review")}`
        : "No published reviews";
    }

    K.openDialog({
      title: location.location_name,
      description: `${location.category} · added ${K.format.mediumDate.format(new Date(location.created_at))}`,
      wide: true,
      returnFocus: trigger,
      content: [
        K.details([
          ["Status", badge("locationStatus", location.verification_status)],
          ["Accessibility score", el("span", {}, scoreText(location.accessibility_score), el("span", { className: "nv-cell-sub", text: " (stored on the location record)" }))],
          ["Average rating", ratingText],
          ["Reports", reportsText],
          ["Map", el("a", { className: "nv-link", href: mapUrl, target: "_blank", rel: "noopener noreferrer" }, "Open in OpenStreetMap", K.icon("open_in_new"))],
          ["Last updated", K.format.fullDate.format(new Date(location.updated_at))]
        ]),
        // Photos and accessibility features save on their own (location-details.js).
        window.NavAbleLocationDetails
          ? window.NavAbleLocationDetails.section(location, { onChange: () => view.load() })
          : null,
        el("h3", { className: "nv-subhead", text: "Details" }),
        locationFields(location)
      ],
      onSubmit: async (dialogForm, { showError }) => {
        const values = readLocation(dialogForm, location);
        const changed = Object.keys(values).filter((key) => String(values[key] ?? "") !== String(location[key] ?? ""));
        if (!changed.length) {
          K.toast("Nothing changed, so nothing was saved.");
          return true;
        }
        const saved = await K.mutate(() => db.from("locations")
          .update({ ...values, updated_at: K.nowIso() })
          .eq("location_id", location.location_id)
          .select("location_id"), {
          success: changed.length === 1 && changed[0] === "verification_status"
            ? `${values.location_name} is now ${values.verification_status}.`
            : `${values.location_name} saved.`,
          failure: "The location was not saved.",
          onError: showError
        });
        if (!saved) return false;
        view.load();
        return true;
      }
    });
  }

  // ---------- CSV ----------

  async function download() {
    downloadButton.disabled = true;
    try {
      const data = await K.allRows(() => listQuery("location_id, location_name, category, address, latitude, longitude, accessibility_score, verification_status, description, created_at, updated_at"));
      K.downloadCsv(`navable-locations-${K.today()}.csv`, [
        ["Location ID", "Name", "Category", "Address", "Latitude", "Longitude", "Accessibility score", "Status", "Description", "Added", "Last updated"],
        ...data.map((l) => [l.location_id, l.location_name, l.category, l.address, l.latitude, l.longitude, l.accessibility_score, l.verification_status, l.description, l.created_at, l.updated_at])
      ]);
    } catch (error) {
      K.toast(`The CSV could not be created. ${K.friendlyError(error)}`, { assertive: true });
    } finally {
      downloadButton.disabled = false;
    }
  }

  // ---------- start ----------

  filters = K.bindFilters(form, {
    initial: { status: K.param("status"), search: K.param("search") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  if (K.param("category")) filters.category = K.param("category");
  downloadButton.addEventListener("click", download);
  addButton.addEventListener("click", addLocation);

  const view = K.createPage({
    name: "Locations",
    run: async () => {
      const categoriesResult = await Promise.allSettled([loadCategories()]);
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      addButton.disabled = false;
      return [...categoriesResult, ...stats, list];
    }
  });
});
