document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  document.querySelectorAll("main select").forEach((select) => {
    if (!select.getAttribute("aria-label")) select.setAttribute("aria-label", select.previousElementSibling?.textContent.trim() || "Analytics filter");
    select.addEventListener("change", () => NavAbleAdmin.showToast(`Analytics view updated to ${select.selectedOptions[0].textContent.trim()}.`));
  });

  const table = document.querySelector("main table");
  const exportButton = document.querySelector('main [data-admin-action="export"]');
  exportButton?.addEventListener("click", () => {
    if (!table) return;
    const rows = [...table.querySelectorAll("tr")].map((row) => [...row.cells].map((cell) => cell.innerText.trim()));
    NavAbleAdmin.downloadCsv("navable-analytics-report.csv", rows);
  });
});
