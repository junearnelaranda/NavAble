// Users: NavAble accounts (tables `users` and `user_profiles`). Accounts are
// created by signing up in the app; admins can change account status and role.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("usersDownload");
  const form = document.getElementById("userFilters");

  const PAGE_SIZE = 20;
  const STATUSES = ["Active", "Inactive", "Suspended"];
  const ROLES = ["User", "Admin"];
  const PROFILE = "first_name, last_name, phone_number, address, disability_type, gender, date_of_birth";
  const LIST_COLUMNS = "user_id, email, role, account_status, created_at, user_profiles(first_name, last_name)";

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.role) query = query.eq("role", filters.role);
    if (filters.status) query = query.eq("account_status", filters.status);
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("email", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("users").select(columns, options))
    .order("created_at", { ascending: false })
    .order("user_id");

  const filtersActive = () => Boolean(filters.search || filters.role || filters.status);

  // ---------- stats ----------

  async function loadStats() {
    const settled = await Promise.allSettled([
      K.count("users", (q) => q.eq("role", "User")),
      K.count("users", (q) => q.eq("role", "User").eq("account_status", "Active")),
      K.count("users", (q) => q.eq("role", "User").eq("account_status", "Suspended")),
      K.count("users", (q) => q.eq("role", "User").eq("account_status", "Inactive")),
      K.count("users", (q) => q.eq("role", "Admin")),
      K.count("users", (q) => q.eq("role", "User").gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()))
    ]);
    const [users, active, suspended, inactive, admins, recent] = settled.map(K.ok);
    const fmt = K.format.number;

    if (users === undefined) K.setStat("users", { error: true });
    else K.setStat("users", { value: fmt.format(users), meta: recent === undefined ? "Staff accounts not included" : `${fmt.format(recent)} joined in the last 30 days` });
    if (active === undefined) K.setStat("active", { error: true });
    else K.setStat("active", { value: fmt.format(active), meta: users ? `${K.percent(active, users)}% of registered users` : "No users yet" });
    if (suspended === undefined || inactive === undefined) K.setStat("suspended", { error: true });
    else K.setStat("suspended", { value: fmt.format(suspended + inactive), meta: `${fmt.format(suspended)} suspended, ${fmt.format(inactive)} inactive` });
    if (admins === undefined) K.setStat("admins", { error: true });
    else K.setStat("admins", { value: fmt.format(admins), meta: "Staff with access to this site" });
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
      const totals = await loadPointTotals(result.rows);
      if (!current()) return { status: "fulfilled" };
      renderList(result, totals);
      K.settleFocus(listPanel);
      downloadButton.disabled = !result.total;
      return { status: "fulfilled", value: result };
    } catch (error) {
      if (current()) {
        listPanel.replaceChildren(K.errorBox("Accounts could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  // Point totals for the accounts on this page: a Map of user_id to total,
  // or null when they couldn't load (the list still shows).
  async function loadPointTotals(rows) {
    if (!rows.length) return new Map();
    try {
      const data = await K.rows(db.from("user_point_totals").select("user_id, total_points").in("user_id", rows.map((u) => u.user_id)));
      return new Map(data.map((row) => [row.user_id, row.total_points]));
    } catch (error) {
      console.error("NavAble: point totals could not load.", error);
      return null;
    }
  }

  function renderList({ rows, total }, totals) {
    summary.textContent = total
      ? `${K.plural(total, "account")}${filtersActive() ? " match these filters" : ""}. Newest first.`
      : "No matching accounts.";

    if (!total) {
      listPanel.replaceChildren(filtersActive()
        ? K.stateBox("empty", "No accounts match these filters", "Try a different role, status, or email.")
        : K.stateBox("empty", "No accounts yet", "Accounts appear here when people sign up in the NavAble app."));
      return;
    }

    const me = window.NavAbleStaff?.user_id;
    const body = rows.map((user) => {
      const name = K.personName(user);
      return el("tr", {},
        el("td", {},
          el("div", { className: "nv-cell-main" }, name, user.user_id === me ? el("span", { className: "nv-cell-sub", text: " (you)" }) : null),
          name !== user.email ? el("div", { className: "nv-cell-sub", text: user.email }) : null),
        el("td", { className: "nv-hide-sm" }, badge("role", user.role)),
        el("td", {}, badge("accountStatus", user.account_status)),
        el("td", { className: "nv-hide-sm" }, totals
          ? el("strong", { text: K.format.number.format(totals.get(user.user_id) || 0) })
          : el("span", { className: "nv-cell-sub", title: "Point totals could not load", text: "—" })),
        el("td", { className: "nv-hide-sm nv-cell-sub" }, el("time", { datetime: user.created_at, title: K.format.fullDate.format(new Date(user.created_at)), text: K.format.mediumDate.format(new Date(user.created_at)) })),
        el("td", { className: "is-actions" },
          K.button("Manage", {
            iconName: "manage_accounts", small: true, ariaLabel: `Manage ${name}`,
            onClick: (event) => { const trigger = event.currentTarget; K.withBusy(trigger, () => openUser(user.user_id, trigger)); }
          })));
    });

    listPanel.replaceChildren(
      K.tableEl("Accounts", [["Person"], ["Role", "nv-hide-sm"], ["Status"], ["Points", "nv-hide-sm"], ["Joined", "nv-hide-sm"], ["Actions", "is-actions"]], body),
      K.pager({ page, size: PAGE_SIZE, total, noun: "accounts", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  // ---------- manage dialog ----------

  async function openUser(userId, trigger) {
    const [userResult, reportsResult, reviewsResult, pointsResult] = await Promise.allSettled([
      db.from("users").select(`user_id, email, role, account_status, created_at, updated_at, user_profiles(${PROFILE})`).eq("user_id", userId).maybeSingle()
        .then(({ data, error }) => { if (error) throw error; return data; }),
      K.count("reports", (q) => q.eq("user_id", userId)),
      K.count("reviews", (q) => q.eq("user_id", userId)),
      K.allRows(() => db.from("contribution_points")
        .select("point_id, points, tier, source_type, created_at, reports(report_type), reviews(rating)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("point_id"))
    ]);

    if (userResult.status === "rejected" || !userResult.value) {
      K.toast(userResult.status === "rejected"
        ? `The account could not be opened. ${K.friendlyError(userResult.reason)}`
        : "This account no longer exists. The list has been refreshed.", { assertive: true });
      view.load();
      return;
    }

    const user = userResult.value;
    const profile = K.one(user.user_profiles);
    const isMe = user.user_id === window.NavAbleStaff?.user_id;
    const name = K.personName(user);
    const countText = (result) => (result.status === "fulfilled" ? K.format.number.format(result.value) : "Could not load");

    let pointsTotal = "Could not load";
    let pointsHistory = K.errorBox("Points could not load", pointsResult.reason);
    if (pointsResult.status === "fulfilled") {
      const awards = pointsResult.value;
      pointsTotal = `${K.format.number.format(awards.reduce((sum, a) => sum + a.points, 0))} from ${K.plural(awards.length, "award")}`;
      pointsHistory = awards.length
        ? el("ul", { className: "nv-list" }, awards.slice(0, 10).map((award) => {
          const what = award.source_type === "Report"
            ? `${K.one(award.reports)?.report_type || "Removed"} report`
            : `${K.one(award.reviews)?.rating ?? "?"}-star review`;
          return el("li", { className: "nv-item-meta" },
            el("span", { className: "nv-badge", "data-tone": "success" }, K.icon("stars"), `+${award.points}`),
            el("span", { text: `${award.tier} · ${what}` }),
            K.timeEl(award.created_at));
        }), awards.length > 10 ? el("li", { className: "nv-cell-sub", text: `And ${K.plural(awards.length - 10, "older award")}.` }) : null)
        : el("p", { className: "nv-cell-sub", text: "No points awarded yet. Award them from the Reports or Ratings & Reviews pages." });
    }

    K.openDialog({
      title: name,
      description: `${user.email} · joined ${K.format.mediumDate.format(new Date(user.created_at))}`,
      wide: true,
      returnFocus: trigger,
      submitLabel: "Save changes",
      content: [
        K.details([
          ["Role", badge("role", user.role)],
          ["Status", badge("accountStatus", user.account_status)],
          ["Phone", profile?.phone_number],
          ["Address", profile?.address],
          ["Disability", profile?.disability_type],
          ["Gender", profile?.gender],
          ["Date of birth", profile?.date_of_birth ? K.format.mediumDate.format(new Date(`${profile.date_of_birth}T00:00:00`)) : null],
          ["Reports submitted", countText(reportsResult)],
          ["Reviews written", countText(reviewsResult)],
          ["Points", pointsTotal],
          ["Last updated", K.format.fullDate.format(new Date(user.updated_at))],
          !profile ? ["Profile", el("span", { className: "nv-cell-sub", text: "This account has no profile record." })] : null
        ]),
        el("h3", { className: "nv-subhead", text: "Recent points" }),
        pointsHistory,
        el("h3", { className: "nv-subhead", text: "Access" }),
        el("div", { className: "nv-form-grid" },
          K.field({
            label: "Account status", name: "account_status", type: "select", value: user.account_status, disabled: isMe,
            options: STATUSES.map((s) => [s, s]),
            hint: isMe ? "You can't change your own status." : "Suspended and inactive accounts can't use admin access."
          }),
          K.field({
            label: "Role", name: "role", type: "select", value: user.role, disabled: isMe,
            options: ROLES.map((r) => [r, r]),
            hint: isMe ? "You can't change your own role." : "Admins can sign in to this site and change any record."
          }))
      ],
      onSubmit: async (dialogForm, { showError }) => {
        if (isMe) return true;
        const values = { account_status: dialogForm.elements.account_status.value, role: dialogForm.elements.role.value };
        if (values.account_status === user.account_status && values.role === user.role) {
          K.toast("Nothing changed, so nothing was saved.");
          return true;
        }
        if (values.role === "Admin" && user.role !== "Admin"
          && !window.NavAbleAdmin.confirmAction(`Give ${name} full admin access? They will be able to view and change every NavAble record.`)) {
          return false;
        }
        if (values.account_status === "Suspended" && user.account_status !== "Suspended"
          && !window.NavAbleAdmin.confirmAction(`Suspend ${name}?`)) {
          return false;
        }
        const changes = [];
        if (values.account_status !== user.account_status) changes.push(`status ${values.account_status}`);
        if (values.role !== user.role) changes.push(`role ${values.role}`);
        const saved = await K.mutate(() => db.from("users")
          .update(values)
          .eq("user_id", user.user_id)
          .select("user_id"), {
          success: `${name} saved: ${changes.join(", ")}.`,
          failure: "The account was not updated.",
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
      const [data, totalsRows] = await Promise.all([
        K.allRows(() => listQuery(`user_id, email, role, account_status, created_at, updated_at, user_profiles(${PROFILE})`)),
        K.allRows(() => db.from("user_point_totals").select("user_id, total_points").order("user_id"))
      ]);
      const totals = new Map(totalsRows.map((row) => [row.user_id, row.total_points]));
      K.downloadCsv(`navable-users-${K.today()}.csv`, [
        ["User ID", "Email", "First name", "Last name", "Role", "Status", "Points", "Phone", "Address", "Disability", "Gender", "Date of birth", "Joined", "Last updated"],
        ...data.map((u) => {
          const p = K.one(u.user_profiles) || {};
          return [u.user_id, u.email, p.first_name, p.last_name, u.role, u.account_status, totals.get(u.user_id) || 0, p.phone_number, p.address, p.disability_type, p.gender, p.date_of_birth, u.created_at, u.updated_at];
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
    initial: { role: K.param("role"), status: K.param("status") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  downloadButton.addEventListener("click", download);

  const view = K.createPage({
    name: "Users",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      return [...stats, list];
    }
  });
});
