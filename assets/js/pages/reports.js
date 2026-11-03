// Reports: accessibility issue reports from the NavAble app (table `reports`).
// Admins open a report, set its status and priority, and can add remarks.
// Every status change or remark is recorded in `verification` with the admin
// who made it, and the reporter can optionally get a Report Update notification.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, icon, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("reportsDownload");
  const form = document.getElementById("reportFilters");

  const PAGE_SIZE = 20;
  const OPEN = ["Pending", "Verified"];
  const STATUSES = ["Pending", "Verified", "Resolved", "Rejected"];
  const PRIORITIES = ["High", "Medium", "Low"];
  // The verification table stores the decision as Pending / Approved / Rejected.
  const DECISION_FOR_STATUS = { Pending: "Pending", Verified: "Approved", Resolved: "Approved", Rejected: "Rejected" };

  const LIST_COLUMNS = "report_id, report_type, description, status, priority_level, created_at, locations!inner(location_name, address), users(email, user_profiles(first_name, last_name)), contribution_points(points)";
  const POINTS_ELIGIBLE = ["Verified", "Resolved"];
  const PERSON = "email, user_profiles(first_name, last_name)";

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.status === "open") query = query.in("status", OPEN);
    else if (filters.status) query = query.eq("status", filters.status);
    if (filters.type) query = query.eq("report_type", filters.type);
    if (filters.priority) query = query.eq("priority_level", filters.priority);
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("locations.location_name", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("reports").select(columns, options))
    .order("created_at", { ascending: false })
    .order("report_id");

  const filtersActive = () => Boolean(filters.search || filters.type || filters.priority || filters.status !== "open");

  // ---------- stats ----------

  async function loadStats() {
    const names = ["Pending", "Verified", "Resolved", "Rejected", "highOpen", "total"];
    const settled = await Promise.allSettled([
      ...STATUSES.map((status) => K.count("reports", (q) => q.eq("status", status))),
      K.count("reports", (q) => q.in("status", OPEN).eq("priority_level", "High")),
      K.count("reports")
    ]);
    const value = Object.fromEntries(names.map((name, index) => [name, K.ok(settled[index])]));
    const fmt = K.format.number;
    const total = value.total;
    const share = (n) => (total ? `${K.percent(n, total)}% of ${fmt.format(total)} reports` : "No reports submitted yet");

    if (value.Pending === undefined) K.setStat("pending", { error: true });
    else K.setStat("pending", {
      value: fmt.format(value.Pending),
      meta: value.highOpen === undefined ? "Waiting for review" : value.highOpen ? `${fmt.format(value.highOpen)} open high priority` : "None open at high priority"
    });
    ["Verified", "Resolved", "Rejected"].forEach((status) => {
      const metric = status.toLowerCase();
      if (value[status] === undefined) K.setStat(metric, { error: true });
      else K.setStat(metric, { value: fmt.format(value[status]), meta: total === undefined ? "" : share(value[status]) });
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
      downloadButton.disabled = !result.total;
      return { status: "fulfilled", value: result };
    } catch (error) {
      if (current()) {
        listPanel.replaceChildren(K.errorBox("Reports could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "report")} ${filtersActive() ? "match these filters" : "open"}. Newest first.`
      : "No matching reports.";

    if (!total) {
      const statusOnly = !filters.search && !filters.type && !filters.priority;
      if (statusOnly && filters.status === "open") {
        listPanel.replaceChildren(K.stateBox("empty", "No open reports", "Nothing is waiting for review. Choose All statuses to see resolved and rejected reports."));
      } else if (statusOnly && !filters.status) {
        listPanel.replaceChildren(K.stateBox("empty", "No reports yet", "Reports submitted from the NavAble app will appear here."));
      } else {
        listPanel.replaceChildren(K.stateBox("empty", "No reports match these filters", "Try a different status, issue type, priority, or location name."));
      }
      return;
    }

    const body = rows.map((report) => {
      const location = K.one(report.locations);
      return el("tr", {},
        el("td", {},
          el("div", { className: "nv-cell-main" }, report.report_type),
          el("div", { className: "nv-cell-sub nv-clamp", text: report.description }),
          el("div", { className: "nv-cell-sub nv-show-sm", text: location?.location_name || "Unknown location" })),
        el("td", { className: "nv-hide-sm" },
          el("div", { className: "nv-cell-main", text: location?.location_name || "Unknown location" }),
          location?.address ? el("div", { className: "nv-cell-sub", text: location.address }) : null),
        el("td", { className: "nv-hide-sm" }, badge("priority", report.priority_level)),
        el("td", {}, badge("reportStatus", report.status),
          K.one(report.contribution_points) ? el("div", { className: "nv-cell-sub", style: "margin-top:4px", text: `+${K.one(report.contribution_points).points} points` }) : null),
        el("td", { className: "nv-hide-sm nv-cell-sub" },
          el("div", {}, K.timeEl(report.created_at)),
          el("div", { text: K.personName(K.one(report.users)) })),
        el("td", { className: "is-actions" },
          K.button("Review", { iconName: "open_in_new", small: true, ariaLabel: `Review ${report.report_type} report at ${location?.location_name || "unknown location"}`, onClick: (event) => { const trigger = event.currentTarget; K.withBusy(trigger, () => openReport(report.report_id, trigger)); } })));
    });

    listPanel.replaceChildren(
      K.tableEl("Accessibility reports", [["Issue"], ["Location", "nv-hide-sm"], ["Priority", "nv-hide-sm"], ["Status"], ["Submitted", "nv-hide-sm"], ["Actions", "is-actions"]], body),
      K.pager({ page, size: PAGE_SIZE, total, noun: "reports", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  // ---------- review dialog ----------

  async function openReport(reportId, trigger) {
    const [reportResult, historyResult] = await Promise.allSettled([
      db.from("reports")
        .select(`report_id, user_id, report_type, description, status, priority_level, created_at, updated_at, locations(location_name, address, category), users(${PERSON}), images(image_url, image_name, upload_date), contribution_points(point_id, points, tier)`)
        .eq("report_id", reportId)
        .maybeSingle()
        .then(({ data, error }) => { if (error) throw error; return data; }),
      K.rows(db.from("verification")
        .select(`verification_id, verification_status, remarks, verification_date, users(${PERSON})`)
        .eq("report_id", reportId)
        .order("verification_date", { ascending: false }))
    ]);

    if (reportResult.status === "rejected" || !reportResult.value) {
      K.toast(reportResult.status === "rejected"
        ? `The report could not be opened. ${K.friendlyError(reportResult.reason)}`
        : "This report no longer exists. The list has been refreshed.", { assertive: true });
      view.load();
      return;
    }

    const report = reportResult.value;
    const location = K.one(report.locations);
    const reporter = K.one(report.users);
    const image = K.one(report.images);
    const imageUrl = /^https?:\/\//i.test(image?.image_url || "") ? image.image_url : null;

    const history = historyResult.status === "rejected"
      ? K.errorBox("History could not load", historyResult.reason)
      : historyResult.value.length
        ? el("ul", { className: "nv-list" }, historyResult.value.map((entry) => el("li", { className: "nv-item" },
          el("div", { className: "nv-item-head" },
            badge("verificationStatus", entry.verification_status),
            el("span", { className: "nv-item-meta" }, K.personName(K.one(entry.users)), " · ", K.timeEl(entry.verification_date))),
          entry.remarks ? el("p", { className: "nv-quote", text: entry.remarks }) : null)))
        : el("p", { className: "nv-cell-sub", text: "No status changes or remarks recorded yet." });

    // Points re-render in place after an award or undo, and the list refreshes.
    const pointsHolder = el("div");
    const renderPoints = (award) => pointsHolder.replaceChildren(K.pointsControl({
      source: "Report",
      sourceId: report.report_id,
      award,
      eligible: POINTS_ELIGIBLE.includes(report.status),
      ineligibleHint: "Save the report as Verified or Resolved first, then award points.",
      label: `${K.personName(reporter)}'s ${report.report_type} report`,
      onChange: async () => {
        const { data, error } = await db.from("contribution_points").select("point_id, points, tier").eq("report_id", report.report_id).maybeSingle();
        if (error) K.toast(`The points could not be refreshed. ${K.friendlyError(error)}`, { assertive: true });
        else renderPoints(data);
        view.load();
      }
    }));
    renderPoints(K.one(report.contribution_points) || null);

    const content = [
      K.details([
        ["Location", location ? el("span", {}, location.location_name, location.address ? el("span", { className: "nv-cell-sub" }, ` · ${location.address}`) : null) : "Unknown location"],
        ["Reported by", reporter ? `${K.personName(reporter)}${reporter.email && K.personName(reporter) !== reporter.email ? ` (${reporter.email})` : ""}` : "Unknown user"],
        ["Submitted", K.format.fullDate.format(new Date(report.created_at))],
        ["Last updated", K.format.fullDate.format(new Date(report.updated_at))],
        ["Photo", image ? (imageUrl
          ? el("a", { href: imageUrl, target: "_blank", rel: "noopener noreferrer" }, el("img", { className: "nv-photo", src: imageUrl, alt: `Photo attached to this ${report.report_type} report`, loading: "lazy" }))
          : el("span", { text: image.image_name || image.image_url })) : null]
      ]),
      el("h3", { className: "nv-subhead", text: "Description" }),
      el("p", { className: "nv-quote", text: report.description }),
      el("h3", { className: "nv-subhead", text: "Contribution points" }),
      pointsHolder,
      el("h3", { className: "nv-subhead", text: "Update" }),
      el("div", { className: "nv-form-grid" },
        K.field({ label: "Status", name: "status", type: "select", value: report.status, options: STATUSES.map((s) => [s, s]) }),
        K.field({ label: "Priority", name: "priority", type: "select", value: report.priority_level, options: PRIORITIES.map((p) => [p, p]) }),
        el("div", { className: "is-full" }, K.field({ label: "Remarks", name: "remarks", type: "textarea", rows: 3, maxLength: 500, hint: "Optional. Saved to this report's history with your name and any status change." })),
        el("div", { className: "is-full" }, K.field({ label: "Notify the reporter in the NavAble app", name: "notify", type: "checkbox", hint: "Sends a Report Update notification when the status changes." }))),
      el("h3", { className: "nv-subhead", text: "History" }),
      history
    ];

    K.openDialog({
      title: `${report.report_type} report`,
      description: `${location?.location_name || "Unknown location"} · submitted ${K.format.relativeTime(report.created_at)}`,
      wide: true,
      returnFocus: trigger,
      content,
      onSubmit: (dialogForm, { showError }) => saveReport(report, location, dialogForm, showError)
    });
  }

  async function saveReport(report, location, dialogForm, showError) {
    const status = dialogForm.elements.status.value;
    const priority = dialogForm.elements.priority.value;
    const remarks = K.formText(dialogForm, "remarks");
    const notify = dialogForm.elements.notify.checked;
    const statusChanged = status !== report.status;
    const priorityChanged = priority !== report.priority_level;

    if (!statusChanged && !priorityChanged && !remarks) {
      K.toast("Nothing changed, so nothing was saved.");
      return true;
    }

    if (statusChanged || priorityChanged) {
      const saved = await K.mutate(() => db.from("reports")
        .update({ status, priority_level: priority, updated_at: K.nowIso() })
        .eq("report_id", report.report_id)
        .select("report_id"), { failure: "The report was not updated.", onError: showError });
      if (!saved) return false;
    }

    const problems = [];
    if (statusChanged || remarks) {
      const { error } = await db.from("verification").insert({
        report_id: report.report_id,
        verified_by: window.NavAbleStaff.user_id,
        verification_status: DECISION_FOR_STATUS[status],
        remarks
      });
      if (error) {
        console.error("NavAble: verification history insert failed.", error);
        problems.push(`the history entry was not recorded (${K.friendlyError(error)})`);
      }
    }

    if (notify && statusChanged) {
      const { error } = await db.from("notifications").insert({
        user_id: report.user_id,
        title: "Your report was updated",
        message: `Your ${report.report_type} report for ${location?.location_name || "a location"} is now ${status}.${remarks ? ` Note from the NavAble team: ${remarks}` : ""}`.slice(0, 500),
        notification_type: "Report Update"
      });
      if (error) {
        console.error("NavAble: report notification insert failed.", error);
        problems.push(`the reporter was not notified (${K.friendlyError(error)})`);
      }
    }

    const changes = [statusChanged && `status ${status}`, priorityChanged && `priority ${priority}`, !statusChanged && !priorityChanged && remarks && "remarks added"].filter(Boolean).join(", ");
    if (problems.length) K.toast(`Report saved (${changes}), but ${problems.join(" and ")}.`, { assertive: true, duration: 7000 });
    else K.toast(`Report saved: ${changes}${notify && statusChanged ? ". Reporter notified." : "."}`);
    view.load();
    return true;
  }

  // ---------- CSV ----------

  async function download() {
    downloadButton.disabled = true;
    try {
      const data = await K.allRows(() => listQuery(`report_id, report_type, status, priority_level, description, created_at, updated_at, locations!inner(location_name, address), users(${PERSON})`));
      K.downloadCsv(`navable-reports-${K.today()}.csv`, [
        ["Report ID", "Type", "Status", "Priority", "Location", "Address", "Reported by", "Email", "Description", "Submitted", "Last updated"],
        ...data.map((r) => {
          const location = K.one(r.locations);
          const user = K.one(r.users);
          return [r.report_id, r.report_type, r.status, r.priority_level, location?.location_name, location?.address, K.personName(user), user?.email, r.description, r.created_at, r.updated_at];
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
    initial: { status: K.param("status"), type: K.param("type"), priority: K.param("priority"), search: K.param("search") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  downloadButton.addEventListener("click", download);

  const view = K.createPage({
    name: "Reports",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      return [...stats, list];
    }
  });
});
