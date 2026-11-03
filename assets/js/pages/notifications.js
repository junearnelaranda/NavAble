// Notifications: in-app notifications (table `notifications`, one row per
// recipient). Admins send a notification to all active users or to one user
// by email, and review what was sent and whether it was read.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const listPanel = main.querySelector('[data-panel="list"]');
  const summary = document.getElementById("listSummary");
  const downloadButton = document.getElementById("notificationsDownload");
  const composeButton = document.getElementById("notificationCompose");
  const form = document.getElementById("notificationFilters");

  const PAGE_SIZE = 20;
  const INSERT_BATCH = 500;
  const TYPES = ["System Announcement", "Accessibility Update", "Verification", "Report Update"];
  const PERSON = "email, user_profiles(first_name, last_name)";
  const LIST_COLUMNS = `notification_id, title, message, notification_type, is_read, created_at, users(${PERSON})`;

  let filters = {};
  let page = 0;
  const isLatest = K.latestOnly();

  // ---------- queries ----------

  function applyFilters(query) {
    if (filters.type) query = query.eq("notification_type", filters.type);
    if (filters.read) query = query.eq("is_read", filters.read === "true");
    const pattern = K.searchPattern(filters.search);
    if (pattern) query = query.ilike("title", pattern);
    return query;
  }

  const listQuery = (columns, options) => applyFilters(db.from("notifications").select(columns, options))
    .order("created_at", { ascending: false })
    .order("notification_id");

  const filtersActive = () => Boolean(filters.search || filters.type || filters.read);

  // ---------- stats ----------

  async function loadStats() {
    const settled = await Promise.allSettled([
      K.count("notifications"),
      K.count("notifications", (q) => q.gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())),
      K.count("notifications", (q) => q.eq("is_read", false))
    ]);
    const [total, recent, unread] = settled.map(K.ok);
    const fmt = K.format.number;

    if (total === undefined) K.setStat("total", { error: true });
    else K.setStat("total", { value: fmt.format(total), meta: "One per recipient" });
    if (recent === undefined) K.setStat("recent", { error: true });
    else K.setStat("recent", { value: fmt.format(recent), meta: recent ? "All notification types" : "Nothing sent this week" });
    if (unread === undefined) K.setStat("unread", { error: true });
    else K.setStat("unread", { value: fmt.format(unread), meta: "Not yet opened in the app" });
    if (total === undefined || unread === undefined) K.setStat("readRate", { error: true });
    else if (!total) K.setStat("readRate", { value: "Nothing sent yet", textValue: true, meta: "Shows once notifications are sent" });
    else K.setStat("readRate", { value: `${K.percent(total - unread, total)}%`, meta: `${fmt.format(total - unread)} of ${fmt.format(total)} read` });
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
        listPanel.replaceChildren(K.errorBox("Notifications could not load", error, () => loadList()));
        summary.textContent = "Not loaded.";
        downloadButton.disabled = true;
        K.settleFocus(listPanel);
      }
      return { status: "rejected", reason: error };
    }
  }

  function renderList({ rows, total }) {
    summary.textContent = total
      ? `${K.plural(total, "notification")}${filtersActive() ? " match these filters" : ""}. Newest first. Each row is one notification to one person.`
      : "No matching notifications.";

    if (!total) {
      listPanel.replaceChildren(filtersActive()
        ? K.stateBox("empty", "No notifications match these filters", "Try a different type, read status, or title.")
        : K.stateBox("empty", "No notifications sent yet", "Use New notification to send one."));
      return;
    }

    const body = rows.map((item) => el("tr", {},
      el("td", {},
        el("div", { className: "nv-cell-main", text: item.title }),
        el("div", { className: "nv-cell-sub nv-clamp", text: item.message })),
      el("td", { className: "nv-hide-sm" }, badge("notificationType", item.notification_type)),
      el("td", { className: "nv-hide-sm" }, (() => {
        const user = K.one(item.users);
        const name = K.personName(user);
        return [el("div", { text: name }), user?.email && user.email !== name ? el("div", { className: "nv-cell-sub", text: user.email }) : null];
      })()),
      el("td", {}, item.is_read
        ? badge({ read: ["success", "done_all", "Read"] }, "read")
        : badge({ unread: ["warning", "mark_email_unread", "Unread"] }, "unread")),
      el("td", { className: "nv-hide-sm nv-cell-sub" }, K.timeEl(item.created_at))));

    listPanel.replaceChildren(
      K.tableEl("Sent notifications", [["Notification"], ["Type", "nv-hide-sm"], ["Recipient", "nv-hide-sm"], ["Status"], ["Sent", "nv-hide-sm"]], body),
      K.pager({ page, size: PAGE_SIZE, total, noun: "notifications", onChange: (next) => { page = next; loadList(); listPanel.closest(".nv-card").scrollIntoView({ block: "start" }); } }));
  }

  // ---------- compose ----------

  async function compose() {
    let activeUsers;
    try {
      activeUsers = await K.count("users", (q) => q.eq("role", "User").eq("account_status", "Active"));
    } catch (error) {
      K.toast(`The recipient count could not be loaded. ${K.friendlyError(error)}`, { assertive: true });
      return;
    }

    const emailField = K.field({ label: "Recipient email", name: "email", type: "email", autocomplete: "off", hint: "The email address the person signed up with." });
    const content = el("div", { className: "nv-form-grid" },
      K.field({
        label: "Send to", name: "audience", type: "select", value: activeUsers ? "all" : "one",
        options: [["all", `All active users (${K.format.number.format(activeUsers)})`], ["one", "One person"]]
      }),
      K.field({ label: "Type", name: "notification_type", type: "select", value: "System Announcement", options: TYPES.map((t) => [t, t]) }),
      el("div", { className: "is-full" }, emailField),
      el("div", { className: "is-full" }, K.field({ label: "Title", name: "title", required: true, maxLength: 100 })),
      el("div", { className: "is-full" }, K.field({ label: "Message", name: "message", type: "textarea", required: true, rows: 4, maxLength: 500, hint: "Up to 500 characters." })));

    const { form: dialogForm } = K.openDialog({
      title: "New notification",
      description: "Recipients see this in the NavAble app. It can't be unsent.",
      content,
      submitLabel: "Send",
      submitIcon: "send",
      returnFocus: composeButton,
      onSubmit: (submitted, { showError }) => send(submitted, showError)
    });

    const audience = dialogForm.elements.audience;
    const syncAudience = () => {
      const one = audience.value === "one";
      emailField.hidden = !one;
      dialogForm.elements.email.required = one;
    };
    audience.addEventListener("change", syncAudience);
    syncAudience();
  }

  async function send(dialogForm, showError) {
    const title = K.formText(dialogForm, "title");
    const message = K.formText(dialogForm, "message");
    const type = dialogForm.elements.notification_type.value;
    let recipients;

    try {
      if (dialogForm.elements.audience.value === "one") {
        const email = K.formText(dialogForm, "email") || "";
        let { data, error } = await db.from("users").select("user_id, email, account_status").eq("email", email).maybeSingle();
        if (!error && !data && email !== email.toLowerCase()) {
          ({ data, error } = await db.from("users").select("user_id, email, account_status").eq("email", email.toLowerCase()).maybeSingle());
        }
        if (error) throw error;
        if (!data) {
          showError(`No NavAble account uses ${email}. Check the address and try again.`);
          return false;
        }
        if (data.account_status !== "Active" && !window.NavAbleAdmin.confirmAction(`${data.email} is ${data.account_status.toLowerCase()}. Send the notification anyway?`)) return false;
        recipients = [data.user_id];
      } else {
        recipients = (await K.allRows(() => db.from("users").select("user_id").eq("role", "User").eq("account_status", "Active").order("user_id"))).map((u) => u.user_id);
        if (!recipients.length) {
          showError("There are no active users to send to.");
          return false;
        }
      }
    } catch (error) {
      showError(`The recipients could not be loaded. ${K.friendlyError(error)}`);
      return false;
    }

    if (!window.NavAbleAdmin.confirmAction(`Send "${title}" to ${K.plural(recipients.length, "person", "people")}? They will see it in the NavAble app.`)) return false;

    let sent = 0;
    for (let start = 0; start < recipients.length; start += INSERT_BATCH) {
      const batch = recipients.slice(start, start + INSERT_BATCH).map((userId) => ({ user_id: userId, title, message, notification_type: type }));
      const { error } = await db.from("notifications").insert(batch);
      if (error) {
        console.error("NavAble: notification insert failed.", error);
        const reason = K.friendlyError(error);
        if (!sent) {
          showError(`The notification was not sent. ${reason}`);
          K.toast(`The notification was not sent. ${reason}`, { assertive: true });
          return false;
        }
        K.toast(`Sent to ${K.format.number.format(sent)} of ${K.plural(recipients.length, "person", "people")}, then stopped: ${reason}`, { assertive: true, duration: 8000 });
        view.load();
        return true;
      }
      sent += batch.length;
    }

    K.toast(`Notification sent to ${K.plural(sent, "person", "people")}.`);
    view.load();
    return true;
  }

  // ---------- CSV ----------

  async function download() {
    downloadButton.disabled = true;
    try {
      const data = await K.allRows(() => listQuery(LIST_COLUMNS));
      K.downloadCsv(`navable-notifications-${K.today()}.csv`, [
        ["Notification ID", "Title", "Message", "Type", "Recipient", "Email", "Read", "Sent"],
        ...data.map((n) => {
          const user = K.one(n.users);
          return [n.notification_id, n.title, n.message, n.notification_type, K.personName(user), user?.email, n.is_read ? "Yes" : "No", n.created_at];
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
    initial: { type: K.param("type"), read: K.param("read") },
    onChange: (values) => {
      filters = values;
      page = 0;
      loadList();
    }
  }).values();
  downloadButton.addEventListener("click", download);
  composeButton.addEventListener("click", () => K.withBusy(composeButton, compose));

  const view = K.createPage({
    name: "Notifications",
    run: async () => {
      const [stats, list] = await Promise.all([loadStats(), loadList()]);
      composeButton.disabled = false;
      return [...stats, list];
    }
  });
});
