// Route Guides: where to find an accessibility feature at a place, written by
// contributors (table `feature_guides`). Admins approve or reject each guide
// with the review_feature_guide function, which also notifies the contributor.
//
// Approving first copies both photos into the admin-only location-photos
// bucket. Contributors can still change files in their own report-photos
// folder, and that folder's name contains their user id, so a public guide
// must never point there.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, icon, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const form = document.getElementById("guideFilters");

  const PAGE_SIZE = 12;
  const STATUS = {
    Pending: ["warning", "schedule", "Pending"],
    Approved: ["success", "check_circle", "Approved"],
    Rejected: ["neutral", "cancel", "Rejected"]
  };
  const REPORT_BUCKET = "report-photos";
  const PLACE_BUCKET = "location-photos";
  const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const LIST_COLUMNS = "guide_id, location_id, where_text, floor, landmark, latitude, longitude, feature_photo_url, nearby_photo_url, status, review_note, created_at, locations(location_name, address), accessibility_features(feature_name), contributor:users!feature_guides_user_id_fkey(email, user_profiles(first_name, last_name))";

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function listQuery(columns, options) {
    let query = db.from("feature_guides").select(columns, options);
    if (filters.status) query = query.eq("status", filters.status);
    return query.order("created_at", { ascending: false }).order("guide_id");
  }

  // ---------- stats ----------

  async function loadStats() {
    const settled = await Promise.allSettled(
      Object.keys(STATUS).map((status) => K.count("feature_guides", (q) => q.eq("status", status))));
    Object.keys(STATUS).forEach((status, index) => {
      const value = K.ok(settled[index]);
      const metric = status.toLowerCase();
      if (value === undefined) K.setStat(metric, { error: true });
      else K.setStat(metric, { value: K.format.number.format(value), meta: K.plural(value, "guide") });
    });
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
      return { status: "fulfilled", value: result };
    } catch (error) {
      if (current()) {
        listPanel.replaceChildren(K.errorBox("Route guides could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function thumbnail(url, label) {
    if (!/^https:\/\//i.test(url || "")) return el("div", { className: "nv-thumb", title: "No photo" }, icon("image_not_supported"));
    const img = el("img", { src: url, alt: label, loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(icon("broken_image")), { once: true });
    return el("a", { className: "nv-thumb", href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open ${label} in a new tab` }, img);
  }

  const pinLink = (guide) => (guide.latitude == null || guide.longitude == null
    ? null
    : el("a", {
      className: "nv-link",
      href: `https://www.openstreetmap.org/?mlat=${guide.latitude}&mlon=${guide.longitude}#map=19/${guide.latitude}/${guide.longitude}`,
      target: "_blank",
      rel: "noopener noreferrer"
    }, "Open pin in OpenStreetMap", icon("open_in_new")));

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "guide")}. Newest first.`
      : "No matching guides.";

    if (!total) {
      listPanel.replaceChildren(filters.status === "Pending"
        ? K.stateBox("empty", "Nothing waiting for review", "Guides that contributors submit in the NavAble app will appear here.")
        : K.stateBox("empty", "No guides here", "Try a different status."));
      return;
    }

    const items = rows.map((guide) => {
      const place = K.one(guide.locations);
      const feature = K.one(guide.accessibility_features)?.feature_name || "Feature";
      const placeName = place?.location_name || "Unknown location";
      const actions = guide.status === "Pending"
        ? [
          K.button("Approve", { iconName: "check", tone: "primary", small: true, ariaLabel: `Approve the ${feature} guide for ${placeName}`, onClick: (event) => K.withBusy(event.currentTarget, () => approve(guide, feature)) }),
          K.button("Reject", { iconName: "close", small: true, ariaLabel: `Reject the ${feature} guide for ${placeName}`, onClick: (event) => reject(guide, feature, placeName, event.currentTarget) })
        ]
        : [];
      return el("li", { className: "nv-item" },
        el("div", { className: "nv-item-media" },
          el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
            thumbnail(guide.feature_photo_url, `photo of the ${feature}`),
            thumbnail(guide.nearby_photo_url, `photo of what is near the ${feature}`)),
          el("div", { style: "display:grid;gap:8px;min-width:0" },
            el("div", { className: "nv-item-head" },
              el("div", { className: "nv-item-meta" },
                el("strong", { style: "color:var(--admin-text);font-size:0.95rem", text: feature }),
                el("span", { className: "nv-cell-main", text: placeName })),
              badge(STATUS, guide.status)),
            el("p", { style: "margin:0;overflow-wrap:anywhere", text: guide.where_text }),
            el("div", { className: "nv-item-meta" },
              guide.floor ? el("span", { text: `Floor: ${guide.floor}` }) : null,
              guide.landmark ? el("span", { text: `Near: ${guide.landmark}` }) : null,
              pinLink(guide)),
            el("div", { className: "nv-item-meta" },
              el("span", { text: `Submitted by ${K.personName(K.one(guide.contributor))}` }),
              el("span", {}, "Sent ", K.timeEl(guide.created_at))),
            guide.review_note ? el("p", { className: "nv-hint", style: "margin:0", text: `Reason: ${guide.review_note}` }) : null,
            actions.length ? el("div", { className: "nv-row-actions", style: "justify-content:flex-start" }, actions) : null)));
    });

    listPanel.replaceChildren(
      el("ul", { className: "nv-list", "aria-label": "Route guides" }, items),
      K.pager({ page, size: PAGE_SIZE, total, noun: "guides", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  // ---------- decisions ----------

  const decide = (guide, decision, note, options) => K.mutate(
    () => db.rpc("review_feature_guide", { guide: guide.guide_id, decision, note }),
    { expectRows: false, ...options });

  // The file's path inside a public storage bucket, or null for other links.
  function bucketPath(url, bucket) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const start = (url || "").indexOf(marker);
    return start < 0 ? null : decodeURIComponent(url.slice(start + marker.length).split(/[?#]/)[0]);
  }

  // Copies a contributor's photo to the admin-only bucket; returns its new link.
  async function publishPhoto(guide, url, name) {
    if (bucketPath(url, PLACE_BUCKET)) return url;
    if (!bucketPath(url, REPORT_BUCKET)) throw new Error("This photo is not stored in NavAble.");
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("A photo could not be read.");
    const photo = await response.blob();
    const extension = PHOTO_TYPES[photo.type];
    if (!extension) throw new Error("A photo is not a JPG, PNG, or WebP image.");
    const path = `${guide.location_id}/guides/${guide.guide_id}/${name}.${extension}`;
    const { error } = await db.storage.from(PLACE_BUCKET).upload(path, photo, { contentType: photo.type, upsert: true });
    if (error) throw error;
    return db.storage.from(PLACE_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // Removes photos uploaded for this guide. Scan photos reused from a report
  // stay, because the report still needs them.
  async function removeContributorPhotos(guide) {
    const paths = [guide.feature_photo_url, guide.nearby_photo_url]
      .map((url) => bucketPath(url, REPORT_BUCKET))
      .filter((path) => path && path.includes("/guides/"));
    if (!paths.length) return;
    const { error } = await db.storage.from(REPORT_BUCKET).remove(paths);
    if (error) console.warn("NavAble: contributor photos were not removed.", error);
  }

  async function approve(guide, feature) {
    let photos;
    try {
      photos = {
        feature_photo_url: await publishPhoto(guide, guide.feature_photo_url, "feature"),
        nearby_photo_url: await publishPhoto(guide, guide.nearby_photo_url, "nearby")
      };
    } catch (error) {
      console.error("NavAble: guide photos were not copied.", error);
      K.toast(`The guide was not approved. ${K.friendlyError(error)}`, { assertive: true, duration: 6000 });
      return;
    }
    const moved = await K.mutate(() => db.from("feature_guides")
      .update(photos)
      .eq("guide_id", guide.guide_id)
      .eq("status", "Pending")
      .select("guide_id"), { failure: "The guide was not approved." });
    if (!moved) return;
    const saved = await decide(guide, "Approved", null, {
      success: `${feature} guide approved. The contributor was notified.`,
      failure: "The guide was not approved."
    });
    if (!saved) return;
    await removeContributorPhotos(guide);
    await view.load();
  }

  function reject(guide, feature, placeName, trigger) {
    K.openDialog({
      title: `Reject the ${feature} guide`,
      description: placeName,
      returnFocus: trigger,
      submitLabel: "Reject guide",
      submitIcon: "close",
      danger: true,
      content: K.field({
        label: "Reason",
        name: "reason",
        type: "textarea",
        required: true,
        maxLength: 300,
        rows: 3,
        hint: "The contributor sees this in their notification."
      }),
      onSubmit: async (dialogForm, { showError }) => {
        const note = K.formText(dialogForm, "reason");
        if (!note) {
          showError("Add a reason so the contributor knows what to fix.");
          return false;
        }
        const saved = await decide(guide, "Rejected", note, {
          success: `${feature} guide rejected. The contributor was notified.`,
          failure: "The guide was not rejected.",
          onError: showError
        });
        if (!saved) return false;
        await removeContributorPhotos(guide);
        await view.load();
        return true;
      }
    });
  }

  // ---------- start ----------

  filters = K.bindFilters(form, {
    initial: { status: K.param("status") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();

  const view = K.createPage({
    name: "Route guides",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      return [...stats, list];
    }
  });
});
