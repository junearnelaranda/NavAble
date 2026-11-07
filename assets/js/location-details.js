// Place details managed inside the Locations dialog: photos (Supabase Storage
// bucket "location-photos" plus rows in public.images) and which accessibility
// features the place has (public.location_features). Each section saves on its
// own; the dialog's Save button still saves the location's main fields.
// Usage: content: [..., NavAbleLocationDetails.section(location, { onChange })]
(() => {
  "use strict";

  const BUCKET = "location-photos";
  const MAX_BYTES = 5 * 1024 * 1024;
  const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  function section(location, { onChange } = {}) {
    const K = window.NavAbleKit;
    const { el } = K;
    const db = K.db();
    const photosPanel = el("div", {}, K.skeletonLines(2));
    const featuresPanel = el("div", {}, K.skeletonLines(3));
    const changed = () => onChange?.();

    // ---------- photos ----------

    async function loadPhotos() {
      try {
        const photos = await K.rows(db.from("images")
          .select("image_id, image_url, image_name, upload_date, users(role, account_status)")
          .eq("location_id", location.location_id)
          .order("upload_date")
          .order("image_id"));
        renderPhotos(photos);
      } catch (error) {
        photosPanel.replaceChildren(K.errorBox("Photos could not load", error, loadPhotos));
      }
    }

    const storagePath = (url) => {
      const marker = `/storage/v1/object/public/${BUCKET}/`;
      const index = (url || "").indexOf(marker);
      return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length));
    };

    // The app shows only photos an active admin uploaded (users' report
    // photos stay private), so the cover is the first admin photo.
    const byAdmin = (photo) => {
      const user = K.one(photo.users);
      return user?.role === "Admin" && user?.account_status === "Active";
    };

    function renderPhotos(photos) {
      const coverId = photos.find(byAdmin)?.image_id;
      const status = el("p", { className: "nv-cell-sub", role: "status", style: "margin:8px 0 0" });
      const fileInput = el("input", { type: "file", accept: Object.keys(TYPES).join(","), multiple: true, className: "sr-only", "aria-label": `Choose photos of ${location.location_name}` });
      const linkInput = el("input", { type: "url", className: "nv-input", placeholder: "https://…/photo.jpg", "aria-label": "Photo link", style: "flex:1 1 220px" });

      const grid = photos.length
        ? el("ul", { className: "nv-photo-grid", "aria-label": `Photos of ${location.location_name}` }, photos.map((photo, index) => {
          const isHttp = /^https?:\/\//i.test(photo.image_url || "");
          return el("li", { className: "nv-photo-tile" },
            isHttp
              ? el("img", { src: photo.image_url, alt: photo.image_name ? `Photo: ${photo.image_name}` : `Photo ${index + 1} of ${location.location_name}`, loading: "lazy" })
              : el("div", { className: "nv-thumb" }, K.icon("image_not_supported")),
            photo.image_id === coverId
              ? el("span", { className: "nv-badge nv-photo-cover", "data-tone": "success" }, K.icon("star"), "Cover")
              : byAdmin(photo)
                ? null
                : el("span", { className: "nv-badge nv-photo-cover", "data-tone": "warning", title: "From a user's report. Not shown in the app." }, K.icon("visibility_off"), "Report photo"),
            K.button("", {
              iconName: "delete", small: true, tone: "danger", ariaLabel: `Remove photo ${index + 1}${photo.image_name ? ` (${photo.image_name})` : ""}`,
              onClick: (event) => K.withBusy(event.currentTarget, () => removePhoto(photo))
            }));
        }))
        : K.stateBox("empty", "No photos yet", "Add photos so people can see the entrance and facilities before they go.");

      const upload = K.button("Upload photos", { iconName: "add_photo_alternate", small: true, tone: "primary", onClick: () => fileInput.click() });
      fileInput.addEventListener("change", () => K.withBusy(upload, () => uploadFiles([...fileInput.files], status)));
      const addLink = K.button("Add link", {
        iconName: "link", small: true,
        onClick: (event) => K.withBusy(event.currentTarget, () => addByLink(linkInput, status))
      });
      // Enter adds the link instead of submitting the location form around it.
      linkInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addLink.click();
      });

      photosPanel.replaceChildren(
        grid,
        el("div", { className: "nv-row-actions", style: "justify-content:flex-start;margin-top:12px" }, upload, fileInput),
        el("p", { className: "nv-hint", style: "margin-top:6px", text: "JPG, PNG, or WebP up to 5 MB each. The first photo you upload is the cover shown in the app. Report photos from users stay private." }),
        el("div", { className: "nv-row-actions", style: "justify-content:flex-start;margin-top:10px" }, linkInput, addLink),
        status);
    }

    async function uploadFiles(files, status) {
      if (!files.length) return;
      const me = window.NavAbleStaff.user_id;
      let added = 0;
      const problems = [];
      for (const [index, file] of files.entries()) {
        status.textContent = `Uploading ${index + 1} of ${files.length}…`;
        const ext = TYPES[file.type];
        if (!ext) { problems.push(`${file.name}: not a JPG, PNG, or WebP image`); continue; }
        if (file.size > MAX_BYTES) { problems.push(`${file.name}: larger than 5 MB`); continue; }
        const path = `${location.location_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) { problems.push(`${file.name}: ${K.friendlyError(uploadError)}`); continue; }
        const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path);
        const { error: rowError } = await db.from("images").insert({
          user_id: me,
          location_id: location.location_id,
          image_url: publicUrl,
          image_name: file.name.slice(0, 255),
          image_size: Math.max(1, Math.ceil(file.size / 1024)),
          upload_status: "Uploaded"
        });
        if (rowError) {
          // Don't leave an orphaned file behind if the record wasn't saved.
          await db.storage.from(BUCKET).remove([path]);
          problems.push(`${file.name}: ${K.friendlyError(rowError)}`);
          continue;
        }
        added += 1;
      }
      status.textContent = "";
      if (added) K.toast(`${K.plural(added, "photo")} added to ${location.location_name}.`);
      if (problems.length) K.toast(`Some photos weren't added. ${problems.join("; ")}`, { assertive: true, duration: 8000 });
      await loadPhotos();
      if (added) changed();
    }

    async function addByLink(input, status) {
      const url = input.value.trim();
      if (!/^https:\/\/\S+$/i.test(url)) {
        status.textContent = "Enter a link that starts with https://";
        input.focus();
        return;
      }
      const saved = await K.mutate(() => db.from("images").insert({
        user_id: window.NavAbleStaff.user_id,
        location_id: location.location_id,
        image_url: url,
        image_name: url.split("/").pop().split("?")[0].slice(0, 255) || null,
        upload_status: "Uploaded"
      }).select("image_id"), { success: "Photo link added.", failure: "The photo link was not added." });
      if (!saved) return;
      await loadPhotos();
      changed();
    }

    async function removePhoto(photo) {
      if (!window.NavAbleAdmin.confirmAction("Remove this photo from the place? This can't be undone.")) return;
      const removed = await K.mutate(() => db.from("images").delete().eq("image_id", photo.image_id).select("image_id"), {
        success: "Photo removed.",
        failure: "The photo was not removed."
      });
      if (!removed) return;
      const path = storagePath(photo.image_url);
      if (path) {
        const { error } = await db.storage.from(BUCKET).remove([path]);
        if (error) console.warn("NavAble: photo record removed but its file stayed in storage.", error);
      }
      await loadPhotos();
      changed();
    }

    // ---------- accessibility features ----------

    async function loadFeatures() {
      try {
        const [features, records] = await Promise.all([
          K.rows(db.from("accessibility_features").select("feature_id, feature_name, icon, status").order("feature_name")),
          K.rows(db.from("location_features").select("location_feature_id, feature_id, availability, verified_at").eq("location_id", location.location_id))
        ]);
        renderFeatures(features, records);
      } catch (error) {
        featuresPanel.replaceChildren(K.errorBox("Features could not load", error, loadFeatures));
      }
    }

    function renderFeatures(features, records) {
      const byFeature = new Map(records.map((record) => [record.feature_id, record]));
      // Inactive features only show when this place already has a record for them.
      const shown = features.filter((f) => f.status === "Active" || byFeature.has(f.feature_id));
      if (!shown.length) {
        featuresPanel.replaceChildren(K.stateBox("empty", "No accessibility features defined",
          "Add features such as Ramp or Elevator on the Accessibility Data page first."));
        return;
      }

      const rows = shown.map((feature) => {
        const record = byFeature.get(feature.feature_id);
        const current = record ? (record.availability ? "yes" : "no") : "";
        const note = el("span", { text: featureNote(feature, record) });
        const select = el("select", { className: "nv-select", "data-feature": feature.feature_id, "aria-label": `${feature.feature_name} at ${location.location_name}`, style: "width:auto;min-width:170px" },
          [["", "Not recorded"], ["yes", "Available"], ["no", "Not available"]].map(([value, text]) => el("option", { value, selected: value === current }, text)));
        select.dataset.saved = current;
        // Each change saves right away, so nothing is lost if the dialog is closed
        // or its main "Save changes" button is used.
        select.addEventListener("change", () => saveFeature(feature, select, note, byFeature));
        return el("li", { className: "nv-setting" },
          el("div", {},
            el("strong", { style: "display:flex;align-items:center;gap:8px" }, feature.icon ? K.icon(feature.icon) : null, feature.feature_name),
            note),
          select);
      });

      const list = el("ul", { className: "nv-list", style: "gap:0", "aria-label": `Accessibility features at ${location.location_name}` }, rows);
      featuresPanel.replaceChildren(list,
        el("p", { className: "nv-hint", style: "margin-top:8px", text: "Each change saves as soon as you pick an option, and records you as the admin who verified it." }));
    }

    function featureNote(feature, record) {
      if (feature.status !== "Active") return "Inactive feature";
      if (!record) return "";
      return record.verified_at ? `Verified ${K.format.relativeTime(record.verified_at)}` : "Not yet verified";
    }

    async function saveFeature(feature, select, note, byFeature) {
      const value = select.value;
      const previous = select.dataset.saved;
      const record = byFeature.get(feature.feature_id);
      const me = window.NavAbleStaff.user_id;
      const now = K.nowIso();
      select.disabled = true;
      note.textContent = "Saving…";

      let result;
      if (!value) {
        result = record
          ? await db.from("location_features").delete().eq("location_feature_id", record.location_feature_id).select("location_feature_id")
          : { data: [], error: null };
      } else if (record) {
        result = await db.from("location_features")
          .update({ availability: value === "yes", verified_by: me, verified_at: now })
          .eq("location_feature_id", record.location_feature_id)
          .select("location_feature_id, feature_id, availability, verified_at");
      } else {
        result = await db.from("location_features")
          .insert({ location_id: location.location_id, feature_id: feature.feature_id, availability: value === "yes", verified_by: me, verified_at: now })
          .select("location_feature_id, feature_id, availability, verified_at");
      }
      select.disabled = false;

      // A change that matched no row (removed meanwhile, or not allowed) counts as a failure.
      const missed = record && Array.isArray(result.data) && !result.data.length;
      if (result.error || missed) {
        select.value = previous;
        note.textContent = featureNote(feature, record);
        const reason = result.error ? K.friendlyError(result.error) : "The record was not found. Reopen this place and try again.";
        K.toast(`${feature.feature_name} wasn't saved. ${reason}`, { assertive: true, duration: 7000 });
        return;
      }

      if (!value) byFeature.delete(feature.feature_id);
      else byFeature.set(feature.feature_id, result.data[0]);
      select.dataset.saved = value;
      note.textContent = value ? "Saved · verified just now" : "Saved · not recorded";
      const label = { "": "not recorded", yes: "available", no: "not available" }[value];
      K.toast(`${feature.feature_name} is now ${label} at ${location.location_name}.`);
      changed();
    }

    loadPhotos();
    loadFeatures();

    return el("div", { className: "nv-location-details" },
      el("h3", { className: "nv-subhead", text: "Photos" }),
      photosPanel,
      el("h3", { className: "nv-subhead", text: "Accessibility features" }),
      featuresPanel);
  }

  window.NavAbleLocationDetails = Object.freeze({ section });
})();
