document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const selectAll = document.getElementById("selectAllRoster");
  const selectAllIcon = document.getElementById("selectAllIcon");
  const checkboxes = [...document.querySelectorAll(".user-chk")];
  const cards = checkboxes.map((checkbox) => checkbox.closest("div.bg-surface.rounded-2xl")).filter(Boolean);

  checkboxes.forEach((checkbox, index) => {
    const name = cards[index]?.querySelector("h2")?.textContent.trim() || `user ${index + 1}`;
    checkbox.setAttribute("aria-label", `Select ${name}`);
  });

  const refreshSelection = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
    if (selectAll) {
      selectAll.checked = selected === checkboxes.length && selected > 0;
      selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
    }
    selectAllIcon?.classList.toggle("hidden", !selectAll?.checked);
    checkboxes.forEach((checkbox) => checkbox.nextElementSibling?.classList.toggle("hidden", !checkbox.checked));
  };

  selectAll?.addEventListener("change", () => {
    checkboxes.forEach((checkbox) => { checkbox.checked = selectAll.checked; });
    refreshSelection();
  });
  checkboxes.forEach((checkbox) => checkbox.addEventListener("change", refreshSelection));

  const search = [...document.querySelectorAll('main input[type="text"]')].find((input) => input.placeholder.includes("Search by full name"));
  search?.setAttribute("aria-label", "Search users by name, email, or badge ID");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    cards.forEach((card) => { card.hidden = Boolean(query) && !card.textContent.toLowerCase().includes(query); });
  });

  const drawer = document.getElementById("inviteDrawer");
  const trigger = document.getElementById("inviteModalTrigger");
  const closeButton = document.getElementById("closeDrawer");
  const cancelButton = document.getElementById("cancelInvite");
  const sendButton = document.getElementById("sendInvite");
  const form = drawer?.querySelector("form");
  let previousFocus = null;

  if (form) {
    [...form.querySelectorAll("input")].slice(0, 2).forEach((input) => { input.required = true; });
  }

  const openDrawer = () => {
    if (!drawer) return;
    previousFocus = document.activeElement;
    drawer.classList.remove("hidden");
    requestAnimationFrame(() => closeButton?.focus());
  };
  const closeDrawer = () => {
    if (!drawer) return;
    drawer.classList.add("hidden");
    previousFocus?.focus();
  };

  trigger?.addEventListener("click", openDrawer);
  closeButton?.addEventListener("click", closeDrawer);
  cancelButton?.addEventListener("click", closeDrawer);
  drawer?.addEventListener("click", (event) => { if (event.target === drawer) closeDrawer(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && drawer && !drawer.classList.contains("hidden")) closeDrawer(); });

  sendButton?.addEventListener("click", () => {
    if (form && !form.reportValidity()) return;
    NavAbleAdmin.showToast("Verified invitation prepared in this local prototype.");
    form?.reset();
    closeDrawer();
  });

  document.querySelectorAll("main button").forEach((button) => {
    const label = button.textContent.replace(/\s+/g, " ").trim();
    if (label === "Export CSV") {
      button.addEventListener("click", () => {
        const rows = [["Name", "Record details"], ...cards.filter((card) => !card.hidden).map((card) => [card.querySelector("h2")?.textContent.trim() || "", card.innerText.replace(/\s+/g, " ").trim()])];
        NavAbleAdmin.downloadCsv("navable-users.csv", rows);
      });
    }
    if (label === "Restrict Access") {
      button.addEventListener("click", () => {
        const selected = checkboxes.filter((checkbox) => checkbox.checked);
        if (!selected.length) return NavAbleAdmin.showToast("Select at least one user first.");
        if (!NavAbleAdmin.confirmAction(`Restrict access for ${selected.length} selected account${selected.length === 1 ? "" : "s"}?`)) return;
        NavAbleAdmin.showToast("Access restriction recorded in this local session.", { assertive: true });
      });
    }
  });
});
