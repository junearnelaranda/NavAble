// Admin alert center on the header bell: recent activity that needs an admin
// (new reports, bug reports, places to verify, reviews to moderate), a badge
// with how many arrived since this admin last opened it, and a toast when
// something new comes in while a page is open. Load after admin.js.
// "Last opened" is remembered per admin in this browser.
(() => {
  "use strict";

  const POLL_MS = 45_000;
  const LIMIT = 8;
  const SHOWN = 12;
  const FIRST_VISIT_WINDOW_MS = 3 * 86400000;

  let button;
  let badge;
  let panel;
  let list;
  let staff;
  let items = [];
  let known = null; // keys from the previous load; null until the first load
  let failed = 0;
  let loading = false;
  let timer;

  const db = () => window.NavAbleDB?.client;
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ago = (iso) => {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60]]) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return "just now";
  };

  const seenKey = () => `navableAlertsSeenAt:${staff?.user_id || "admin"}`;
  function seenAt() {
    try {
      const value = Number(localStorage.getItem(seenKey()));
      if (value) return value;
    } catch (_) {}
    return Date.now() - FIRST_VISIT_WINDOW_MS;
  }
  function markSeen() {
    try { localStorage.setItem(seenKey(), String(Date.now())); } catch (_) {}
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    });
    children.flat().forEach((child) => {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    });
    return node;
  }
  const icon = (name) => el("span", { className: "material-symbols-outlined", "aria-hidden": "true", text: name });

  // ---------- data ----------

  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const q = (text) => encodeURIComponent(text || "");

  async function fetchItems() {
    const client = db();
    const me = staff.user_id;
    const sources = [
      client.from("reports").select("report_id, report_type, created_at, locations(location_name)").order("created_at", { ascending: false }).limit(LIMIT)
        .then(({ data, error }) => { if (error) throw error; return (data || []).map((r) => ({
          key: `report:${r.report_id}`, time: r.created_at, icon: "report", tone: "danger",
          title: `New report: ${r.report_type}`, detail: one(r.locations)?.location_name || "Unknown location",
          href: `reports.html?status=&search=${q(one(r.locations)?.location_name)}`
        })); }),
      client.from("bug_reports").select("bug_id, title, created_at").order("created_at", { ascending: false }).limit(LIMIT)
        .then(({ data, error }) => { if (error) throw error; return (data || []).map((b) => ({
          key: `bug:${b.bug_id}`, time: b.created_at, icon: "bug_report", tone: "danger",
          title: "New bug report", detail: b.title, href: `bugs.html?status=&search=${q(b.title)}`
        })); }),
      // Places waiting for verification, except ones this admin added.
      client.from("locations").select("location_id, location_name, created_at").eq("verification_status", "Pending")
        .or(`created_by.is.null,created_by.neq.${me}`).order("created_at", { ascending: false }).limit(LIMIT)
        .then(({ data, error }) => { if (error) throw error; return (data || []).map((l) => ({
          key: `place:${l.location_id}`, time: l.created_at, icon: "add_location_alt", tone: "warning",
          title: "New place to verify", detail: l.location_name, href: `location.html?status=Pending&search=${q(l.location_name)}`
        })); }),
      client.from("reviews").select("review_id, rating, review_date, locations(location_name)").eq("review_status", "Pending Review").order("review_date", { ascending: false }).limit(LIMIT)
        .then(({ data, error }) => { if (error) throw error; return (data || []).map((r) => ({
          key: `review:${r.review_id}`, time: r.review_date, icon: "rate_review", tone: "warning",
          title: "Review waiting for moderation", detail: `${r.rating}-star review of ${one(r.locations)?.location_name || "a place"}`,
          href: "ratings.html?status=Pending%20Review"
        })); })
    ];
    const settled = await Promise.allSettled(sources);
    failed = settled.filter((s) => s.status === "rejected").length;
    settled.filter((s) => s.status === "rejected").forEach((s) => console.warn("NavAble alerts: a source failed to load.", s.reason));
    if (failed === settled.length) throw settled[0].reason;
    return settled.filter((s) => s.status === "fulfilled").flatMap((s) => s.value)
      .filter((item) => item.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, SHOWN);
  }

  async function refresh() {
    if (loading || !db() || !staff) return;
    loading = true;
    try {
      const next = await fetchItems();
      const since = seenAt();
      if (known) {
        const arrived = next.filter((item) => !known.has(item.key) && new Date(item.time).getTime() > since);
        if (arrived.length === 1) window.NavAbleAdmin?.showToast(`${arrived[0].title} · ${arrived[0].detail}`);
        else if (arrived.length > 1) window.NavAbleAdmin?.showToast(`${arrived.length} new items need attention. Open the bell to see them.`);
      }
      items = next;
      known = new Set(next.map((item) => item.key));
      updateBadge();
      if (!panel.hidden) renderList();
    } catch (error) {
      console.warn("NavAble alerts: recent activity could not load.", error);
      items = [];
      failed = -1;
      updateBadge();
      if (!panel.hidden) renderList();
    } finally {
      loading = false;
    }
  }

  // ---------- UI ----------

  const unseenCount = () => {
    const since = seenAt();
    return items.filter((item) => new Date(item.time).getTime() > since).length;
  };

  function updateBadge() {
    const count = unseenCount();
    badge.hidden = count === 0;
    badge.textContent = count > 9 ? "9+" : String(count);
    button.setAttribute("aria-label", count ? `Notifications, ${count} new` : "Notifications");
    button.title = button.getAttribute("aria-label");
  }

  function renderList() {
    const since = Number(panel.dataset.since) || seenAt();
    if (failed === -1) {
      const retry = el("button", { type: "button", className: "nv-btn nv-btn-sm" }, icon("refresh"), "Try again");
      retry.addEventListener("click", refresh);
      list.replaceChildren(el("li", { className: "nv-alerts-empty" }, el("strong", { text: "Recent activity couldn't load." }), retry));
      return;
    }
    if (!items.length) {
      list.replaceChildren(el("li", { className: "nv-alerts-empty" }, el("strong", { text: "You're all caught up" }), el("span", { text: "New reports, bug reports, places, and reviews will show up here." })));
      return;
    }
    list.replaceChildren(...items.map((item) => {
      const isNew = new Date(item.time).getTime() > since;
      return el("li", {},
        el("a", { className: `nv-alert${isNew ? " is-new" : ""}`, href: item.href },
          el("span", { className: "nv-alert-icon", "data-tone": item.tone }, icon(item.icon)),
          el("span", { className: "nv-alert-text" },
            el("strong", { text: item.title }),
            el("span", { text: item.detail }),
            el("time", { datetime: item.time, text: ago(item.time) })),
          isNew ? el("span", { className: "nv-alert-dot", "aria-label": "New" }) : null));
    }), ...(failed > 0 ? [el("li", { className: "nv-alerts-note", text: "Some activity couldn't load. Refresh the page to try again." })] : []));
  }

  function openPanel() {
    panel.dataset.since = String(seenAt()); // keep "new" dots for this viewing
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    renderList();
    markSeen();
    updateBadge();
    (panel.querySelector("a, button") || panel).focus();
    refresh();
  }

  function closePanel(returnFocus = false) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
  }

  function build() {
    button = document.getElementById("adminAlertsButton");
    if (!button) return false;
    button.classList.add("nv-alerts-button");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "adminAlertsPanel");
    badge = el("span", { className: "nv-alerts-badge", "aria-hidden": "true", hidden: true });
    button.append(badge);

    list = el("ul", { className: "nv-alerts-list" });
    panel = el("div", { id: "adminAlertsPanel", className: "nv-alerts-panel", role: "region", "aria-label": "Recent activity", tabindex: "-1", hidden: true },
      el("div", { className: "nv-alerts-head" },
        el("strong", { text: "Recent activity" })),
      list,
      el("div", { className: "nv-alerts-foot" },
        el("a", { className: "nv-link", href: "notifications.html" }, "Send a notification to users", icon("arrow_forward"))));
    document.body.append(panel);

    button.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) closePanel(true);
    });
    document.addEventListener("click", (event) => {
      if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) closePanel();
    });
    return true;
  }

  function start(profile) {
    staff = profile;
    refresh();
    timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    // admin.js gives the bell its id during its own DOMContentLoaded handler.
    window.setTimeout(() => {
      if (!build()) return;
      window.NavAbleAlerts = Object.freeze({ refresh, open: openPanel });
      if (window.NavAbleStaff) start(window.NavAbleStaff);
      else document.addEventListener("navable:admin-ready", (event) => start(event.detail), { once: true });
    }, 0);
  });

  window.addEventListener("pagehide", () => window.clearInterval(timer));
})();
