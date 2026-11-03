// Accessibility Data: the feature catalog (`accessibility_features`) and the
// features recorded at each location (`location_features`). Admins add and
// edit features, record features at locations, and mark records as verified.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, icon, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const catalogPanel = main.querySelector('[data-panel="catalog"]');
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("recordsDownload");
  const featureAddButton = document.getElementById("featureAdd");
  const recordAddButton = document.getElementById("recordAdd");
  const form = document.getElementById("recordFilters");
  const featureSelect = document.getElementById("filterFeature");

  const PAGE_SIZE = 20;
  const PERSON = "email, user_profiles(first_name, last_name)";
  const RECORD_COLUMNS = `location_feature_id, location_id, feature_id, availability, remarks, verified_at, locations!inner(location_name, address), accessibility_features(feature_name), users(${PERSON})`;

  let filters = {};
  let page = 0;
  let features = [];
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.feature) query = query.eq("feature_id", filters.feature);
    if (filters.availability) query = query.eq("availability", filters.availability === "true");
    if (filters.verified === "yes") query = query.not("verified_at", "is", null);
    if (filters.verified === "no") query = query.is("verified_at", null);
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("locations.location_name", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("location_features").select(columns, options))
    .order("location_id")
    .order("location_feature_id");

  const filtersActive = () => Boolean(filters.search || filters.feature || filters.availability || filters.verified);

  // ---------- stats and catalog ----------

  async function loadSummary() {
    const settled = await Promise.allSettled([
      K.rows(db.from("accessibility_features").select("feature_id, feature_name, description, icon, status, updated_at").order("feature_name")),
      K.allRows(() => db.from("location_features").select("feature_id, location_id").eq("availability", true).order("location_feature_id")),
      K.count("location_features"),
      K.count("location_features", (q) => q.not("verified_at", "is", null))
    ]);
    const [featuresResult, linksResult, recordsResult, verifiedResult] = settled;
    const fmt = K.format.number;

    if (featuresResult.status === "fulfilled") {
      features = featuresResult.value;
      const active = features.filter((f) => f.status === "Active").length;
      K.setStat("features", { value: fmt.format(active), meta: features.length > active ? `${fmt.format(features.length - active)} inactive` : features.length ? "All features active" : "No features defined yet" });
      fillFeatureFilter();
      featureAddButton.disabled = false;
      recordAddButton.disabled = !active;
    } else {
      K.setStat("features", { error: true });
    }
    renderCatalog(featuresResult, linksResult);

    const records = K.ok(recordsResult);
    const verified = K.ok(verifiedResult);
    if (records === undefined) K.setStat("records", { error: true });
    else K.setStat("records", { value: fmt.format(records), meta: "Feature entries across all locations" });
    if (records === undefined || verified === undefined) {
      K.setStat("verified", { error: true });
      K.setStat("unverified", { error: true });
    } else {
      K.setStat("verified", { value: fmt.format(verified), meta: records ? `${K.percent(verified, records)}% of records` : "No records yet" });
      K.setStat("unverified", { value: fmt.format(records - verified), meta: records - verified ? "Waiting for an admin to confirm" : "Nothing waiting" });
    }
    return settled;
  }

  function fillFeatureFilter() {
    if (filters.feature && !features.some((f) => f.feature_id === filters.feature)) filters.feature = "";
    featureSelect.replaceChildren(el("option", { value: "" }, "All features"),
      ...features.map((f) => el("option", { value: f.feature_id, selected: f.feature_id === filters.feature }, f.status === "Active" ? f.feature_name : `${f.feature_name} (inactive)`)));
  }

  function renderCatalog(featuresResult, linksResult) {
    if (featuresResult.status === "rejected") {
      catalogPanel.replaceChildren(K.errorBox("The feature catalog could not load", featuresResult.reason, () => view.load({ announce: true })));
      return;
    }
    if (!features.length) {
      catalogPanel.replaceChildren(K.stateBox("empty", "No features defined yet", "Add features such as Ramp or Elevator so they can be recorded at locations."));
      return;
    }
    const locationsByFeature = new Map();
    if (linksResult.status === "fulfilled") {
      linksResult.value.forEach(({ feature_id: featureId, location_id: locationId }) => {
        if (!locationsByFeature.has(featureId)) locationsByFeature.set(featureId, new Set());
        locationsByFeature.get(featureId).add(locationId);
      });
    }
    const body = features.map((feature) => el("tr", {},
      el("td", {},
        el("div", { className: "nv-cell-main", style: "display:flex;align-items:center;gap:8px" }, feature.icon ? icon(feature.icon) : null, feature.feature_name),
        feature.description ? el("div", { className: "nv-cell-sub nv-clamp", text: feature.description }) : null),
      el("td", {}, badge("featureStatus", feature.status)),
      el("td", { className: "nv-hide-sm" }, linksResult.status === "fulfilled"
        ? K.plural(locationsByFeature.get(feature.feature_id)?.size || 0, "location")
        : el("span", { className: "nv-cell-sub", text: "Could not load" })),
      el("td", { className: "is-actions" },
        K.button("Edit", { iconName: "edit", small: true, ariaLabel: `Edit ${feature.feature_name}`, onClick: (event) => editFeature(feature, event.currentTarget) }))));
    catalogPanel.replaceChildren(K.tableEl("Accessibility feature catalog", [["Feature"], ["Status"], ["Available at", "nv-hide-sm"], ["Actions", "is-actions"]], body));
    K.settleFocus(catalogPanel);
  }

  function featureFields(feature = {}) {
    return el("div", { className: "nv-form-grid" },
      el("div", { className: "is-full" }, K.field({ label: "Name", name: "feature_name", required: true, maxLength: 100, value: feature.feature_name })),
      el("div", { className: "is-full" }, K.field({ label: "Description", name: "description", type: "textarea", rows: 2, maxLength: 255, value: feature.description })),
      K.field({ label: "Icon name", name: "icon", value: feature.icon, hint: "Optional. A Material Symbols name, for example accessible or elevator." }),
      K.field({ label: "Status", name: "status", type: "select", value: feature.status || "Active", options: [["Active", "Active"], ["Inactive", "Inactive"]] }));
  }

  function readFeature(dialogForm) {
    const iconName = K.formText(dialogForm, "icon");
    return {
      feature_name: K.formText(dialogForm, "feature_name"),
      description: K.formText(dialogForm, "description"),
      icon: iconName ? iconName.toLowerCase().replace(/[^a-z0-9_]/g, "_") : null,
      status: dialogForm.elements.status.value
    };
  }

  function editFeature(feature, trigger) {
    const isNew = !feature;
    K.openDialog({
      title: isNew ? "Add feature" : `Edit ${feature.feature_name}`,
      content: featureFields(feature || {}),
      submitLabel: isNew ? "Add feature" : "Save changes",
      submitIcon: isNew ? "add" : "save",
      returnFocus: trigger,
      onSubmit: async (dialogForm, { showError }) => {
        const values = readFeature(dialogForm);
        const saved = await K.mutate(() => (isNew
          ? db.from("accessibility_features").insert(values)
          : db.from("accessibility_features").update({ ...values, updated_at: K.nowIso() }).eq("feature_id", feature.feature_id)
        ).select("feature_id"), {
          success: isNew ? `${values.feature_name} added to the catalog.` : `${values.feature_name} saved.`,
          failure: isNew ? "The feature was not added." : "The feature was not saved.",
          onError: showError
        });
        if (!saved) return false;
        view.load();
        return true;
      }
    });
  }

  // ---------- records list ----------

  async function loadList() {
    const current = isLatest();
    K.loadingPanel(listPanel);
    try {
      const result = await K.pageOf(listQuery(RECORD_COLUMNS, { count: "exact" }), page, PAGE_SIZE);
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
        listPanel.replaceChildren(K.errorBox("Feature records could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function verifiedCell(record) {
    if (!record.verified_at) return badge({ no: ["warning", "pending", "Not yet verified"] }, "no");
    return el("div", {},
      el("div", {}, badge({ yes: ["success", "verified", "Verified"] }, "yes")),
      el("div", { className: "nv-cell-sub" }, K.one(record.users) ? `${K.personName(K.one(record.users))}, ` : "", K.timeEl(record.verified_at)));
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "record")}${filtersActive() ? " match these filters" : ""}.`
      : "No matching records.";

    if (!total) {
      listPanel.replaceChildren(filtersActive()
        ? K.stateBox("empty", "No records match these filters", "Try a different feature, availability, verification, or location name.")
        : K.stateBox("empty", "No features recorded at locations yet", "Use Record a feature to note which features a location has."));
      return;
    }

    const body = rows.map((record) => {
      const location = K.one(record.locations);
      const featureName = K.one(record.accessibility_features)?.feature_name || "Unknown feature";
      return el("tr", {},
        el("td", {},
          el("div", { className: "nv-cell-main", text: location?.location_name || "Unknown location" }),
          el("div", { className: "nv-cell-sub nv-hide-sm", text: location?.address || "" }),
          el("div", { className: "nv-cell-sub nv-show-sm", text: featureName })),
        el("td", { className: "nv-hide-sm", text: featureName }),
        el("td", {}, record.availability
          ? el("span", { className: "nv-badge", "data-tone": "success" }, icon("check"), "Available")
          : el("span", { className: "nv-badge", "data-tone": "neutral" }, icon("close"), "Not available")),
        el("td", { className: "nv-hide-sm" }, record.remarks ? el("span", { className: "nv-cell-sub nv-clamp", text: record.remarks }) : el("span", { className: "nv-cell-sub", text: "—" })),
        el("td", { className: "nv-hide-sm" }, verifiedCell(record)),
        el("td", { className: "is-actions" },
          K.button("Edit", { iconName: "edit", small: true, ariaLabel: `Edit ${featureName} at ${location?.location_name || "unknown location"}`, onClick: (event) => editRecord(record, event.currentTarget) })));
    });

    listPanel.replaceChildren(
      K.tableEl("Features recorded at locations", [["Location"], ["Feature", "nv-hide-sm"], ["Availability"], ["Remarks", "nv-hide-sm"], ["Verification", "nv-hide-sm"], ["Actions", "is-actions"]], body),
      K.pager({ page, size: PAGE_SIZE, total, noun: "records", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  // ---------- record dialogs ----------

  // Verification fields to write, based on the dialog's Verification choice.
  function verificationChange(dialogForm) {
    const choice = dialogForm.elements.verify.value;
    if (choice === "verify") return { verified_by: window.NavAbleStaff.user_id, verified_at: K.nowIso() };
    if (choice === "clear") return { verified_by: null, verified_at: null };
    return {};
  }

  function editRecord(record, trigger) {
    const location = K.one(record.locations);
    const featureName = K.one(record.accessibility_features)?.feature_name || "Unknown feature";
    const wasVerified = Boolean(record.verified_at);
    const removeButton = K.button("Remove this record", {
      iconName: "delete", tone: "danger", small: true,
      onClick: async (event) => {
        if (!window.NavAbleAdmin.confirmAction(`Remove ${featureName} from ${location?.location_name || "this location"}? This deletes the record permanently.`)) return;
        await K.withBusy(event.currentTarget, async () => {
          const removed = await K.mutate(() => db.from("location_features").delete().eq("location_feature_id", record.location_feature_id).select("location_feature_id"), {
            success: `${featureName} removed from ${location?.location_name || "the location"}.`,
            failure: "The record was not removed.",
            onError: (message) => { errorNote.textContent = message; errorNote.hidden = false; }
          });
          if (removed) {
            dialog.close();
            view.load();
          }
        });
      }
    });
    const errorNote = el("p", { className: "nv-form-error", role: "alert", hidden: true });

    const { dialog } = K.openDialog({
      title: `${featureName} at ${location?.location_name || "unknown location"}`,
      description: location?.address,
      returnFocus: trigger,
      content: [
        el("div", { className: "nv-form-grid" },
          K.field({ label: "Availability", name: "availability", type: "select", value: String(record.availability), options: [["true", "Available"], ["false", "Not available"]] }),
          K.field({
            label: "Verification", name: "verify", type: "select", value: "keep",
            options: wasVerified
              ? [["keep", "Keep as verified"], ["verify", "Verify again as me, now"], ["clear", "Mark as not verified"]]
              : [["keep", "Leave as not verified"], ["verify", "Mark as verified by me"]]
          }),
          el("div", { className: "is-full" }, K.field({ label: "Remarks", name: "remarks", type: "textarea", rows: 3, maxLength: 255, value: record.remarks }))),
        el("h3", { className: "nv-subhead", text: "Remove" }),
        el("p", { className: "nv-cell-sub", style: "margin:0 0 10px", text: "Remove the record if it was added to the wrong location or feature." }),
        removeButton,
        errorNote
      ],
      onSubmit: async (dialogForm, { showError }) => {
        const values = {
          availability: dialogForm.elements.availability.value === "true",
          remarks: K.formText(dialogForm, "remarks"),
          ...verificationChange(dialogForm)
        };
        const changed = values.availability !== record.availability || (values.remarks ?? "") !== (record.remarks ?? "") || "verified_at" in values;
        if (!changed) {
          K.toast("Nothing changed, so nothing was saved.");
          return true;
        }
        const saved = await K.mutate(() => db.from("location_features")
          .update(values)
          .eq("location_feature_id", record.location_feature_id)
          .select("location_feature_id"), {
          success: `${featureName} at ${location?.location_name || "the location"} saved.`,
          failure: "The record was not saved.",
          onError: showError
        });
        if (!saved) return false;
        view.load();
        return true;
      }
    });
  }

  async function addRecord() {
    let locations;
    try {
      locations = await K.allRows(() => db.from("locations").select("location_id, location_name, address").order("location_name").order("location_id"));
    } catch (error) {
      K.toast(`Locations could not be loaded. ${K.friendlyError(error)}`, { assertive: true });
      return;
    }
    if (!locations.length) {
      K.toast("Add a location first on the Locations page.");
      return;
    }
    const active = features.filter((f) => f.status === "Active");
    K.openDialog({
      title: "Record a feature",
      description: "Note that a location has (or lacks) an accessibility feature.",
      returnFocus: recordAddButton,
      submitLabel: "Save record",
      submitIcon: "add_task",
      content: el("div", { className: "nv-form-grid" },
        el("div", { className: "is-full" }, K.field({
          label: "Location", name: "location_id", type: "select", required: true, value: "",
          options: [["", "Choose a location"], ...locations.map((l) => [l.location_id, `${l.location_name} — ${l.address}`])]
        })),
        K.field({ label: "Feature", name: "feature_id", type: "select", required: true, value: "", options: [["", "Choose a feature"], ...active.map((f) => [f.feature_id, f.feature_name])] }),
        K.field({ label: "Availability", name: "availability", type: "select", value: "true", options: [["true", "Available"], ["false", "Not available"]] }),
        el("div", { className: "is-full" }, K.field({ label: "Remarks", name: "remarks", type: "textarea", rows: 2, maxLength: 255 })),
        el("div", { className: "is-full" }, K.field({ label: "Mark as verified by me", name: "verified", type: "checkbox", checked: true, hint: "Leave ticked if you have confirmed this yourself." }))),
      onSubmit: async (dialogForm, { showError }) => {
        const verified = dialogForm.elements.verified.checked;
        const values = {
          location_id: dialogForm.elements.location_id.value,
          feature_id: dialogForm.elements.feature_id.value,
          availability: dialogForm.elements.availability.value === "true",
          remarks: K.formText(dialogForm, "remarks"),
          verified_by: verified ? window.NavAbleStaff.user_id : null,
          verified_at: verified ? K.nowIso() : null
        };
        const featureName = active.find((f) => f.feature_id === values.feature_id)?.feature_name;
        const locationName = locations.find((l) => l.location_id === values.location_id)?.location_name;
        const saved = await K.mutate(() => db.from("location_features").insert(values).select("location_feature_id"), {
          success: `${featureName} recorded at ${locationName}.`,
          failure: "The record was not saved.",
          onError: (message) => showError(message.includes("matching record already exists")
            ? `${featureName} is already recorded at ${locationName}. Edit that record instead.`
            : message)
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
      const data = await K.allRows(() => listQuery(RECORD_COLUMNS));
      K.downloadCsv(`navable-location-features-${K.today()}.csv`, [
        ["Record ID", "Location", "Address", "Feature", "Available", "Remarks", "Verified by", "Verified at"],
        ...data.map((r) => {
          const location = K.one(r.locations);
          return [r.location_feature_id, location?.location_name, location?.address, K.one(r.accessibility_features)?.feature_name, r.availability ? "Yes" : "No", r.remarks, r.verified_at ? K.personName(K.one(r.users)) : "", r.verified_at];
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
    initial: { availability: K.param("availability"), verified: K.param("verified") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  if (K.param("feature")) filters.feature = K.param("feature");
  downloadButton.addEventListener("click", download);
  featureAddButton.addEventListener("click", () => editFeature(null, featureAddButton));
  recordAddButton.addEventListener("click", () => K.withBusy(recordAddButton, addRecord));

  const view = K.createPage({
    name: "Accessibility data",
    run: async () => {
      const summarySettled = await loadSummary();
      const list = await loadList();
      return [...summarySettled, list];
    }
  });
});
