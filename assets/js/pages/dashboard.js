document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const loader = window.NavAbleDashboardLoader;

  try {
    const session = sessionStorage.getItem("navableStaffPreview");
    const role = sessionStorage.getItem("navableStaffRole") || "preview-admin";
    if (!['active', 'superadmin'].includes(session) || !['preview-admin', 'superadmin'].includes(role)) {
      throw new Error("this session does not have dashboard permission");
    }

    const table = document.querySelector("main table");
    const summaryCards = document.querySelectorAll('main .grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3.xl\\:grid-cols-6 > div');
    if (!table || summaryCards.length < 4) throw new Error("required dashboard content is missing");

    const filter = [...document.querySelectorAll('main input[type="text"]')].find((input) => input.placeholder.includes("Filter by location"));
    if (filter) {
      filter.setAttribute("aria-label", "Filter recent submissions by location or tag");
      filter.addEventListener("input", () => {
        const query = filter.value.trim().toLowerCase();
        table.querySelectorAll("tbody tr").forEach((row) => {
          row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query);
        });
      });
    }

    const exportButton = document.querySelector('main [data-admin-action="export"]');
    if (exportButton) {
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

    loader?.ready();
  } catch (error) {
    console.error("Dashboard initialization failed.", error);
    loader?.fail(error);
  }
});
