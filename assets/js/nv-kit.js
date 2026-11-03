// Shared building blocks for the NavAble admin pages: DOM helpers, badges,
// Supabase query helpers, the page load cycle (loading, error banner, retry),
// dialogs, form fields, and pagination. Load after admin.js and before the
// page script. Pages read data only through window.NavAbleDB.client.
(() => {
  "use strict";

  const db = () => window.NavAbleDB?.client;

  // ---------- formatting ----------

  const number = new Intl.NumberFormat();
  const decimal = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const mediumDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  function relativeTime(value) {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const steps = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [unit, size] of steps) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return "just now";
  }

  const plural = (count, word, many = `${word}s`) => `${number.format(count)} ${count === 1 ? word : many}`;
  const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

  // ---------- DOM ----------

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? "" : value);
    });
    children.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  const icon = (name) => el("span", { className: "material-symbols-outlined", "aria-hidden": "true", text: name });

  function button(label, { iconName, tone, small, onClick, ariaLabel, type = "button", disabled } = {}) {
    const classes = ["nv-btn"];
    if (tone) classes.push(`nv-btn-${tone}`);
    if (small) classes.push("nv-btn-sm");
    return el("button", { className: classes.join(" "), type, "aria-label": ariaLabel, disabled, onClick },
      iconName ? icon(iconName) : null, label ? el("span", { text: label }) : null);
  }

  function timeEl(value) {
    if (!value) return el("span", { text: "—" });
    const date = new Date(value);
    return el("time", { datetime: date.toISOString(), title: fullDate.format(date), text: relativeTime(value) });
  }

  function stateBox(kind, title, message, action) {
    return el("div", { className: "nv-state", "data-kind": kind },
      el("strong", {}, icon(kind === "error" ? "error" : "inbox"), title),
      message ? el("span", { text: message }) : null,
      action || null);
  }

  const retryButton = (onRetry) => button("Try again", { iconName: "refresh", onClick: onRetry });

  function errorBox(title, error, onRetry) {
    return stateBox("error", title, friendlyError(error), onRetry ? retryButton(onRetry) : null);
  }

  function skeletonLines(count = 4) {
    return Array.from({ length: count }, (_, index) =>
      el("span", { className: `nv-skeleton is-line${index === count - 1 ? " is-short" : ""}` }));
  }

  // Skeleton row placeholders inside a table-shaped panel.
  const loadingPanel = (target, lines = 5) => target.replaceChildren(...skeletonLines(lines));

  function tableEl(caption, headers, bodyRows) {
    return el("div", { className: "nv-table-scroll" },
      el("table", { className: "nv-table" },
        el("caption", { className: "sr-only", text: caption }),
        el("thead", {}, el("tr", {}, headers.map(([label, className]) => el("th", { scope: "col", className, text: label })))),
        el("tbody", {}, bodyRows)));
  }

  function stars(rating) {
    const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return el("span", { className: "nv-stars", role: "img", "aria-label": `${value} out of 5 stars` },
      el("span", { "aria-hidden": "true", text: "★".repeat(value) }),
      el("span", { className: "nv-stars-off", "aria-hidden": "true", text: "★".repeat(5 - value) }));
  }

  function details(pairs) {
    return el("dl", { className: "nv-details" }, pairs.filter(Boolean).map(([term, value]) => [
      el("dt", { text: term }),
      el("dd", {}, value === null || value === undefined || value === "" ? el("span", { className: "nv-cell-sub", text: "Not provided" }) : value)
    ]));
  }

  // ---------- badges ----------

  const BADGES = {
    reportStatus: {
      Pending: ["warning", "schedule", "Pending"],
      Verified: ["info", "fact_check", "Verified"],
      Resolved: ["success", "check_circle", "Resolved"],
      Rejected: ["neutral", "block", "Rejected"]
    },
    priority: {
      High: ["danger", "priority_high", "High"],
      Medium: ["warning", "drag_handle", "Medium"],
      Low: ["neutral", "south", "Low"]
    },
    locationStatus: {
      Pending: ["warning", "schedule", "Pending"],
      Verified: ["success", "verified", "Verified"],
      Rejected: ["neutral", "block", "Rejected"]
    },
    reviewStatus: {
      Published: ["success", "public", "Published"],
      "Pending Review": ["warning", "rate_review", "Pending review"],
      Hidden: ["neutral", "visibility_off", "Hidden"]
    },
    accountStatus: {
      Active: ["success", "check_circle", "Active"],
      Inactive: ["neutral", "pause_circle", "Inactive"],
      Suspended: ["danger", "block", "Suspended"]
    },
    role: {
      Admin: ["info", "shield_person", "Admin"],
      User: ["neutral", "person", "User"]
    },
    aiStatus: {
      Detected: ["success", "check_circle", "Detected"],
      "Not Detected": ["neutral", "cancel", "Not detected"],
      "Needs Verification": ["warning", "help", "Needs verification"]
    },
    featureStatus: {
      Active: ["success", "check_circle", "Active"],
      Inactive: ["neutral", "pause_circle", "Inactive"]
    },
    notificationType: {
      "Report Update": ["info", "description", "Report update"],
      Verification: ["success", "verified", "Verification"],
      "Accessibility Update": ["warning", "accessible", "Accessibility update"],
      "System Announcement": ["neutral", "campaign", "System announcement"]
    },
    bugStatus: {
      New: ["danger", "bug_report", "New"],
      "In Progress": ["warning", "build", "In progress"],
      Fixed: ["success", "task_alt", "Fixed"],
      "Won't Fix": ["neutral", "do_not_disturb_on", "Won't fix"],
      Duplicate: ["neutral", "content_copy", "Duplicate"]
    },
    verificationStatus: {
      Pending: ["warning", "schedule", "Pending"],
      Approved: ["success", "check_circle", "Approved"],
      Rejected: ["neutral", "block", "Rejected"]
    }
  };

  function badge(map, value) {
    const [tone, iconName, label] = (typeof map === "string" ? BADGES[map] : map)?.[value] || ["neutral", "help", value || "Unknown"];
    return el("span", { className: "nv-badge", "data-tone": tone }, icon(iconName), label);
  }

  // Contribution points: one award per report or review, in fixed tiers.
  // The amount is stored with each award, so changing these numbers later
  // only affects new awards.
  const POINT_TIERS = [
    { tier: "Small", points: 5 },
    { tier: "Regular", points: 10 },
    { tier: "Big", points: 25 }
  ];

  const REPORT_TYPES = ["Broken Ramp", "Broken Elevator", "Blocked Entrance", "Construction", "Others"];
  const REPORT_TYPE_ICONS = {
    "Broken Ramp": "accessible",
    "Broken Elevator": "elevator",
    "Blocked Entrance": "door_front",
    Construction: "construction",
    Others: "help"
  };

  // ---------- queries ----------

  async function count(table, filter) {
    let query = db().from(table).select("*", { count: "exact", head: true });
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
  // rows are fetched page by page. makeQuery must return a fresh, ordered query.
  const PAGE_SIZE = 1000;
  async function allRows(makeQuery) {
    const out = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = await rows(makeQuery().range(from, from + PAGE_SIZE - 1));
      out.push(...page);
      if (page.length < PAGE_SIZE) return out;
    }
  }

  // One page of a list. The query must be built with select(..., { count: "exact" }).
  async function pageOf(query, page, size) {
    const from = page * size;
    const { data, count: total, error } = await query.range(from, from + size - 1);
    if (error) {
      // Asking for a page past the end (for example after a filter change).
      if (error.code === "PGRST103") return { rows: [], total: null, outOfRange: true };
      throw error;
    }
    return { rows: data || [], total: total ?? 0, outOfRange: false };
  }

  // Search text for ilike filters. Characters with meaning in PostgREST filter
  // syntax are dropped so typed text can't change the query.
  function searchPattern(value) {
    const term = String(value || "").replace(/[%,()*\\"':]/g, " ").replace(/\s+/g, " ").trim();
    return term ? `%${term}%` : "";
  }

  const one = (value) => (Array.isArray(value) ? value[0] : value);

  function personName(user) {
    if (!user) return "Unknown user";
    const profile = one(user.user_profiles);
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
    return name || user.email || "Unknown user";
  }

  function friendlyError(error) {
    if (!error) return "Unknown error.";
    const code = error.code;
    if (code === "23505") return "A matching record already exists.";
    if (code === "23514") return "The database did not accept one of the values.";
    if (code === "23503") return "A linked record is missing or still in use.";
    if (code === "42501") return "This account does not have permission for that change.";
    if (error.name === "TypeError" || /failed to fetch|network/i.test(error.message || "")) return "Could not reach the database. Check your connection and try again.";
    return error.message || "Unknown error.";
  }

  const ok = (result) => (result?.status === "fulfilled" ? result.value : undefined);

  // Runs an insert/update/delete that ends in .select(...). Shows a toast for
  // the outcome and returns the changed rows, or null on failure. An update
  // that matches no rows (removed meanwhile, or blocked by row-level security)
  // counts as a failure instead of a silent success.
  async function mutate(run, { success, failure, onError, expectRows = true } = {}) {
    try {
      const { data, error } = await run();
      if (error) throw error;
      if (expectRows && Array.isArray(data) && data.length === 0) {
        throw new Error("No record was changed. It may have been removed, or this account cannot edit it.");
      }
      if (success) toast(success);
      return data ?? [];
    } catch (error) {
      console.error("NavAble: database change failed.", error);
      const message = `${failure || "The change was not saved."} ${friendlyError(error)}`;
      toast(message, { assertive: true, duration: 6000 });
      onError?.(message);
      return null;
    }
  }

  const toast = (message, options) => window.NavAbleAdmin?.showToast(message, options);
  const nowIso = () => new Date().toISOString();
  const param = (name) => new URLSearchParams(window.location.search).get(name);

  function whenAdminReady(callback) {
    if (window.NavAbleStaff) callback(window.NavAbleStaff);
    else document.addEventListener("navable:admin-ready", (event) => callback(event.detail), { once: true });
  }

  // ---------- stat tiles ----------

  function setStat(metric, { value, meta, textValue = false, error = false }) {
    const card = document.querySelector(`main [data-metric="${metric}"]`);
    if (!card) return;
    const valueNode = card.querySelector("[data-value]");
    const metaNode = card.querySelector("[data-meta]");
    valueNode.classList.toggle("is-text", textValue || error);
    valueNode.replaceChildren(error ? "Unavailable" : value);
    metaNode.replaceChildren(...(error ? [icon("error"), " Could not load"] : [meta ?? ""]));
    metaNode.style.color = error ? "var(--admin-danger)" : "";
  }

  // ---------- page load cycle ----------
  // Expects #pageUpdated, #pageRefresh, #pageBanner (with #pageBannerText and
  // [data-retry]) in the page. run() loads and renders everything and returns
  // the Promise.allSettled results so failures can be reported.

  function createPage({ name, run, autoRefreshMs = 60_000 }) {
    const main = document.getElementById("main-content");
    const updated = document.getElementById("pageUpdated");
    const refresh = document.getElementById("pageRefresh");
    const banner = document.getElementById("pageBanner");
    const bannerText = document.getElementById("pageBannerText");
    let loading = false;
    let queued = false;
    let lastLoadedAt = 0;

    function setLoading(isLoading) {
      loading = isLoading;
      main?.setAttribute("aria-busy", String(isLoading));
      if (refresh) {
        refresh.disabled = isLoading;
        refresh.querySelector("span:last-child").textContent = !isLoading ? "Refresh" : lastLoadedAt ? "Refreshing…" : "Loading…";
      }
    }

    async function load({ announce = false } = {}) {
      if (!db()) return;
      if (loading) {
        queued = true;
        return;
      }
      setLoading(true);
      if (lastLoadedAt && updated) updated.textContent = "Refreshing…";

      let settled;
      try {
        settled = await run();
      } catch (error) {
        settled = [{ status: "rejected", reason: error }];
      }

      const failures = settled.filter((item) => item.status === "rejected");
      if (failures.length) {
        const reason = friendlyError(failures[0].reason);
        bannerText.textContent = failures.length === settled.length
          ? `${name} could not be loaded from the database. ${reason}`
          : `Some ${name.toLowerCase()} data could not be loaded (${failures.length} of ${settled.length} requests failed). ${reason}`;
        banner.hidden = false;
        failures.forEach((item) => console.error(`NavAble ${name} query failed.`, item.reason));
      } else {
        banner.hidden = true;
      }

      lastLoadedAt = Date.now();
      if (updated) updated.textContent = failures.length === settled.length ? "Not loaded" : `Updated ${clock.format(new Date(lastLoadedAt))}`;
      setLoading(false);

      if (announce) toast(failures.length ? `${name} refreshed with some data missing.` : `${name} refreshed.`, { assertive: Boolean(failures.length) });
      if (queued) {
        queued = false;
        load();
      }
    }

    refresh?.addEventListener("click", () => load({ announce: true }));
    banner?.querySelector("[data-retry]")?.addEventListener("click", () => load({ announce: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && lastLoadedAt && Date.now() - lastLoadedAt > autoRefreshMs) load();
    });

    if (!db()) {
      bannerText.textContent = "The database connection is unavailable, so nothing can be shown.";
      banner.hidden = false;
      if (updated) updated.textContent = "Not loaded";
    } else {
      whenAdminReady(() => load());
    }

    return { load, get lastLoadedAt() { return lastLoadedAt; } };
  }

  // ---------- pagination ----------

  function pager({ page, size, total, onChange, noun = "records" }) {
    const start = total ? page * size + 1 : 0;
    const end = Math.min(total, (page + 1) * size);
    if (total <= size) {
      return el("p", { className: "nv-pager nv-cell-sub", text: `Showing ${plural(total, noun.replace(/s$/, ""), noun)}` });
    }
    return el("nav", { className: "nv-pager", "aria-label": `Pages of ${noun}` },
      el("p", { className: "nv-cell-sub", text: `Showing ${number.format(start)}–${number.format(end)} of ${number.format(total)} ${noun}` }),
      el("div", { className: "nv-pager-buttons" },
        button("Previous", { iconName: "chevron_left", small: true, disabled: page === 0, onClick: () => onChange(page - 1) }),
        button("Next", { iconName: "chevron_right", small: true, disabled: end >= total, onClick: () => onChange(page + 1) })));
  }

  // ---------- forms and dialogs ----------

  let uidCounter = 0;
  const uid = (prefix) => `${prefix}-${++uidCounter}`;

  function field({ label, name, type = "text", value = "", options = [], required, maxLength, hint, rows = 4, min, max, step, disabled, placeholder, autocomplete, checked, inputMode }) {
    const id = uid("nv-field");
    const hintId = hint ? `${id}-hint` : null;
    const hintNode = hint ? el("p", { id: hintId, className: "nv-hint", text: hint }) : null;
    let control;

    if (type === "checkbox") {
      control = el("input", { id, name, type: "checkbox", className: "nv-checkbox", checked, disabled, "aria-describedby": hintId });
      return el("div", { className: "nv-field is-check" }, control, el("label", { for: id, text: label }), hintNode);
    }
    if (type === "select") {
      control = el("select", { id, name, className: "nv-select", required, disabled, "aria-describedby": hintId },
        options.map(([optionValue, text]) => el("option", { value: optionValue, selected: String(optionValue) === String(value ?? "") }, text)));
    } else if (type === "textarea") {
      control = el("textarea", { id, name, className: "nv-textarea", rows, required, maxlength: maxLength, disabled, placeholder, "aria-describedby": hintId });
      control.value = value ?? "";
    } else {
      control = el("input", { id, name, type, className: "nv-input", required, maxlength: maxLength, min, max, step, disabled, placeholder, autocomplete, inputmode: inputMode, "aria-describedby": hintId });
      control.value = value ?? "";
    }
    return el("div", { className: "nv-field" },
      el("label", { for: id }, label, required ? el("span", { className: "nv-req", "aria-hidden": "true", text: " *" }) : null),
      control, hintNode);
  }

  // Trimmed text value of a form control; empty strings become null.
  function formText(form, name) {
    const value = form.elements[name]?.value?.trim();
    return value ? value : null;
  }

  // Modal dialog built on <dialog>. onSubmit(form, { showError }) returns
  // false to keep the dialog open (for example when saving failed).
  function openDialog({ title, description, content, submitLabel = "Save changes", submitIcon = "save", danger = false, wide = false, onSubmit, returnFocus }) {
    const opener = returnFocus || document.activeElement;
    const titleId = uid("nv-dialog-title");
    const errorNode = el("p", { className: "nv-form-error", role: "alert", hidden: true });
    const dialog = el("dialog", { className: `nv-dialog${wide ? " is-wide" : ""}`, "aria-labelledby": titleId });
    const form = el("form", { className: "nv-dialog-form" });
    const closeDialog = () => dialog.close();
    const submit = onSubmit
      ? button(submitLabel, { iconName: submitIcon, tone: danger ? "danger" : "primary", type: "submit" })
      : null;

    form.append(
      el("div", { className: "nv-dialog-head" },
        el("div", {}, el("h2", { id: titleId, text: title }), description ? el("p", { text: description }) : null),
        el("button", { className: "nv-icon-btn", type: "button", "aria-label": "Close dialog", onClick: closeDialog }, icon("close"))),
      el("div", { className: "nv-dialog-body" }, content, errorNode),
      el("div", { className: "nv-dialog-foot" }, button(onSubmit ? "Cancel" : "Close", { onClick: closeDialog }), submit));
    dialog.append(form);
    document.body.append(dialog);

    dialog.addEventListener("close", () => {
      dialog.remove();
      if (opener?.isConnected) opener.focus();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!onSubmit) {
        closeDialog();
        return;
      }
      errorNode.hidden = true;
      submit.disabled = true;
      const showError = (message) => {
        errorNode.textContent = message;
        errorNode.hidden = false;
      };
      try {
        const keepOpen = (await onSubmit(form, { showError })) === false;
        if (!keepOpen) closeDialog();
      } catch (error) {
        console.error("NavAble: dialog action failed.", error);
        showError(friendlyError(error));
      } finally {
        if (dialog.open) submit.disabled = false;
      }
    });

    dialog.showModal();
    return { dialog, form, close: closeDialog };
  }

  // Award buttons for one contribution (source "Report" or "Review"). Shows the
  // tier buttons, or the existing award with Undo. The database credits the
  // contribution's author and records the awarding admin.
  function pointsControl({ source, sourceId, award, eligible = true, ineligibleHint, label, onChange }) {
    const group = el("div", { className: "nv-points", role: "group", "aria-label": `Points for ${label}` });
    const refresh = async () => { await onChange?.(); };

    if (award) {
      group.append(
        el("span", { className: "nv-badge", "data-tone": "success" }, icon("stars"), `+${award.points} points · ${award.tier}`),
        button("Undo", {
          iconName: "undo", small: true, ariaLabel: `Remove the ${award.points} points awarded for ${label}`,
          onClick: (event) => withBusy(event.currentTarget, async () => {
            if (!window.NavAbleAdmin.confirmAction(`Remove the ${award.points} points awarded for ${label}?`)) return;
            const removed = await mutate(() => db().from("contribution_points").delete().eq("point_id", award.point_id).select("point_id"), {
              success: `${award.points} points removed.`,
              failure: "The points were not removed."
            });
            if (removed) await refresh();
          })
        }));
      return group;
    }

    group.append(el("span", { className: "nv-points-label", text: "Award points" }));
    POINT_TIERS.forEach(({ tier, points }) => group.append(button(`${tier} +${points}`, {
      iconName: tier === "Big" ? "stars" : "star", small: true, disabled: !eligible,
      ariaLabel: `Award ${tier.toLowerCase()} points (${points}) for ${label}`,
      onClick: (event) => withBusy(event.currentTarget, async () => {
        const values = { points, tier, source_type: source, [source === "Report" ? "report_id" : "review_id"]: sourceId };
        await mutate(() => db().from("contribution_points").insert(values).select("point_id"), {
          success: `${points} points awarded for ${label}.`,
          failure: "The points were not awarded."
        });
        // Refresh either way: a failed award may mean another admin already awarded it.
        await refresh();
      })
    })));
    if (!eligible && ineligibleHint) group.append(el("span", { className: "nv-cell-sub", text: ineligibleHint }));
    return group;
  }

  // After a list re-renders, the control that had focus may be gone. Move focus
  // to the nearest [data-focus-fallback] heading so keyboard users keep their place.
  let lastFocused = null;
  document.addEventListener("focusin", (event) => { lastFocused = event.target; });

  function settleFocus(scope) {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    // Only step in when focus was lost because its element was removed,
    // not on first load when nothing has been focused yet.
    if (!lastFocused || lastFocused.isConnected) return;
    if (document.querySelector("dialog[open]")) return;
    const target = scope?.closest(".nv-card")?.querySelector("[data-focus-fallback]") || document.querySelector("main [data-focus-fallback]");
    target?.focus({ preventScroll: true });
  }

  // Disables a button while its async task runs (prevents double submits).
  async function withBusy(target, task) {
    if (!target || target.disabled) return target ? undefined : task();
    target.disabled = true;
    target.setAttribute("aria-busy", "true");
    try {
      return await task();
    } finally {
      target.disabled = false;
      target.removeAttribute("aria-busy");
    }
  }

  // Keeps a loader from rendering stale results when a newer request started.
  function latestOnly() {
    let token = 0;
    return () => {
      const mine = ++token;
      return () => mine === token;
    };
  }

  function debounce(callback, wait = 300) {
    let timer;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), wait);
    };
  }

  // Wires a filter <form>: selects apply at once, search boxes after a short
  // pause, and the reset button restores the HTML defaults. initial values
  // (for example from the URL) are applied only when they are valid options.
  function bindFilters(form, { initial = {}, onChange }) {
    const values = {};
    const read = () => {
      [...form.elements].forEach((control) => {
        if (control.name) values[control.name] = control.value.trim();
      });
      return { ...values };
    };
    Object.entries(initial).forEach(([name, value]) => {
      const control = form.elements[name];
      if (!control || value === null || value === undefined) return;
      if (control.tagName === "SELECT" && ![...control.options].some((option) => option.value === value)) return;
      control.value = value;
    });
    read();
    const fire = () => onChange(read());
    const fireSoon = debounce(fire, 300);
    form.addEventListener("input", (event) => {
      if (event.target.matches('input[type="search"], input[type="text"]')) fireSoon();
    });
    form.addEventListener("change", (event) => {
      if (event.target.matches("select")) fire();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      fire();
    });
    form.addEventListener("reset", () => window.setTimeout(fire, 0));
    return { values: () => ({ ...values }) };
  }

  function downloadCsv(filename, rowsOut) {
    window.NavAbleAdmin?.downloadCsv(filename, rowsOut);
  }

  const today = () => new Date().toISOString().slice(0, 10);

  window.NavAbleKit = Object.freeze({
    db, el, icon, button, timeEl, stateBox, errorBox, retryButton, skeletonLines, loadingPanel, tableEl, stars, details,
    BADGES, badge, REPORT_TYPES, REPORT_TYPE_ICONS, POINT_TIERS, pointsControl,
    count, rows, allRows, pageOf, searchPattern, one, personName, friendlyError, ok, mutate,
    toast, nowIso, param, whenAdminReady, setStat, createPage, pager, field, formText, openDialog,
    latestOnly, debounce, bindFilters, withBusy, settleFocus, downloadCsv, today, plural, percent,
    format: { number, decimal, shortDate, mediumDate, fullDate, clock, relativeTime }
  });
})();
