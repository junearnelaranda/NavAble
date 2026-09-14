document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const table = document.querySelector("main table");
  const rows = table ? [...table.querySelectorAll("tbody tr")] : [];
  const search = document.getElementById("catalog-search");
  const tabs = [...document.querySelectorAll(".cat-tab")];
  let activeCategory = "all";

  const applyFilters = () => {
    const query = search?.value.trim().toLowerCase() || "";
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      const categoryMatch = activeCategory === "all" || text.includes(activeCategory);
      row.hidden = !categoryMatch || (Boolean(query) && !text.includes(query));
    });
  };

  search?.setAttribute("aria-label", "Search accessibility infrastructure records");
  search?.addEventListener("input", applyFilters);
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.classList.toggle("font-bold", selected);
      });
      const label = tab.textContent.replace(/\d[\d,]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
      activeCategory = index === 0 ? "all" : label.split(" & ")[0].replace("paths", "paving").replace("ramps", "ramp").replace("elevators", "elevator").replace("entrances", "entrance");
      applyFilters();
    });
  });

  document.getElementById("compliance-standard")?.addEventListener("change", (event) => NavAbleAdmin.showToast(`Compliance view changed to ${event.target.selectedOptions[0].textContent}.`));

  document.getElementById("export-btn")?.addEventListener("click", () => {
    if (!table) return;
    const data = [...table.querySelectorAll("tr")].filter((row) => !row.hidden).map((row) => [...row.cells].slice(0, -1).map((cell) => cell.innerText.trim()));
    NavAbleAdmin.downloadCsv("navable-accessibility-data.csv", data);
  });
});
