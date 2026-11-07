// "Import from Google" on the admin Locations page: search Google places (via
// the places-search Edge Function), tick the ones to add, and save them as
// Pending NavAble locations linked by google_place_id. Admins then review each
// one in the location dialog (photos, features, rating, Verified status).
// Places already linked to a NavAble location are shown but can't be added twice.
(() => {
  "use strict";

  // Cebu City: where Google results are centred.
  const SEARCH_CENTER = { latitude: 10.3157, longitude: 123.8854 };
  const GOOGLE_ACCESS = {
    wheelchairEntrance: "Wheelchair entrance",
    wheelchairRestroom: "Wheelchair restroom",
    wheelchairParking: "Wheelchair parking",
    wheelchairSeating: "Wheelchair seating"
  };

  function open(trigger) {
    const K = window.NavAbleKit;
    const { el } = K;
    const db = K.db();
    let places = [];
    let linked = new Map();

    const query = el("input", { className: "nv-input", type: "search", placeholder: "For example: cafe near Ayala Center Cebu", "aria-label": "Search Google places", autocomplete: "off" });
    const status = el("p", { className: "nv-hint", role: "status" });
    const results = el("div", {});
    const searchButton = K.button("Search Google", { iconName: "travel_explore", onClick: () => K.withBusy(searchButton, search) });
    query.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault(); // Enter searches instead of submitting the import.
      searchButton.click();
    });

    const statusField = K.field({
      label: "Add them as", name: "verification_status", type: "select", value: "Pending",
      options: [["Pending", "Pending (review before the app shows them)"], ["Verified", "Verified (show in the app now)"]]
    });

    async function search() {
      const text = query.value.trim();
      if (!text) {
        status.textContent = "Type a place name or a search like “cafe near Ayala Center Cebu”.";
        query.focus();
        return;
      }
      status.textContent = "Searching Google…";
      results.replaceChildren(...K.skeletonLines(3));
      const { data, error } = await db.functions.invoke("places-search", { body: { query: text, ...SEARCH_CENTER } });
      if (error) {
        const notSetUp = error.context?.status === 503;
        const overLimit = error.context?.status === 429;
        results.replaceChildren();
        status.textContent = notSetUp
          ? "Google search isn't set up: add GOOGLE_PLACES_API_KEY in Supabase Edge Function secrets."
          : overLimit
            ? "Google search has reached today's limit, which keeps the Google bill in check. Try again tomorrow."
            : `Google search failed. ${K.friendlyError(error)}`;
        return;
      }
      places = (Array.isArray(data?.places) ? data.places : [])
        .filter((p) => p.id && p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

      // Which of these Google places are already NavAble locations?
      linked = new Map();
      if (places.length) {
        const { data: existing, error: lookupError } = await db.from("locations")
          .select("location_id, location_name, google_place_id")
          .in("google_place_id", places.map((p) => p.id));
        if (lookupError) {
          results.replaceChildren(K.errorBox("Couldn't check which places are already added", lookupError));
          status.textContent = "";
          return;
        }
        (existing || []).forEach((row) => linked.set(row.google_place_id, row));
      }
      render();
    }

    function render() {
      if (!places.length) {
        status.textContent = "";
        results.replaceChildren(K.stateBox("empty", "No Google places found", "Try another name, or add the area, like “near IT Park”."));
        return;
      }
      const fresh = places.filter((p) => !linked.has(p.id)).length;
      status.textContent = `${K.plural(places.length, "place")} found${fresh < places.length ? `, ${places.length - fresh} already in NavAble` : ""}.`;
      results.replaceChildren(el("ul", { className: "nv-list", "aria-label": "Google search results" }, places.map((place) => {
        const already = linked.get(place.id);
        const id = `nv-import-${place.id}`;
        const access = Object.entries(GOOGLE_ACCESS)
          .filter(([key]) => place.accessibility?.[key] === true)
          .map(([, label]) => label);
        return el("li", { className: "nv-item", style: "grid-template-columns:auto 1fr;align-items:start" },
          el("input", { type: "checkbox", className: "nv-checkbox", id, "data-place": place.id, disabled: Boolean(already), style: "margin-top:2px" }),
          el("label", { for: id, style: "display:grid;gap:4px;cursor:pointer" },
            el("span", { className: "nv-cell-main", text: place.name }),
            el("span", { className: "nv-cell-sub", text: place.address }),
            el("span", { className: "nv-item-meta" },
              place.type ? el("span", { className: "nv-badge", "data-tone": "neutral" }, place.type) : null,
              already ? el("span", { className: "nv-badge", "data-tone": "success" }, K.icon("check"), "Already in NavAble") : null,
              access.length ? el("span", { text: `Google lists: ${access.join(", ")}` }) : null)));
      })));
    }

    K.openDialog({
      title: "Import places from Google",
      description: "Search Google, tick the places to add, and they'll appear in your Locations list to review and edit.",
      wide: true,
      returnFocus: trigger,
      submitLabel: "Add selected places",
      submitIcon: "add_location_alt",
      content: [
        el("div", { className: "nv-field" },
          el("label", { text: "Search Google places" }),
          el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, el("div", { style: "flex:1 1 260px" }, query), searchButton),
          status),
        el("div", { style: "margin-top:12px" }, results),
        el("div", { className: "nv-form-grid", style: "margin-top:16px" }, statusField),
        el("p", { className: "nv-hint", style: "margin-top:8px", text: "Each place is linked to Google by its place ID. Name, address, and map position are filled in from Google; check them when you review each place." })
      ],
      onSubmit: async (form, { showError }) => {
        const picked = [...form.querySelectorAll("input[data-place]:checked")].map((box) => places.find((p) => p.id === box.dataset.place)).filter(Boolean);
        if (!picked.length) {
          showError("Tick at least one place to add, or close this window.");
          return false;
        }
        const verification = form.elements.verification_status.value;
        const rows = picked.map((place) => ({
          location_name: place.name.slice(0, 150),
          address: (place.address || place.shortAddress || place.name).slice(0, 255),
          latitude: place.latitude,
          longitude: place.longitude,
          category: (place.type || "Other").slice(0, 100),
          google_place_id: place.id,
          verification_status: verification
        }));
        const saved = await K.mutate(() => db.from("locations").insert(rows).select("location_id"), {
          success: `${K.plural(rows.length, "place")} added as ${verification}. Open each one to add photos, features, and a rating.`,
          failure: "The places were not added.",
          onError: (message) => showError(message.includes("matching record already exists")
            ? "One of these places was just added by someone else. Search again to refresh the list."
            : message)
        });
        if (!saved) return false;
        document.dispatchEvent(new CustomEvent("navable:data-changed"));
        return true;
      }
    });
    query.focus();
  }

  window.NavAbleLocationImport = Object.freeze({ open });

  // The Locations page has an "Import from Google" button (#locationImport).
  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("locationImport");
    button?.addEventListener("click", () => open(button));
  });
})();
