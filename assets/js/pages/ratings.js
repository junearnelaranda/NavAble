document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const cards = [...document.querySelectorAll(".review-card")];
  const search = document.getElementById("venue-search");
  let status = "all";
  let rating = "all";

  cards.forEach((card) => {
    const text = card.textContent.toLowerCase();
    card.dataset.status = text.includes("action required") ? "flagged" : text.includes("hidden") ? "hidden" : "published";
    const score = text.match(/([1-5])(?:\.\d)?\s*(?:\/\s*5|stars?)/)?.[1];
    card.dataset.rating = score || "all";
  });

  const applyFilters = () => {
    const query = search?.value.trim().toLowerCase() || "";
    cards.forEach((card) => {
      const matchesStatus = status === "all" || card.dataset.status === status;
      const matchesRating = rating === "all" || (rating === "1-2" ? ["1", "2"].includes(card.dataset.rating) : card.dataset.rating === rating);
      const matchesSearch = !query || card.textContent.toLowerCase().includes(query);
      card.hidden = !matchesStatus || !matchesRating || !matchesSearch;
    });
  };

  search?.setAttribute("aria-label", "Search reviews by venue, address, or contributor");
  search?.addEventListener("input", applyFilters);
  search?.parentElement.querySelector("button")?.addEventListener("click", () => {
    search.value = "";
    applyFilters();
    search.focus();
  });

  document.querySelectorAll(".status-filter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      status = button.dataset.status;
      document.querySelectorAll(".status-filter-btn").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      applyFilters();
    });
  });

  document.querySelectorAll(".rating-chip").forEach((button) => {
    button.addEventListener("click", () => {
      rating = button.dataset.rating;
      document.querySelectorAll(".rating-chip").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      applyFilters();
    });
  });

  document.querySelectorAll(".action-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".review-card");
      const action = button.textContent.replace(/\s+/g, " ").trim();
      if (!NavAbleAdmin.confirmAction(`${action} for this review?`)) return;
      button.disabled = true;
      button.innerHTML = '<span class="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">done</span><span>Completed</span>';
      if (action.includes("Hide")) card.dataset.status = "hidden";
      if (action.includes("Approve")) card.dataset.status = "published";
      NavAbleAdmin.showToast(`${action} recorded in this local session.`);
      applyFilters();
    });
  });

  const exportButton = [...document.querySelectorAll("main button")].find((button) => button.textContent.includes("Export Reviews"));
  exportButton?.addEventListener("click", () => {
    const rows = [["Status", "Review"], ...cards.filter((card) => !card.hidden).map((card) => [card.dataset.status, card.innerText.replace(/\s+/g, " ").trim()])];
    NavAbleAdmin.downloadCsv("navable-reviews.csv", rows);
  });
});
