document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  NavAbleAdmin.promotePageHeading(
    "AI Verification Queue",
    "Review flagged evidence and high-confidence submissions before accessibility records are published."
  );

  const approveButton = document.getElementById("approveBtn");
  const rejectButton = document.getElementById("rejectBtn");
  const batchButton = document.getElementById("batchApproveBtn");

  approveButton?.addEventListener("click", () => {
    if (!NavAbleAdmin.confirmAction("Approve this submission for publication in the local prototype?")) return;
    approveButton.disabled = true;
    approveButton.innerHTML = '<span class="material-symbols-outlined text-[20px]" aria-hidden="true">verified</span><span>Published locally</span>';
    NavAbleAdmin.showToast("Submission approved in this local session.");
  });

  rejectButton?.addEventListener("click", () => {
    const reason = window.prompt("Enter a rejection reason:", "Accessibility evidence is incomplete");
    if (!reason) return;
    if (!NavAbleAdmin.confirmAction("Reject this submission in the local prototype?")) return;
    rejectButton.disabled = true;
    rejectButton.innerHTML = '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">block</span><span>Rejected</span>';
    NavAbleAdmin.showToast(`Submission rejected: ${reason}`, { assertive: true });
  });

  batchButton?.addEventListener("click", () => {
    if (!NavAbleAdmin.confirmAction("Approve all eight submissions above the 95% confidence threshold?")) return;
    batchButton.disabled = true;
    batchButton.innerHTML = '<span class="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">check</span><span>8 submissions approved locally</span>';
    NavAbleAdmin.showToast("Eight high-confidence submissions approved in this local session.");
  });

  const search = document.getElementById("queueSearch");
  const queueItems = [...document.querySelectorAll("main button")].filter((button) => /#VER-\d+/.test(button.textContent));
  search?.setAttribute("aria-label", "Filter verification queue");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    queueItems.forEach((item) => { item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query); });
  });

  const exportButton = document.querySelector('main [data-admin-action="export"]');
  exportButton?.addEventListener("click", () => {
    const rows = [["Verification queue item"], ...queueItems.filter((item) => !item.hidden).map((item) => [item.innerText.replace(/\s+/g, " ").trim()])];
    NavAbleAdmin.downloadCsv("navable-verification-queue.csv", rows);
  });
});
