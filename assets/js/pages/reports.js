document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const search = document.getElementById("reportSearchInput");
  const reports = [...document.querySelectorAll("main article")];
  const severitySelect = document.querySelector("main header select");
  let previousSeverity = "all";

  const applyFilters = () => {
    const query = search?.value.trim().toLowerCase() || "";
    const severity = severitySelect?.value || "all";
    reports.forEach((report) => {
      const text = report.textContent.toLowerCase();
      const matchesText = !query || text.includes(query);
      const matchesSeverity = severity === "all" || text.includes(severity);
      report.hidden = !matchesText || !matchesSeverity;
    });
  };

  search?.setAttribute("aria-label", "Search hazard reports");
  search?.addEventListener("input", applyFilters);
  const clear = search?.parentElement.querySelector('button[title="Clear search"]');
  clear?.addEventListener("click", () => {
    search.value = "";
    applyFilters();
    search.focus();
  });
  severitySelect?.setAttribute("aria-label", "Filter reports by severity");
  severitySelect?.addEventListener("change", () => {
    previousSeverity = severitySelect.value;
    applyFilters();
  });

  reports.forEach((report) => {
    report.querySelectorAll("select").forEach((select) => {
      select.setAttribute("aria-label", "Update report status");
      let previous = select.value;
      select.addEventListener("focus", () => { previous = select.value; });
      select.addEventListener("change", () => {
        if (["resolved", "false"].includes(select.value) && !NavAbleAdmin.confirmAction(`Change this report status to ${select.selectedOptions[0].textContent.trim()}?`)) {
          select.value = previous;
          return;
        }
        previous = select.value;
        NavAbleAdmin.showToast(`Report status changed to ${select.selectedOptions[0].textContent.trim()} in this local session.`);
      });
    });
  });
});
