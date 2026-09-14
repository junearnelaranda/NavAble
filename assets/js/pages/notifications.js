document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const form = document.getElementById("composerForm");
  const title = document.getElementById("composerTitle");
  const body = document.getElementById("composerBody");
  const previewTitle = document.getElementById("previewTitle");
  const previewBody = document.getElementById("previewBody");
  const titleCount = document.getElementById("titleCount");
  const badge = document.getElementById("previewBadge");
  const radius = document.getElementById("geoRadiusInput");
  const radiusLabel = document.getElementById("geoRadiusLabel");

  title?.addEventListener("input", () => {
    previewTitle.textContent = title.value || "Notification Title";
    titleCount.textContent = `${title.value.length}/90`;
  });
  body?.addEventListener("input", () => { previewBody.textContent = body.value || "Notification message description..."; });
  radius?.addEventListener("input", () => { radiusLabel.textContent = `${radius.value} km radius`; });
  form?.addEventListener("submit", (event) => event.preventDefault());

  document.querySelectorAll("[data-urgency]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-urgency]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      const urgency = button.dataset.urgency;
      badge.textContent = urgency === "Critical" ? "Critical Hazard" : urgency === "Advisory" ? "Advisory Notice" : "Information";
      badge.className = urgency === "Critical"
        ? "px-2 py-0.5 rounded text-[10px] font-bold bg-error text-on-error uppercase"
        : urgency === "Advisory"
          ? "px-2 py-0.5 rounded text-[10px] font-bold bg-secondary text-on-secondary uppercase"
          : "px-2 py-0.5 rounded text-[10px] font-bold bg-primary text-on-primary uppercase";
    });
  });

  document.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => {
      const [startTag, endTag] = button.dataset.format.split("|");
      const start = body.selectionStart;
      const end = body.selectionEnd;
      const selected = body.value.substring(start, end) || "text";
      body.setRangeText(`${startTag}${selected}${endTag}`, start, end, "select");
      body.dispatchEvent(new Event("input", { bubbles: true }));
      body.focus();
    });
  });

  document.querySelector("[data-scroll-to-composer]")?.addEventListener("click", () => document.getElementById("composerCard")?.scrollIntoView({ behavior: "smooth" }));

  document.getElementById("quickTemplateBtn")?.addEventListener("click", () => {
    title.value = "Accessibility route update";
    body.value = "An accessibility feature on your saved route has changed. Open NavAble to review the latest verified route.";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    body.dispatchEvent(new Event("input", { bubbles: true }));
    title.focus();
  });

  document.getElementById("scheduleBtn")?.addEventListener("click", () => NavAbleAdmin.showToast("Scheduling requires a connected notification service."));
  document.getElementById("sendNowBtn")?.addEventListener("click", () => {
    if (!form?.reportValidity()) return;
    if (!NavAbleAdmin.confirmAction("Dispatch this notification in the local prototype? No real devices will be contacted.")) return;
    const button = document.getElementById("sendNowBtn");
    button.disabled = true;
    window.setTimeout(() => {
      button.disabled = false;
      const toast = document.getElementById("dispatchToast");
      toast?.classList.remove("translate-y-32", "opacity-0", "pointer-events-none");
      toast?.classList.add("translate-y-0", "opacity-100");
      window.setTimeout(() => {
        toast?.classList.add("translate-y-32", "opacity-0", "pointer-events-none");
        toast?.classList.remove("translate-y-0", "opacity-100");
      }, 4000);
    }, 450);
  });

  const search = document.getElementById("notificationSearch");
  const historyItems = [...document.querySelectorAll("main h3")].map((heading) => heading.closest("div.bg-surface")).filter(Boolean);
  search?.setAttribute("aria-label", "Search notification history");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    historyItems.forEach((item) => { item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query); });
  });
});
