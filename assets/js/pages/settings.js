// Settings: the signed-in admin's own profile (`user_profiles`), password
// (Supabase Auth), global sign-out, and this browser's display preferences
// (handled by the shell toggles in admin.js).
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el, badge } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const profilePanel = main.querySelector('[data-panel="profile"]');
  const accountPanel = main.querySelector('[data-panel="account"]');
  const passwordForm = document.getElementById("passwordForm");
  const passwordError = document.getElementById("passwordError");
  const themeSelect = document.getElementById("themeSelect");
  const contrastToggle = document.getElementById("contrastToggle");
  const signOutButton = document.getElementById("signOutEverywhere");

  const GENDERS = ["Male", "Female", "Prefer not to say"];
  const PROFILE = "profile_id, first_name, last_name, phone_number, address, disability_type, gender, date_of_birth";

  // ---------- profile ----------

  async function run() {
    const me = window.NavAbleStaff;
    const settled = await Promise.allSettled([
      db.from("users").select("email, role, account_status, created_at").eq("user_id", me.user_id).maybeSingle()
        .then(({ data, error }) => { if (error) throw error; return data; }),
      db.from("user_profiles").select(PROFILE).eq("user_id", me.user_id).maybeSingle()
        .then(({ data, error }) => { if (error) throw error; return data; })
    ]);
    const [accountResult, profileResult] = settled;

    if (accountResult.status === "rejected" || !accountResult.value) {
      accountPanel.replaceChildren(accountResult.status === "rejected"
        ? K.errorBox("Account details could not load", accountResult.reason, () => view.load({ announce: true }))
        : K.stateBox("empty", "Account record not found", "Ask another admin to check your account on the Users page."));
    } else {
      const account = accountResult.value;
      accountPanel.replaceChildren(K.details([
        ["Email", account.email],
        ["Role", badge("role", account.role)],
        ["Status", badge("accountStatus", account.account_status)],
        ["Member since", K.format.mediumDate.format(new Date(account.created_at))]
      ]));
    }

    if (profileResult.status === "rejected") {
      profilePanel.replaceChildren(K.errorBox("Your profile could not load", profileResult.reason, () => view.load({ announce: true })));
    } else {
      renderProfile(profileResult.value);
    }
    return settled;
  }

  function renderProfile(profile) {
    const form = el("form", { className: "nv-form-grid", "aria-labelledby": "profileTitle" },
      K.field({ label: "First name", name: "first_name", required: true, maxLength: 50, value: profile?.first_name, autocomplete: "given-name" }),
      K.field({ label: "Last name", name: "last_name", required: true, maxLength: 50, value: profile?.last_name, autocomplete: "family-name" }),
      K.field({ label: "Phone number", name: "phone_number", type: "tel", maxLength: 15, value: profile?.phone_number, autocomplete: "tel", inputMode: "numeric", hint: "Digits only, 11 to 15 numbers." }),
      K.field({ label: "Date of birth", name: "date_of_birth", type: "date", value: profile?.date_of_birth }),
      K.field({ label: "Gender", name: "gender", type: "select", value: profile?.gender || "", options: [["", "Not specified"], ...GENDERS.map((g) => [g, g])] }),
      K.field({ label: "Disability", name: "disability_type", maxLength: 100, value: profile?.disability_type, hint: "Optional." }),
      el("div", { className: "is-full" }, K.field({ label: "Address", name: "address", maxLength: 255, value: profile?.address, autocomplete: "street-address" })),
      el("p", { className: "nv-form-error is-full", role: "alert", hidden: true }),
      el("div", { className: "is-full" }, K.button(profile ? "Save profile" : "Create profile", { iconName: "save", tone: "primary", type: "submit" })));
    const phone = form.elements.phone_number;
    phone.setAttribute("pattern", "[0-9]{11,15}");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      K.withBusy(submit, () => saveProfile(form, profile));
    });
    profilePanel.replaceChildren(form);
  }

  async function saveProfile(form, profile) {
    const errorNode = form.querySelector(".nv-form-error");
    errorNode.hidden = true;
    const values = {
      first_name: K.formText(form, "first_name"),
      last_name: K.formText(form, "last_name"),
      phone_number: K.formText(form, "phone_number"),
      date_of_birth: K.formText(form, "date_of_birth"),
      gender: form.elements.gender.value || null,
      disability_type: K.formText(form, "disability_type"),
      address: K.formText(form, "address")
    };
    const me = window.NavAbleStaff;
    const saved = await K.mutate(() => (profile
      ? db.from("user_profiles").update(values).eq("user_id", me.user_id)
      : db.from("user_profiles").insert({ ...values, user_id: me.user_id })
    ).select(PROFILE), {
      success: "Profile saved.",
      failure: "Your profile was not saved.",
      onError: (message) => {
        errorNode.textContent = message;
        errorNode.hidden = false;
      }
    });
    if (!saved) return;
    const name = `${values.first_name} ${values.last_name}`;
    document.querySelectorAll("[data-staff-name]").forEach((node) => { node.textContent = name; });
    renderProfile(saved[0]);
  }

  // ---------- password ----------

  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = passwordForm.querySelector('button[type="submit"]');
    K.withBusy(submit, async () => {
      passwordError.hidden = true;
      const password = passwordForm.elements.password.value;
      const showError = (message) => {
        passwordError.textContent = message;
        passwordError.hidden = false;
        K.toast(message, { assertive: true });
      };
      if (password !== passwordForm.elements.confirm.value) {
        showError("The two passwords don't match.");
        return;
      }
      const { error } = await db.auth.updateUser({ password });
      if (error) {
        console.error("NavAble: password change failed.", error);
        showError(`Your password was not changed. ${K.friendlyError(error)}`);
        return;
      }
      passwordForm.reset();
      K.toast("Password changed. Use the new password next time you sign in.");
    });
  });

  // ---------- display (mirrors the header toggles in admin.js) ----------

  const shellButton = (selector) => document.querySelector(`.admin-header ${selector}`) || document.querySelector(selector);

  function syncDisplay() {
    themeSelect.value = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    contrastToggle.checked = document.body.classList.contains("admin-high-contrast");
  }

  themeSelect.addEventListener("change", () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    if (themeSelect.value !== current) shellButton("#themeToggle")?.click();
    syncDisplay();
  });
  contrastToggle.addEventListener("change", () => {
    const enabled = document.body.classList.contains("admin-high-contrast");
    if (contrastToggle.checked !== enabled) shellButton('button[aria-label="Toggle high contrast mode"]')?.click();
    syncDisplay();
  });
  new MutationObserver(syncDisplay).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new MutationObserver(syncDisplay).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  syncDisplay();

  // ---------- sessions ----------

  signOutButton.addEventListener("click", () => {
    if (!window.NavAbleAdmin.confirmAction("Sign out on all devices? You will need to sign in again here too.")) return;
    K.withBusy(signOutButton, async () => {
      const { error } = await db.auth.signOut({ scope: "global" });
      if (error) {
        console.error("NavAble: global sign-out failed.", error);
        K.toast(`Could not sign out other devices. ${K.friendlyError(error)}`, { assertive: true });
        return;
      }
      window.NavAbleAdmin.navigate("../staff-login.html");
    });
  });

  // Lets password managers pair the new password with this account.
  K.whenAdminReady((staff) => { passwordForm.elements.username.value = staff.email; });

  const view = K.createPage({ name: "Settings", run });
});
