// Place details managed inside the Locations dialog: photos (Supabase Storage
// bucket "location-photos" plus rows in public.images) and which accessibility
// features the place has (public.location_features), and route guides that say
// where to find each feature (public.feature_guides). Each section saves on its
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
    const guidesPanel = el("div", {}, K.skeletonLines(2));
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

    // ---------- route guides ----------

    const GUIDE_STATUS = {
      Pending: ["warning", "schedule", "Pending"],
      Approved: ["success", "check_circle", "Approved"],
      Rejected: ["neutral", "cancel", "Rejected"]
    };

    async function loadGuides() {
      try {
        const guides = await K.rows(db.from("feature_guides")
          .select("guide_id, where_text, floor, status, created_at, feature_photo_url, nearby_photo_url, accessibility_features(feature_name)")
          .eq("location_id", location.location_id)
          .order("created_at", { ascending: false }));
        renderGuides(guides);
      } catch (error) {
        guidesPanel.replaceChildren(K.errorBox("Route guides could not load", error, loadGuides));
      }
    }

    function renderGuides(guides) {
      const rows = guides.map((guide) => {
        const feature = K.one(guide.accessibility_features)?.feature_name || "Feature";
        return el("li", { className: "nv-item" },
          el("div", { className: "nv-item-head" },
            el("div", { style: "display:grid;gap:4px;min-width:0" },
              el("strong", { text: feature }),
              el("span", { style: "overflow-wrap:anywhere", text: [guide.where_text, guide.floor].filter(Boolean).join(" · ") })),
            el("div", { className: "nv-item-meta" },
              K.badge(GUIDE_STATUS, guide.status),
              K.button("Delete", { iconName: "delete", small: true, ariaLabel: `Delete the ${feature} guide`, onClick: (event) => confirmDeleteGuide(guide, feature, event.currentTarget) }))));
      });
      guidesPanel.replaceChildren(
        rows.length
          ? el("ul", { className: "nv-list", "aria-label": `Route guides for ${location.location_name}` }, rows)
          : el("p", { className: "nv-hint", text: "No route guides for this place yet." }),
        K.button("Add guide", { iconName: "add_location_alt", small: true, onClick: (event) => openAddGuide(event.currentTarget) }));
    }

    function confirmDeleteGuide(guide, feature, trigger) {
      K.openDialog({
        title: `Delete the ${feature} guide?`,
        description: "It will no longer be shown in the NavAble app. This can't be undone.",
        returnFocus: trigger,
        submitLabel: "Delete guide",
        submitIcon: "delete",
        danger: true,
        content: el("p", { style: "margin:0;overflow-wrap:anywhere", text: guide.where_text }),
        onSubmit: async (form, { showError }) => {
          const saved = await K.mutate(() => db.from("feature_guides").delete().eq("guide_id", guide.guide_id).select("guide_id"), {
            success: `${feature} guide deleted.`,
            failure: "The guide was not deleted.",
            onError: showError
          });
          if (!saved) return false;
          await removeGuidePhotos(guide);
          await loadGuides();
          return true;
        }
      });
    }

    // Removes photos stored for this guide. Scan photos reused from a report
    // stay, because the report still needs them.
    async function removeGuidePhotos(guide) {
      for (const bucket of [BUCKET, "report-photos"]) {
        const marker = `/storage/v1/object/public/${bucket}/`;
        const paths = [guide.feature_photo_url, guide.nearby_photo_url]
          .filter((url) => (url || "").includes(marker))
          .map((url) => decodeURIComponent(url.slice(url.indexOf(marker) + marker.length).split(/[?#]/)[0]))
          .filter((path) => path.includes("/guides/"));
        if (!paths.length) continue;
        const { error } = await db.storage.from(bucket).remove(paths);
        if (error) console.warn("NavAble: guide photos were not removed.", error);
      }
    }

    // Straight-line distance in meters between two map points.
    function metersBetween(lat1, lon1, lat2, lon2) {
      const rad = (degrees) => degrees * Math.PI / 180;
      const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
        + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
      return 6371000 * 2 * Math.asin(Math.sqrt(a));
    }

    function guidePhotoProblem(file, label) {
      if (!file) return `Choose the ${label}.`;
      if (!TYPES[file.type]) return `The ${label} must be a JPG, PNG, or WebP image.`;
      if (file.size > MAX_BYTES) return `The ${label} must be 5 MB or smaller.`;
      return null;
    }

    async function openAddGuide(trigger) {
      let features;
      try {
        features = await K.rows(db.from("accessibility_features")
          .select("feature_id, feature_name")
          .eq("status", "Active")
          .order("feature_name"));
      } catch (error) {
        K.toast(`The features could not load. ${K.friendlyError(error)}`, { assertive: true });
        return;
      }
      const photoField = (label, name) => el("div", { className: "nv-field" },
        el("label", { for: `guide-${name}` }, label, el("span", { className: "nv-req", "aria-hidden": "true", text: " *" })),
        el("input", { id: `guide-${name}`, name, type: "file", accept: Object.keys(TYPES).join(","), required: true, className: "nv-input" }));

      K.openDialog({
        title: "Add a route guide",
        description: `Approved right away for ${location.location_name}.`,
        returnFocus: trigger,
        submitLabel: "Add guide",
        submitIcon: "add_location_alt",
        wide: true,
        content: el("div", { style: "display:grid;gap:12px" },
          K.field({ label: "Feature", name: "feature", type: "select", required: true, options: features.map((feature) => [feature.feature_id, feature.feature_name]) }),
          K.field({ label: "Where to find it", name: "where", required: true, maxLength: 200, placeholder: "Right side of the main entrance" }),
          K.field({ label: "Floor", name: "floor", maxLength: 40, placeholder: "Ground floor" }),
          K.field({ label: "Nearby sign or landmark", name: "landmark", maxLength: 120, placeholder: "Beside the blue sign" }),
          photoField("Photo of the feature", "featurePhoto"),
          photoField("Photo of what's nearby", "nearbyPhoto"),
          K.field({ label: "Pin latitude", name: "latitude", type: "number", step: "any", min: -90, max: 90, hint: "Optional. Enter both latitude and longitude for outdoor spots, within 500 m of this place." }),
          K.field({ label: "Pin longitude", name: "longitude", type: "number", step: "any", min: -180, max: 180 })),
        onSubmit: (form, { showError }) => saveGuide(form, showError)
      });
    }

    async function saveGuide(form, showError) {
      const where = K.formText(form, "where");
      const latitudeText = K.formText(form, "latitude");
      const longitudeText = K.formText(form, "longitude");
      const featureFile = form.elements.featurePhoto.files[0];
      const nearbyFile = form.elements.nearbyPhoto.files[0];
      const problem = !where ? "Tell people where to find it."
        : guidePhotoProblem(featureFile, "photo of the feature")
          || guidePhotoProblem(nearbyFile, "photo of what's nearby")
          || (Boolean(latitudeText) !== Boolean(longitudeText) ? "Enter both the pin latitude and longitude, or neither." : null);
      if (problem) {
        showError(problem);
        return false;
      }
      const latitude = latitudeText ? Number(latitudeText) : null;
      const longitude = longitudeText ? Number(longitudeText) : null;
      if (latitude !== null && metersBetween(location.latitude, location.longitude, latitude, longitude) > 500) {
        showError("Pin a spot within 500 m of this place.");
        return false;
      }

      const folder = `${location.location_id}/guides/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const paths = [];
      const upload = async (file, name) => {
        const path = `${folder}/${name}.${TYPES[file.type]}`;
        const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        paths.push(path);
        return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      };
      const me = window.NavAbleStaff.user_id;
      try {
        const featureUrl = await upload(featureFile, "feature");
        const nearbyUrl = await upload(nearbyFile, "nearby");
        const { error } = await db.from("feature_guides").insert({
          location_id: location.location_id,
          feature_id: form.elements.feature.value,
          user_id: me,
          where_text: where,
          floor: K.formText(form, "floor"),
          landmark: K.formText(form, "landmark"),
          latitude,
          longitude,
          feature_photo_url: featureUrl,
          nearby_photo_url: nearbyUrl,
          status: "Approved",
          reviewed_by: me,
          reviewed_at: K.nowIso()
        });
        if (error) throw error;
      } catch (error) {
        // Don't leave orphaned files behind if the guide wasn't saved.
        if (paths.length) await db.storage.from(BUCKET).remove(paths);
        showError(`The guide was not added. ${K.friendlyError(error)}`);
        return false;
      }
      K.toast(`Route guide added to ${location.location_name}.`);
      await Promise.all([loadGuides(), loadFeatures()]);
      changed();
      return true;
    }

    loadPhotos();
    loadFeatures();
    loadGuides();

    return el("div", { className: "nv-location-details" },
      el("h3", { className: "nv-subhead", text: "Photos" }),
      photosPanel,
      el("h3", { className: "nv-subhead", text: "Accessibility features" }),
      featuresPanel,
      el("h3", { className: "nv-subhead", text: "Route guides" }),
      guidesPanel);
  }

  window.NavAbleLocationDetails = Object.freeze({ section });
})();
