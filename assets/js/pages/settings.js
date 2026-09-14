document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const slider = document.getElementById("cv-slider");
  const display = document.getElementById("cv-val");
  slider?.setAttribute("aria-label", "Computer vision confidence threshold");
  slider?.addEventListener("input", () => { display.textContent = `${slider.value}%`; });

  const tabs = [...document.querySelectorAll(".tab-btn")];
  tabs.forEach((button) => {
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(button === tabs[0]));
    button.addEventListener("click", () => {
      tabs.forEach((item) => item.setAttribute("aria-selected", String(item === button)));
      NavAbleAdmin.showToast(`${button.textContent.replace(/\s+/g, " ").trim()} settings selected.`);
    });
  });

  document.querySelectorAll('main button[class*="rounded-full"]').forEach((toggle) => {
    toggle.setAttribute("role", "switch");
    const enabled = toggle.classList.contains("bg-primary");
    toggle.setAttribute("aria-checked", String(enabled));
    if (!toggle.getAttribute("aria-label")) toggle.setAttribute("aria-label", toggle.parentElement?.innerText.split("\n")[0]?.trim() || "Toggle setting");
    toggle.addEventListener("click", () => {
      const next = toggle.getAttribute("aria-checked") !== "true";
      toggle.setAttribute("aria-checked", String(next));
      toggle.classList.toggle("bg-primary", next);
      toggle.classList.toggle("bg-surface-container-highest", !next);
      const knob = toggle.firstElementChild;
      knob?.classList.toggle("translate-x-5", next);
    });
  });

  document.querySelectorAll("main button").forEach((button) => {
    const label = button.textContent.replace(/\s+/g, " ").trim();
    if (label === "Save Changes") button.addEventListener("click", () => NavAbleAdmin.showToast("Settings saved for this local prototype session."));
    if (label === "Discard") button.addEventListener("click", () => {
      if (NavAbleAdmin.confirmAction("Discard unsaved settings changes?")) window.location.reload();
    });
    if (label.includes("Hard Re-index")) button.addEventListener("click", () => {
      if (NavAbleAdmin.confirmAction("Trigger a local hard re-index simulation?")) NavAbleAdmin.showToast("Re-index simulation started. No backend was contacted.");
    });
    if (label.includes("Send Test Ping")) button.addEventListener("click", () => NavAbleAdmin.showToast("Test ping requires a connected notification service."));
  });
});
