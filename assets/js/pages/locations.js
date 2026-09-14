document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const drawer = document.getElementById("inspectorDrawer");
  const drawerCloseButtons = drawer ? [...drawer.querySelectorAll('[data-close-drawer], button[onclick*="closeQuickDrawer"]')] : [];
  let previousFocus = null;

  const openDrawer = (button) => {
    if (!drawer) return;
    previousFocus = button;
    const values = button.dataset;
    const assignments = {
      drawerLocationName: values.name,
      drawerCoordinates: values.coords,
      drawerClearance: values.clearance,
      drawerSlope: values.slope,
      drawerPowerAssist: values.power,
      drawerElevator: values.elevator
    };
    Object.entries(assignments).forEach(([id, value]) => {
      const target = document.getElementById(id);
      if (target && value) target.textContent = value;
    });
    drawer.classList.remove("translate-x-full");
    drawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => drawer.querySelector("button")?.focus());
  };

  const closeDrawer = () => {
    if (!drawer) return;
    drawer.classList.add("translate-x-full");
    drawer.setAttribute("aria-hidden", "true");
    previousFocus?.focus();
  };

  document.querySelectorAll("[data-inspect-location]").forEach((button) => button.addEventListener("click", () => openDrawer(button)));
  drawerCloseButtons.forEach((button) => button.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && drawer?.getAttribute("aria-hidden") === "false") closeDrawer(); });

  document.querySelectorAll("[data-copy-coordinates]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyCoordinates);
        NavAbleAdmin.showToast("Coordinates copied to the clipboard.");
      } catch (_) {
        NavAbleAdmin.showToast("Clipboard access is unavailable in this browser.", { assertive: true });
      }
    });
  });

  const cards = [...document.querySelectorAll("main h2")].map((heading) => heading.closest("div.bg-surface.rounded-2xl")).filter(Boolean);
  const search = [...document.querySelectorAll('main input[type="text"]')].find((input) => input.placeholder.includes("Search accessible locations"));
  search?.setAttribute("aria-label", "Search accessible locations");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    cards.forEach((card) => { card.hidden = Boolean(query) && !card.textContent.toLowerCase().includes(query); });
  });

  document.getElementById("addLocationBtn")?.addEventListener("click", () => NavAbleAdmin.showToast("Location creator is not connected to a backend in this prototype."));

  document.querySelectorAll("main button").forEach((button) => {
    if (button.textContent.replace(/\s+/g, " ").trim() !== "Export CSV") return;
    button.addEventListener("click", () => {
      const rows = [["Location", "Details"], ...cards.filter((card) => !card.hidden).map((card) => [card.querySelector("h2")?.textContent.trim() || "", card.innerText.replace(/\s+/g, " ").trim()])];
      NavAbleAdmin.downloadCsv("navable-locations.csv", rows);
    });
  });
});
