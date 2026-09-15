(() => {
  "use strict";

  const ICON_LABELS = {
    notifications: "Open notifications",
    contrast: "Toggle high contrast mode",
    close: "Close",
    clear: "Clear",
    delete: "Delete record",
    edit: "Edit record",
    filter_list: "Filter options",
    more_horiz: "More actions",
    more_vert: "More actions",
    near_me: "Filter by geographic area",
    photo_camera: "Filter by media verification status",
    search: "Search",
    tune: "Filter options",
    visibility: "View details",
    zoom_in: "Zoom in",
    zoom_out: "Zoom out",
    rotate_right: "Rotate image",
    center_focus_strong: "Center image",
    view_in_ar: "Open spatial preview"
  };

  const ADMIN_PAGES = new Set([
    "dashboard.html", "user.html", "location.html", "accss-data.html",
    "verification.html", "reports.html", "ratings.html", "notifications.html",
    "analytics.html", "settings.html"
  ]);

  const NAV_ICONS = {
    "dashboard.html": "dashboard",
    "user.html": "group",
    "location.html": "location_on",
    "accss-data.html": "accessible",
    "verification.html": "verified",
    "reports.html": "description",
    "ratings.html": "reviews",
    "notifications.html": "notifications",
    "analytics.html": "analytics",
    "settings.html": "settings"
  };

  const PAGE_LABELS = {
    "dashboard.html": "Dashboard",
    "user.html": "Users",
    "location.html": "Locations",
    "accss-data.html": "Accessibility Data",
    "verification.html": "AI Verification",
    "reports.html": "Reports",
    "ratings.html": "Ratings & Reviews",
    "notifications.html": "Notifications",
    "analytics.html": "Analytics",
    "settings.html": "Settings"
  };

  const PAGE_TRANSITION_MS = 140;
  let navigationPending = false;

  function textLabel(element) {
    return element.textContent.replace(/\s+/g, " ").trim();
  }

  function showToast(message, options = {}) {
    let region = document.querySelector(".admin-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "admin-toast-region";
      region.setAttribute("aria-live", options.assertive ? "assertive" : "polite");
      region.setAttribute("aria-atomic", "true");
      document.body.append(region);
    }

    const toast = document.createElement("div");
    toast.className = "admin-toast";
    toast.setAttribute("role", options.assertive ? "alert" : "status");
    toast.textContent = message;
    region.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 220);
    }, options.duration || 3200);
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  function navigate(destination) {
    if (navigationPending) return;
    navigationPending = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.classList.add("admin-ui-leaving");
    window.setTimeout(() => {
      window.location.href = destination;
    }, reduceMotion ? 0 : PAGE_TRANSITION_MS);
  }

  function downloadCsv(filename, rows) {
    const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${filename} downloaded.`);
  }

  function promotePageHeading(title, description) {
    const main = document.querySelector("main");
    const heading = main?.querySelector(":scope > h1.sr-only");
    const content = main ? [...main.children].find((child) => child !== heading) : null;
    if (!main || !heading || !content) return;
    const intro = document.createElement("div");
    intro.className = "admin-page-intro";
    heading.className = "admin-page-title";
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = description;
    intro.append(heading, copy);
    content.prepend(intro);
  }

  function ensureSkipLink(main) {
    if (!main.id) main.id = "main-content";
    if (document.querySelector(".admin-skip-link")) return;
    const skipLink = document.createElement("a");
    skipLink.className = "admin-skip-link";
    skipLink.href = `#${main.id}`;
    skipLink.textContent = "Skip to main content";
    document.body.prepend(skipLink);
  }

  function setupSidebar() {
    const sidebar = document.getElementById("staffSidebar") || document.querySelector("body > aside");
    const header = document.querySelector("body > div.min-h-screen > header, body > aside + div header, header:not(.dashboard-skeleton-header)");
    if (!sidebar || !header) return;

    sidebar.id = "staffSidebar";
    sidebar.classList.add("admin-sidebar");
    header.classList.add("admin-header");

    const contentShell = [...document.body.children].find((element) => element !== sidebar && element.querySelector?.("main") && element.querySelector?.("header"));
    contentShell?.classList.add("admin-content-shell");

    const brandLink = sidebar.querySelector(':scope > div:first-of-type > div:first-child a[href="dashboard.html"]')
      || sidebar.querySelector('a[href="dashboard.html"]');
    if (brandLink) {
      brandLink.classList.add("admin-brand-link");
      [...brandLink.children].forEach((child) => {
        const containsLogo = child.matches("img") || child.querySelector("img");
        child.classList.add(containsLogo ? "admin-brand-logo" : "admin-brand-copy");
      });
    }

    sidebar.querySelectorAll("nav a").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || !ADMIN_PAGES.has(href)) return;

      let icon = link.querySelector(":scope > .material-symbols-outlined");
      if (!icon) {
        icon = document.createElement("span");
        icon.className = "material-symbols-outlined";
        icon.textContent = NAV_ICONS[href];
      }
      icon.classList.add("admin-nav-icon");
      icon.setAttribute("aria-hidden", "true");
      link.prepend(icon);

      const label = [...link.children].find((child) => child !== icon);
      label?.classList.add("admin-nav-label");
      const labelText = label ? textLabel(label) : href.replace(/\.html$/, "");
      link.setAttribute("aria-label", labelText);
      link.title = labelText;
    });

    const footer = sidebar.querySelector(":scope > div:last-of-type");
    const logout = document.getElementById("staffLogout");
    if (footer) footer.classList.add("admin-sidebar-footer");
    if (logout) {
      logout.classList.add("admin-sidebar-logout");
      logout.querySelector("span:not(.material-symbols-outlined)")?.classList.add("admin-logout-label");
    }

    const profileName = [...(footer?.querySelectorAll("div") || [])].find((element) => textLabel(element) === "June Arnel");
    const profileCopy = profileName?.parentElement;
    const profileAvatar = profileCopy?.previousElementSibling;
    const profileCard = profileCopy?.parentElement?.parentElement;
    profileCopy?.classList.add("admin-profile-copy");
    profileAvatar?.classList.add("admin-profile-avatar");
    profileCard?.classList.add("admin-profile-card");

    let collapseButton = document.getElementById("sidebarCollapse");
    if (!collapseButton) {
      collapseButton = document.createElement("button");
      collapseButton.id = "sidebarCollapse";
      collapseButton.type = "button";
      collapseButton.className = "admin-sidebar-collapse";
      collapseButton.setAttribute("aria-controls", sidebar.id);
      collapseButton.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span><span class="admin-collapse-label">Collapse sidebar</span>';
      if (footer) footer.prepend(collapseButton);
      else sidebar.append(collapseButton);
    }

    let closeButton = document.getElementById("sidebarClose");
    if (!closeButton) {
      closeButton = document.createElement("button");
      closeButton.id = "sidebarClose";
      closeButton.type = "button";
      closeButton.className = "admin-sidebar-close";
      closeButton.setAttribute("aria-label", "Close navigation");
      closeButton.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
      sidebar.prepend(closeButton);
    }

    let toggle = document.getElementById("sidebarToggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.id = "sidebarToggle";
      toggle.type = "button";
      toggle.className = "admin-menu-toggle";
      toggle.setAttribute("aria-controls", sidebar.id);
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      toggle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">menu</span>';
      header.prepend(toggle);
    }

    let backdrop = document.getElementById("sidebarBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "sidebarBackdrop";
      backdrop.className = "admin-sidebar-backdrop hidden";
      backdrop.setAttribute("aria-hidden", "true");
      sidebar.insertAdjacentElement("afterend", backdrop);
    } else {
      backdrop.classList.add("admin-sidebar-backdrop");
    }

    sidebar.querySelectorAll("nav a").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || !ADMIN_PAGES.has(href)) return;
      const current = href === (window.location.pathname.split("/").pop() || "dashboard.html");
      link.classList.toggle("admin-current-link", current);
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    const desktop = window.matchMedia("(min-width: 1024px)");
    let wasOpen = false;
    let collapsed = false;

    try {
      collapsed = localStorage.getItem("navableSidebarCollapsed") === "true";
    } catch (_) {}

    const setCollapsed = (next, persist = true) => {
      collapsed = Boolean(next);
      const active = desktop.matches && collapsed;
      document.documentElement.dataset.sidebarCollapsed = String(collapsed);
      document.body.classList.toggle("admin-sidebar-collapsed", active);
      sidebar.dataset.collapsed = String(active);
      collapseButton.setAttribute("aria-expanded", String(!active));
      collapseButton.setAttribute("aria-label", active ? "Expand sidebar" : "Collapse sidebar");
      collapseButton.title = active ? "Expand sidebar" : "Collapse sidebar";
      const icon = collapseButton.querySelector(".material-symbols-outlined");
      const label = collapseButton.querySelector(".admin-collapse-label");
      if (icon) icon.textContent = active ? "left_panel_open" : "left_panel_close";
      if (label) label.textContent = active ? "Expand sidebar" : "Collapse sidebar";
      if (persist) {
        try {
          localStorage.setItem("navableSidebarCollapsed", String(collapsed));
        } catch (_) {}
      }
    };

    const setSidebar = (open, returnFocus = false) => {
      const mobileOpen = open && !desktop.matches;
      sidebar.dataset.open = String(open);
      sidebar.classList.toggle("-translate-x-full", !open);
      backdrop.classList.toggle("hidden", !mobileOpen);
      toggle.setAttribute("aria-expanded", String(mobileOpen));
      toggle.setAttribute("aria-label", mobileOpen ? "Close navigation" : "Open navigation");
      document.body.classList.toggle("overflow-hidden", mobileOpen);
      sidebar.inert = !open;

      if (mobileOpen) {
        wasOpen = true;
        requestAnimationFrame(() => closeButton.focus());
      } else if (returnFocus && wasOpen) {
        toggle.focus();
        wasOpen = false;
      }
    };

    const syncLayout = () => {
      setSidebar(desktop.matches);
      if (desktop.matches) {
        sidebar.inert = false;
        setCollapsed(collapsed, false);
      } else {
        document.body.classList.remove("admin-sidebar-collapsed");
        sidebar.dataset.collapsed = "false";
      }
    };

    toggle.addEventListener("click", () => setSidebar(toggle.getAttribute("aria-expanded") !== "true"));
    closeButton.addEventListener("click", () => setSidebar(false, true));
    collapseButton.addEventListener("click", () => setCollapsed(!collapsed));
    backdrop.addEventListener("click", () => setSidebar(false, true));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") setSidebar(false, true);
      if (event.key !== "Tab" || desktop.matches || toggle.getAttribute("aria-expanded") !== "true") return;
      const focusable = [...sidebar.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    if (desktop.addEventListener) desktop.addEventListener("change", syncLayout);
    else desktop.addListener(syncLayout);

    sidebar.querySelectorAll("nav a").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || !ADMIN_PAGES.has(href)) return;
      const current = href === (window.location.pathname.split("/").pop() || "dashboard.html");
      link.classList.toggle("admin-current-link", current);
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      link.addEventListener("click", () => {
        if (!desktop.matches) setSidebar(false);
      });
    });

    sidebar.querySelectorAll('a[href]').forEach((link) => {
      link.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
        const target = new URL(link.href, window.location.href);
        const pageName = target.pathname.split("/").pop();
        if (target.origin !== window.location.origin || !ADMIN_PAGES.has(pageName)) return;
        event.preventDefault();
        navigate(target.href);
      });
    });

    syncLayout();
  }

  function setupSessionControls() {
    const logout = document.getElementById("staffLogout");
    if (!logout) return;
    logout.addEventListener("click", () => {
      try {
        sessionStorage.removeItem("navableStaffPreview");
        sessionStorage.removeItem("navableStaffRole");
        sessionStorage.removeItem("navableDashboardLoadState");
      } catch (error) {
        console.warn("Could not clear the preview session.", error);
      }
      navigate("../staff-login.html");
    });
  }

  function setupBrand() {
    const sidebar = document.getElementById("staffSidebar") || document.querySelector("body > aside");
    if (!sidebar) return;

    if (document.body.dataset.adminPage === "user.html") {
      const sidebarContent = sidebar.querySelector(":scope > div:first-of-type");
      const brand = sidebarContent?.querySelector(":scope > div:first-child");
      if (brand) {
        brand.className = "mb-space-xl flex items-center justify-between gap-space-sm";
        brand.innerHTML = `
          <a class="flex min-w-0 items-center gap-space-sm" href="dashboard.html" aria-label="NavAble staff dashboard">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface shadow-[4px_4px_10px_rgba(15,43,77,0.08),-4px_-4px_10px_rgba(255,255,255,0.9)]">
              <img class="h-9 w-9 object-cover mix-blend-multiply" src="../logOnly.png" alt="">
            </div>
            <div class="min-w-0">
              <div class="font-headline-sm text-headline-sm leading-tight text-on-surface">Nav<span class="text-primary">Able</span></div>
              <div class="truncate font-label-sm text-label-sm text-on-surface-variant">Accessibility &amp; Verification</div>
            </div>
          </a>`;
        return;
      }
    }

    if (sidebar.querySelector('img[src="../logOnly.png"]')) return;
    const icon = sidebar.querySelector("a .material-symbols-outlined, aside > div:first-child > div:first-child .material-symbols-outlined");
    if (!icon) return;
    const logo = document.createElement("img");
    logo.src = "../logOnly.png";
    logo.alt = "";
    logo.className = "w-9 h-9 object-cover mix-blend-multiply";
    icon.replaceWith(logo);
  }

  function setupGlobalControls() {
    const header = document.querySelector("body > div.min-h-screen > header, body > aside + div header, header:not(.dashboard-skeleton-header)");
    if (!header) return;

    const pageName = window.location.pathname.split("/").pop() || "dashboard.html";
    const breadcrumb = [...header.querySelectorAll(":scope > div")].find((element) => element.textContent.includes("Admin Cockpit"));
    if (breadcrumb) {
      breadcrumb.classList.add("admin-page-context");
      breadcrumb.setAttribute("aria-label", `Current page: ${PAGE_LABELS[pageName] || "Administration"}`);
      breadcrumb.textContent = PAGE_LABELS[pageName] || "Administration";
    }

    [...header.querySelectorAll("span")].forEach((status) => {
      if (status.textContent.trim() === "Live: Firebase Online") status.textContent = "Prototype data";
    });
    const globalSearch = header.querySelector('input[type="text"], input[type="search"]');
    if (globalSearch) {
      globalSearch.setAttribute("aria-label", "Search the admin dashboard");
      document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          globalSearch.focus();
          globalSearch.select();
        }
      });
      globalSearch.addEventListener("keydown", (event) => {
        if (event.key === "Escape") globalSearch.blur();
      });
    }

    const notificationButton = [...header.querySelectorAll("button")].find((button) => button.querySelector(".material-symbols-outlined")?.textContent.trim() === "notifications");
    if (notificationButton) {
      notificationButton.setAttribute("aria-label", "Open notifications");
      notificationButton.addEventListener("click", () => {
        navigate("notifications.html");
      });
    }

    const contrastButton = [...header.querySelectorAll("button")].find((button) => button.querySelector(".material-symbols-outlined")?.textContent.trim() === "contrast");
    if (contrastButton) {
      let enabled = false;
      try {
        enabled = localStorage.getItem("navableHighContrast") === "true";
      } catch (_) {}
      document.body.classList.toggle("admin-high-contrast", enabled);
      contrastButton.setAttribute("aria-label", "Toggle high contrast mode");
      contrastButton.setAttribute("aria-pressed", String(enabled));
      contrastButton.addEventListener("click", () => {
        enabled = !document.body.classList.contains("admin-high-contrast");
        document.body.classList.toggle("admin-high-contrast", enabled);
        contrastButton.setAttribute("aria-pressed", String(enabled));
        try {
          localStorage.setItem("navableHighContrast", String(enabled));
        } catch (_) {}
        showToast(`High contrast mode ${enabled ? "enabled" : "disabled"}.`);
      });
    }
  }

  function improveControlNames() {
    const labelsByFor = new Map([...document.querySelectorAll("label[for]")].map((label) => [label.htmlFor, textLabel(label)]));
    let selectionIndex = 0;

    document.querySelectorAll('a[href="#"]').forEach((link) => {
      link.href = "dashboard.html";
      if (!link.getAttribute("aria-label") && !textLabel(link)) link.setAttribute("aria-label", "Go to dashboard");
    });

    document.querySelectorAll("input, select, textarea").forEach((control) => {
      if (control.type === "hidden" || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) return;
      if (control.id && labelsByFor.has(control.id)) return;
      const wrappingLabel = control.closest("label");
      if (wrappingLabel) return;

      let label = control.getAttribute("placeholder") || "";
      if (!label && control.tagName === "SELECT") label = control.options[0]?.textContent.trim() || "Select an option";
      if (!label && control.type === "range") label = "Adjust value";
      if (!label && control.type === "checkbox") label = `Select record ${++selectionIndex}`;
      if (!label) label = `${control.type || control.tagName.toLowerCase()} field`;
      control.setAttribute("aria-label", label);
    });

    document.querySelectorAll("button").forEach((button) => {
      if (!button.type) button.type = "button";
      if (button.getAttribute("aria-label") || button.getAttribute("aria-labelledby") || button.title) return;
      const icon = button.querySelector(".material-symbols-outlined");
      const iconName = icon?.textContent.trim();
      const clone = button.cloneNode(true);
      clone.querySelectorAll(".material-symbols-outlined").forEach((item) => item.remove());
      const visibleText = textLabel(clone);
      if (!visibleText && iconName) button.setAttribute("aria-label", ICON_LABELS[iconName] || iconName.replace(/_/g, " "));
      if (!visibleText && iconName) button.classList.add("admin-icon-button");
    });

    document.querySelectorAll("img").forEach((image) => {
      if (image.hasAttribute("alt")) return;
      image.alt = image.dataset.alt || "";
    });
  }

  function standardizeExportButtons() {
    document.querySelectorAll("main button").forEach((button) => {
      const label = textLabel(button);
      const title = button.title || "";
      if (!/^Export\b/i.test(label) && !/^Export\b/i.test(title)) return;
      button.dataset.adminAction = "export";
      button.classList.add("admin-export-button");
      button.setAttribute("aria-label", button.getAttribute("aria-label") || title || "Export data");
      button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">download</span><span>Export</span>';
    });

    const placeExportButton = () => {
      const main = document.querySelector("main");
      const button = main?.querySelector('[data-admin-action="export"]');
      const heading = [...(main?.querySelectorAll("h1") || [])].find((item) => !item.classList.contains("sr-only"));
      if (!main || !button || !heading) return;

      const titleBlock = heading.closest(".admin-page-intro") || heading.parentElement;
      const existingRow = titleBlock?.parentElement;
      const isResponsiveRow = existingRow?.classList.contains("flex") && [...existingRow.classList].some((name) => name.includes("flex-row"));

      if (isResponsiveRow) {
        existingRow.classList.add("admin-page-heading-row");
        const actions = [...existingRow.children].find((child) => child !== titleBlock && child.matches("div") && child.querySelector("button, input, select"));
        if (!actions) return;
        actions.classList.add("admin-page-actions");
        if (!actions.contains(button)) {
          const primary = [...actions.children].find((child) => child.matches("button") && /(?:^|\s)bg-primary(?:-container)?(?:\s|$)/.test(child.className));
          if (primary) actions.insertBefore(button, primary);
          else actions.append(button);
        }
        return;
      }

      const row = document.createElement("div");
      const actions = document.createElement("div");
      row.className = "admin-page-heading-row flex flex-col sm:flex-row";
      actions.className = "admin-page-actions";
      titleBlock.before(row);
      row.append(titleBlock, actions);
      actions.append(button);
    };

    // Page-specific scripts can promote a screen-reader heading during the same
    // DOMContentLoaded event. Run placement on the next task so that heading is
    // available before Export is moved into the shared top-right action area.
    window.setTimeout(placeExportButton, 0);
  }

  function protectDestructiveControls() {
    document.querySelectorAll("button").forEach((button) => {
      const icon = button.querySelector(".material-symbols-outlined")?.textContent.trim();
      if (icon !== "delete") return;
      button.addEventListener("click", (event) => {
        if (!confirmAction("Remove this record from the local prototype view?")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        showToast("Removal recorded in this local session.", { assertive: true });
      }, true);
    });
  }

  function improveStructuredContent() {
    document.querySelectorAll("table").forEach((table) => {
      table.querySelectorAll("thead th").forEach((heading) => heading.setAttribute("scope", "col"));
      if (!table.querySelector("caption")) {
        const caption = document.createElement("caption");
        caption.className = "sr-only";
        caption.textContent = table.closest("div")?.parentElement?.querySelector("h2")?.textContent.trim() || "Administrative records";
        table.prepend(caption);
      }
      table.parentElement?.classList.add("admin-table-wrap");
    });

    const dialogDefinitions = [
      ["inviteDrawer", "Invite auditor or add staff"],
      ["inspectorDrawer", "Location telemetry inspector"]
    ];
    dialogDefinitions.forEach(([id, name]) => {
      const dialog = document.getElementById(id);
      if (!dialog) return;
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", name);
    });

    const existingToast = document.getElementById("dispatchToast");
    if (existingToast) {
      existingToast.setAttribute("role", "status");
      existingToast.setAttribute("aria-live", "polite");
      existingToast.setAttribute("aria-atomic", "true");
    }
  }

  function improveHeadingHierarchy() {
    const main = document.querySelector("main");
    if (!main) return;
    main.querySelectorAll("h1").forEach((heading) => heading.classList.add("admin-page-title"));
    main.querySelectorAll("h2").forEach((heading) => heading.classList.add("admin-section-title"));
    main.querySelectorAll("h3").forEach((heading) => heading.classList.add("admin-card-title"));
  }

  function modernizeRemoteImages() {
    const page = document.body.dataset.adminPage;
    const icon = page === "user.html" ? "person" : page === "location.html" ? "location_on" : page === "verification.html" ? "frame_inspect" : "accessible";
    document.querySelectorAll('[data-admin-visual="true"]').forEach((visual) => {
      if (visual.matches("img")) {
        const replacement = document.createElement("div");
        replacement.className = `${visual.className} admin-media-placeholder`;
        replacement.setAttribute("role", "img");
        replacement.setAttribute("aria-label", visual.alt || visual.dataset.alt || "Administrative record visual");
        replacement.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`;
        visual.replaceWith(replacement);
        return;
      }

      visual.classList.add("admin-media-placeholder");
      visual.setAttribute("role", "img");
      visual.setAttribute("aria-label", visual.dataset.location || "Administrative record visual");
      visual.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`;
    });
  }

  function clarifyPrototypeStatus() {
    const replacements = new Map([
      ["Live Synced", "Prototype View"],
      ["Live Synced (v4.8)", "Prototype Dataset"],
      ["Real-time sync active", "Static preview data"],
      ["JWT session verification", "Preview session only"],
      ["Cluster Healthy (us-east1)", "Not connected"]
    ]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const value = node.nodeValue.trim();
      if (replacements.has(value)) node.nodeValue = node.nodeValue.replace(value, replacements.get(value));
    });
  }

  function revealAdminUi() {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        document.documentElement.classList.remove("admin-ui-booting", "admin-ui-leaving");
        document.documentElement.classList.add("admin-ui-ready");
      });
    }, 0);
  }

  document.addEventListener("DOMContentLoaded", () => {
    try {
      document.body.classList.add("admin-page");
      document.body.dataset.adminPage = window.location.pathname.split("/").pop() || "dashboard.html";
      const main = document.querySelector("main");
      if (main) {
        ensureSkipLink(main);
      }
      setupBrand();
      setupSidebar();
      setupSessionControls();
      setupGlobalControls();
      standardizeExportButtons();
      improveControlNames();
      protectDestructiveControls();
      improveStructuredContent();
      improveHeadingHierarchy();
      modernizeRemoteImages();
      clarifyPrototypeStatus();
    } finally {
      revealAdminUi();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    navigationPending = false;
    document.documentElement.classList.remove("admin-ui-booting", "admin-ui-leaving");
    document.documentElement.classList.add("admin-ui-ready");
  });

  window.NavAbleAdmin = Object.freeze({ showToast, confirmAction, downloadCsv, promotePageHeading, navigate });
})();
