(() => {
  "use strict";

  const loginPage = "../staff-login.html";
  const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
  let previewSession = false;

  try {
    previewSession = ["active", "superadmin"].includes(sessionStorage.getItem("navableStaffPreview"));
  } catch (error) {
    console.warn("NavAble preview session storage is unavailable.", error);
  }

  if (!previewSession) {
    const returnTo = encodeURIComponent(`datas/${currentPage}${window.location.search}${window.location.hash}`);
    window.location.replace(`${loginPage}?returnTo=${returnTo}`);
  }
})();
