(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("admin-ui-booting", "admin-auth-pending");

  // Dark is the default theme; a saved choice from the theme toggle wins.
  let theme = "dark";
  try {
    if (localStorage.getItem("navableTheme") === "light") theme = "light";
  } catch (_) {}
  root.dataset.theme = theme;

  try {
    root.dataset.sidebarCollapsed = String(localStorage.getItem("navableSidebarCollapsed") === "true");
  } catch (_) {
    root.dataset.sidebarCollapsed = "false";
  }

  const loginPage = "../staff-login.html";
  const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
  const returnTo = encodeURIComponent(`datas/${currentPage}${window.location.search}${window.location.hash}`);

  const sendToLogin = (reason) => {
    const query = `returnTo=${returnTo}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;
    window.location.replace(`${loginPage}?${query}`);
  };

  const db = window.NavAbleDB;
  if (!db) {
    sendToLogin("unavailable");
    return;
  }

  // Keep the page hidden until the database confirms this is an active admin.
  db.requireAdmin()
    .then(({ profile }) => {
      window.NavAbleStaff = Object.freeze({ ...profile });
      root.classList.remove("admin-auth-pending");
      document.dispatchEvent(new CustomEvent("navable:admin-ready", { detail: profile }));
    })
    .catch(async (error) => {
      console.warn("NavAble admin access denied.", error);
      const { data } = await db.client.auth.getSession().catch(() => ({ data: {} }));
      if (data?.session) {
        await db.signOut();
        sendToLogin("denied");
      } else {
        sendToLogin();
      }
    });

  // A sign-out in another tab should close this one too.
  db.client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") sendToLogin();
  });
})();
