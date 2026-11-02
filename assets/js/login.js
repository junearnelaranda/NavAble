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

  const db = window.NavAbleDB;
  const params = new URLSearchParams(window.location.search);
  const submitLabel = submit.innerHTML;

  const showStatus = (message, kind = "") => {
    status.textContent = message;
    status.className = `status show${kind ? ` ${kind}` : ""}`;
    if (kind !== "success") status.focus();
  };

  const destinationFor = (requested) => {
    const target = (requested || "datas/dashboard.html").split(/[?#]/)[0].replace(/\\/g, "/");
    const pageName = target.split("/").pop();
    const safe = target.startsWith("datas/") && ADMIN_PAGE_NAMES.has(pageName);
    return { url: safe ? requested : "datas/dashboard.html", pageName: safe ? pageName : "dashboard.html" };
  };

  const openAdmin = ({ url }) => {
    window.location.href = url;
  };

  const REASONS = {
    denied: "That account is signed in but does not have active admin access.",
    unavailable: "The database connection could not load. Check your internet connection and try again."
  };
  if (!db) showStatus(REASONS.unavailable);
  else if (REASONS[params.get("reason")]) showStatus(REASONS[params.get("reason")]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    if (!db) return showStatus(REASONS.unavailable);

    const email = document.getElementById("staffEmail").value.trim();
    submit.disabled = true;
    submit.textContent = "Signing in...";
    status.className = "status";

    const { error } = await db.client.auth.signInWithPassword({ email, password: password.value });
    if (error) {
      submit.disabled = false;
      submit.innerHTML = submitLabel;
      const message = /invalid login credentials/i.test(error.message)
        ? "Incorrect email or password."
        : /email not confirmed/i.test(error.message)
          ? "Confirm your email address before signing in."
          : `Sign-in failed: ${error.message}`;
      return showStatus(message);
    }

    try {
      await db.requireAdmin();
    } catch (accessError) {
      await db.signOut();
      submit.disabled = false;
      submit.innerHTML = submitLabel;
      return showStatus(accessError.message);
    }

    password.value = "";
    showStatus("Signed in. Opening dashboard...", "success");
    submit.textContent = "Opening dashboard...";
    openAdmin(destinationFor(params.get("returnTo")));
  });

  document.getElementById("year").textContent = new Date().getFullYear();
})();
