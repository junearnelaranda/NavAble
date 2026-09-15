(() => {
  "use strict";

  const STORAGE_KEY = "navableDashboardLoadState";
  const MINIMUM_VISIBLE_MS = 1200;
  const startedAt = performance.now();
  let shouldLoad = false;
  let failureTimer;
  let revealTimer;
  let readyQueued = false;
  let settled = false;

  try {
    shouldLoad = sessionStorage.getItem(STORAGE_KEY) === "pending";
  } catch (error) {
    console.warn("Dashboard loading state is unavailable.", error);
  }

  const setApplicationUnavailable = (unavailable) => {
    document.querySelectorAll("body > :not(.dashboard-skeleton):not(script)").forEach((element) => {
      element.inert = unavailable;
      if (unavailable) element.setAttribute("aria-hidden", "true");
      else element.removeAttribute("aria-hidden");
    });
  };

  const clearStoredState = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  };

  const ready = () => {
    if (!shouldLoad || settled || readyQueued) return;
    readyQueued = true;
    window.clearTimeout(failureTimer);
    const elapsed = performance.now() - startedAt;
    const remaining = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);
    revealTimer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setApplicationUnavailable(false);
      clearStoredState();
      document.documentElement.classList.remove("dashboard-is-loading", "dashboard-load-failed");
    }, remaining);
  };

  const fail = (error) => {
    if (!shouldLoad || settled) return;
    settled = true;
    window.clearTimeout(failureTimer);
    window.clearTimeout(revealTimer);
    document.documentElement.classList.add("dashboard-load-failed");
    const message = document.getElementById("dashboardLoadErrorMessage");
    if (message) {
      message.textContent = error instanceof Error && error.message
        ? `The dashboard could not be prepared: ${error.message}`
        : "The dashboard could not be prepared. Check this browser session and try again.";
    }
    document.getElementById("dashboardLoadRetry")?.focus();
  };

  window.NavAbleDashboardLoader = Object.freeze({ ready, fail, active: shouldLoad });

  if (!shouldLoad) return;
  document.documentElement.classList.add("dashboard-is-loading");

  document.addEventListener("DOMContentLoaded", () => {
    setApplicationUnavailable(true);
    const retry = document.getElementById("dashboardLoadRetry");
    retry?.addEventListener("click", () => {
      try {
        sessionStorage.setItem(STORAGE_KEY, "pending");
      } catch (_) {}
      window.location.reload();
    });

    failureTimer = window.setTimeout(() => {
      fail(new Error("initialization timed out"));
    }, 10000);
  }, { once: true });
})();
