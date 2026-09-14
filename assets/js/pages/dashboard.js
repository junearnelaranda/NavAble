document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const table = document.querySelector("main table");
  const filter = [...document.querySelectorAll('main input[type="text"]')].find((input) => input.placeholder.includes("Filter by location"));
  if (filter && table) {
    filter.setAttribute("aria-label", "Filter recent submissions by location or tag");
    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      table.querySelectorAll("tbody tr").forEach((row) => {
        row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query);
      });
    });
  }

  const exportButton = [...document.querySelectorAll("main button")].find((button) => button.textContent.includes("Export CSV"));
  if (exportButton && table) {
    exportButton.addEventListener("click", () => {
      const rows = [...table.querySelectorAll("tr:not([hidden])")].map((row) => [...row.cells].slice(0, -1).map((cell) => cell.innerText.trim()));
      NavAbleAdmin.downloadCsv("navable-recent-submissions.csv", rows);
    });
  }

  document.querySelectorAll("main button").forEach((button) => {
    const label = button.textContent.replace(/\s+/g, " ").trim();
    if (label === "View All 14 Submissions") button.addEventListener("click", () => { window.location.href = "verification.html"; });
    if (label === "Inspect") button.addEventListener("click", () => { window.location.href = "verification.html"; });
    if (label === "Verify") {
      button.addEventListener("click", () => {
        if (!NavAbleAdmin.confirmAction("Mark this audit as verified in the local prototype?")) return;
        button.disabled = true;
        button.querySelector("span:last-child").textContent = "Verified";
        NavAbleAdmin.showToast("Audit marked as verified in this local session.");
      });
    }
  });
});
