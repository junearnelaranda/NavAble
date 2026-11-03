// Bug Reports: problems people report with NavAble itself (table `bug_reports`),
// separate from accessibility reports about places. Anyone can submit one (the
// website form, the app); admins triage them here: status, priority, notes.
// The database records the handling admin and when a bug was closed.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("bugsDownload");
  const form = document.getElementById("bugFilters");

  const PAGE_SIZE = 20;
  const OPEN = ["New", "In Progress"];
  const STATUSES = ["New", "In Progress", "Fixed", "Won't Fix", "Duplicate"];
  const CLOSED = ["Fixed", "Won't Fix", "Duplicate"];
  const PRIORITIES = ["High", "Medium", "Low"];
  const SOURCE_LABELS = { App: "NavAble app", Website: "Website", Admin: "Admin site" };
  // bug_reports links to users twice, so each embed names its foreign key.
  const PERSON = "email, user_profiles(first_name, last_name)";
  const REPORTER = `reporter:users!bug_reports_user_id_fkey(${PERSON})`;
  const HANDLER = `handler:users!bug_reports_handled_by_fkey(${PERSON})`;
  const LIST_COLUMNS = `bug_id, title, description, area, source, status, priority, reporter_name, reporter_email, created_at, ${REPORTER}`;

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.status === "open") query = query.in("status", OPEN);
    else if (filters.status) query = query.eq("status", filters.status);
    if (filters.area) query = query.eq("area", filters.area);
    if (filters.source) query = query.eq("source", filters.source);
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("title", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("bug_reports").select(columns, options))
    .order("created_at", { ascending: false })
    .order("bug_id");

  const filtersActive = () => Boolean(filters.search || filters.area || filters.source || filters.status !== "open");

  function reporterText(bug) {
    const user = K.one(bug.reporter);
    if (user) return K.personName(user);
    return bug.reporter_name || bug.reporter_email || "Anonymous visitor";
  }

  // ---------- stats ----------

  async function loadStats() {
    const settled = await Promise.allSettled([
      K.count("bug_reports", (q) => q.eq("status", "New")),
      K.count("bug_reports", (q) => q.eq("status", "New").eq("priority", "High")),
      K.count("bug_reports", (q) => q.eq("status", "In Progress")),
      K.count("bug_reports", (q) => q.eq("status", "Fixed")),
      K.count("bug_reports", (q) => q.eq("status", "Fixed").gte("resolved_at", new Date(Date.now() - 30 * 86400000).toISOString())),
      K.count("bug_reports", (q) => q.in("status", ["Won't Fix", "Duplicate"])),
      K.count("bug_reports")
    ]);
    const [fresh, freshHigh, progress, fixed, fixedRecent, closed, total] = settled.map(K.ok);
    const fmt = K.format.number;

    if (fresh === undefined) K.setStat("new", { error: true });
    else K.setStat("new", { value: fmt.format(fresh), meta: freshHigh === undefined ? "Not looked at yet" : freshHigh ? `${fmt.format(freshHigh)} high priority` : "Not looked at yet" });
    if (progress === undefined) K.setStat("progress", { error: true });
    else K.setStat("progress", { value: fmt.format(progress), meta: "Being worked on" });
    if (fixed === undefined) K.setStat("fixed", { error: true });
    else K.setStat("fixed", { value: fmt.format(fixed), meta: fixedRecent === undefined ? "" : `${fmt.format(fixedRecent)} in the last 30 days` });
    if (closed === undefined) K.setStat("closed", { error: true });
    else K.setStat("closed", { value: fmt.format(closed), meta: total === undefined ? "" : total ? `${fmt.format(total)} bug reports in total` : "No bug reports yet" });
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
        listPanel.replaceChildren(K.errorBox("Bug reports could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "bug report")} ${filtersActive() ? "match these filters" : "open"}. Newest first.`
      : "No matching bug reports.";

    if (!total) {
      const statusOnly = !filters.search && !filters.area && !filters.source;
      listPanel.replaceChildren(statusOnly && filters.status === "open"
        ? K.stateBox("empty", "No open bug reports", "Nothing is waiting. Choose All statuses to see fixed and closed bugs.")
        : statusOnly && !filters.status
          ? K.stateBox("empty", "No bug reports yet", "Bugs reported from the website form or the NavAble app will appear here.")
          : K.stateBox("empty", "No bug reports match these filters", "Try a different status, area, source, or title."));
      return;
    }

    const body = rows.map((bug) => el("tr", {},
      el("td", {},
        el("div", { className: "nv-cell-main", text: bug.title }),
        el("div", { className: "nv-cell-sub nv-clamp", text: bug.description })),
      el("td", { className: "nv-hide-sm" },
        el("div", { text: bug.area }),
        el("div", { className: "nv-cell-sub", text: SOURCE_LABELS[bug.source] || bug.source })),
      el("td", { className: "nv-hide-sm" }, badge("priority", bug.priority)),
      el("td", {}, badge("bugStatus", bug.status)),
      el("td", { className: "nv-hide-sm nv-cell-sub" },
        el("div", {}, K.timeEl(bug.created_at)),
        el("div", { text: reporterText(bug) })),
      el("td", { className: "is-actions" },
        K.button("Review", {
          iconName: "open_in_new", small: true, ariaLabel: `Review bug: ${bug.title}`,
          onClick: (event) => { const trigger = event.currentTarget; K.withBusy(trigger, () => openBug(bug.bug_id, trigger)); }
        }))));

    listPanel.replaceChildren(
      K.tableEl("Bug reports", [["Bug"], ["Area", "nv-hide-sm"], ["Priority", "nv-hide-sm"], ["Status"], ["Reported", "nv-hide-sm"], ["Actions", "is-actions"]], body),
      K.pager({ page, size: PAGE_SIZE, total, noun: "bug reports", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  // ---------- review dialog ----------

  async function openBug(bugId, trigger) {
    let bug;
    try {
      const { data, error } = await db.from("bug_reports")
        .select(`*, ${REPORTER}, ${HANDLER}`)
        .eq("bug_id", bugId)
        .maybeSingle();
      if (error) throw error;
      bug = data;
    } catch (error) {
      K.toast(`The bug report could not be opened. ${K.friendlyError(error)}`, { assertive: true });
      return;
    }
    if (!bug) {
      K.toast("This bug report no longer exists. The list has been refreshed.", { assertive: true });
      view.load();
      return;
    }

    const reporter = K.one(bug.reporter);
    const handler = K.one(bug.handler);
    const contactEmail = reporter?.email || bug.reporter_email;
    const screenshot = /^https?:\/\//i.test(bug.screenshot_url || "") ? bug.screenshot_url : null;

    K.openDialog({
      title: bug.title,
      description: `${bug.area} · ${SOURCE_LABELS[bug.source] || bug.source} · reported ${K.format.relativeTime(bug.created_at)}`,
      wide: true,
      returnFocus: trigger,
      content: [
        K.details([
          ["Status", badge("bugStatus", bug.status)],
          ["Reported by", el("span", {}, reporterText(bug),
            reporter ? null : el("span", { className: "nv-cell-sub", text: " (not signed in)" }))],
          ["Contact", contactEmail ? el("a", { className: "nv-link", href: `mailto:${encodeURIComponent(contactEmail)}?subject=${encodeURIComponent(`Your NavAble bug report: ${bug.title}`)}` }, contactEmail) : null],
          ["Device", bug.device_info],
          ["App version", bug.app_version],
          ["Screenshot", screenshot ? el("a", { href: screenshot, target: "_blank", rel: "noopener noreferrer" }, el("img", { className: "nv-photo", src: screenshot, alt: `Screenshot attached to the bug report ${bug.title}`, loading: "lazy" })) : null],
          ["Submitted", K.format.fullDate.format(new Date(bug.created_at))],
          ["Last updated", K.format.fullDate.format(new Date(bug.updated_at))],
          bug.resolved_at ? ["Closed", K.format.fullDate.format(new Date(bug.resolved_at))] : null,
          handler ? ["Handled by", K.personName(handler)] : null
        ]),
        el("h3", { className: "nv-subhead", text: "What happened" }),
        el("p", { className: "nv-quote", text: bug.description }),
        el("h3", { className: "nv-subhead", text: "Triage" }),
        el("div", { className: "nv-form-grid" },
          K.field({ label: "Status", name: "status", type: "select", value: bug.status, options: STATUSES.map((s) => [s, s === "In Progress" ? "In progress" : s === "Won't Fix" ? "Won't fix" : s]) }),
          K.field({ label: "Priority", name: "priority", type: "select", value: bug.priority, options: PRIORITIES.map((p) => [p, p]) }),
          el("div", { className: "is-full" }, K.field({ label: "Team notes", name: "admin_notes", type: "textarea", rows: 3, maxLength: 1000, value: bug.admin_notes, hint: "Only admins see these notes." })),
          bug.user_id
            ? el("div", { className: "is-full" }, K.field({ label: "Notify the reporter in the NavAble app", name: "notify", type: "checkbox", hint: "Sends a notification when the status changes." }))
            : el("p", { className: "nv-cell-sub is-full", style: "margin:0", text: contactEmail ? "This person wasn't signed in, so they can only be reached by email." : "This person left no contact details." }))
      ],
      onSubmit: (dialogForm, { showError }) => saveBug(bug, dialogForm, showError)
    });
  }

  async function saveBug(bug, dialogForm, showError) {
    const values = {
      status: dialogForm.elements.status.value,
      priority: dialogForm.elements.priority.value,
      admin_notes: K.formText(dialogForm, "admin_notes")
    };
    const notify = Boolean(dialogForm.elements.notify?.checked);
    const statusChanged = values.status !== bug.status;
    const changed = statusChanged || values.priority !== bug.priority || (values.admin_notes ?? "") !== (bug.admin_notes ?? "");
    if (!changed) {
      K.toast("Nothing changed, so nothing was saved.");
      return true;
    }

    const saved = await K.mutate(() => db.from("bug_reports")
      .update({ ...values, handled_by: window.NavAbleStaff.user_id })
      .eq("bug_id", bug.bug_id)
      .select("bug_id"), {
      failure: "The bug report was not updated.",
      onError: showError
    });
    if (!saved) return false;

    let notifyProblem = "";
    if (notify && statusChanged && bug.user_id) {
      const statusText = { New: "received", "In Progress": "being worked on", Fixed: "fixed", "Won't Fix": "closed without a fix", Duplicate: "closed as a duplicate" }[values.status];
      const { error } = await db.from("notifications").insert({
        user_id: bug.user_id,
        title: values.status === "Fixed" ? "The bug you reported is fixed" : "Your bug report was updated",
        message: `Your bug report "${bug.title}" is now ${statusText}. Thank you for helping improve NavAble.`.slice(0, 500),
        notification_type: "Report Update"
      });
      if (error) {
        console.error("NavAble: bug notification insert failed.", error);
        notifyProblem = ` The reporter was not notified (${K.friendlyError(error)}).`;
      }
    }

    const statusLabel = CLOSED.includes(values.status) ? `closed as ${values.status}` : `marked ${values.status}`;
    K.toast(`Bug report ${statusChanged ? statusLabel : "saved"}.${notify && statusChanged && !notifyProblem ? " Reporter notified." : ""}${notifyProblem}`, { assertive: Boolean(notifyProblem) });
    view.load();
    return true;
  }

  // ---------- CSV ----------

  async function download() {
    downloadButton.disabled = true;
    try {
      const data = await K.allRows(() => listQuery(`bug_id, title, description, area, source, status, priority, device_info, app_version, reporter_name, reporter_email, admin_notes, created_at, updated_at, resolved_at, ${REPORTER}`));
      K.downloadCsv(`navable-bug-reports-${K.today()}.csv`, [
        ["Bug ID", "Title", "Description", "Area", "Sent from", "Status", "Priority", "Reporter", "Contact email", "Device", "App version", "Team notes", "Submitted", "Last updated", "Closed"],
        ...data.map((b) => [b.bug_id, b.title, b.description, b.area, SOURCE_LABELS[b.source] || b.source, b.status, b.priority, reporterText(b), K.one(b.reporter)?.email || b.reporter_email, b.device_info, b.app_version, b.admin_notes, b.created_at, b.updated_at, b.resolved_at])
      ]);
    } catch (error) {
      K.toast(`The CSV could not be created. ${K.friendlyError(error)}`, { assertive: true });
    } finally {
      downloadButton.disabled = false;
    }
  }

  // ---------- start ----------

  filters = K.bindFilters(form, {
    initial: { status: K.param("status"), area: K.param("area"), source: K.param("source"), search: K.param("search") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  downloadButton.addEventListener("click", download);

  const view = K.createPage({
    name: "Bug reports",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      return [...stats, list];
    }
  });
});
