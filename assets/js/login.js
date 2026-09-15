(() => {
  "use strict";

  const ADMIN_PAGE_NAMES = new Set([
    "dashboard.html", "user.html", "location.html", "accss-data.html",
    "verification.html", "reports.html", "ratings.html", "notifications.html",
    "analytics.html", "settings.html"
  ]);

  function applyNavAbleWordmark(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue.includes("NavAble") || parent.closest("script, style, textarea, option")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const matches = [];
    while (walker.nextNode()) matches.push(walker.currentNode);
    matches.forEach((node) => {
      const container = document.createElement("span");
      node.nodeValue.split(/(NavAble)/g).forEach((part) => {
        if (part !== "NavAble") return container.append(part);
        const word = document.createElement("span");
        word.className = "navable-word";
        word.append("Nav");
        const accent = document.createElement("span");
        accent.className = "navable-able";
        accent.textContent = "Able";
        word.append(accent);
        container.append(word);
      });
      node.replaceWith(container);
    });
  }

  applyNavAbleWordmark();

  const password = document.getElementById("staffPassword");
  const passwordToggle = document.getElementById("passwordToggle");
  const form = document.getElementById("staffLoginForm");
  const status = document.getElementById("loginStatus");
  const submit = form.querySelector(".submit-button");

  passwordToggle.addEventListener("click", () => {
    const hidden = password.type === "password";
    password.type = hidden ? "text" : "password";
    passwordToggle.textContent = hidden ? "Hide" : "Show";
    passwordToggle.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();

    try {
      sessionStorage.setItem("navableStaffPreview", "active");
      sessionStorage.setItem("navableStaffRole", "preview-admin");
    } catch (error) {
      status.textContent = "This browser blocked local session storage. Allow site data to open the dashboard preview.";
      status.className = "status show";
      status.focus();
      return;
    }

    const requested = new URLSearchParams(window.location.search).get("returnTo") || "datas/dashboard.html";
    const target = requested.split(/[?#]/)[0].replace(/\\/g, "/");
    const pageName = target.split("/").pop();
    const destination = target.startsWith("datas/") && ADMIN_PAGE_NAMES.has(pageName)
      ? requested
      : "datas/dashboard.html";
    status.textContent = "Local preview session opened. No credentials were transmitted or verified.";
    status.className = "status show success";
    submit.disabled = true;
    submit.textContent = "Opening dashboard...";
    if (pageName === "dashboard.html") sessionStorage.setItem("navableDashboardLoadState", "pending");
    else sessionStorage.removeItem("navableDashboardLoadState");
    window.location.href = destination;
  });

  document.getElementById("year").textContent = new Date().getFullYear();
})();
