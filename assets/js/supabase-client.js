// Shared Supabase connection for the NavAble admin app.
// Load after the supabase-js CDN script and before any script that uses window.NavAbleDB.
// The publishable key is safe to ship in the browser: row-level security on the
// database decides what each signed-in user can read or change.
(() => {
  "use strict";

  const SUPABASE_URL = "https://bipsoacordrbcekzsdlr.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ttcUnT7dxuDZV3N-cLvZeg_63LpYRXS";

  if (!window.supabase?.createClient) {
    console.error("NavAble: supabase-js did not load, so the database is unavailable.");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  // Returns { user, profile } for a signed-in active admin, or throws with a readable reason.
  async function requireAdmin() {
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw new Error("Please sign in to continue.");

    const { data: profile, error } = await client
      .from("users")
      .select("user_id, email, role, account_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw new Error("Could not check your staff access. Try again in a moment.");
    if (!profile || profile.role !== "Admin") throw new Error("This account does not have admin access.");
    if (profile.account_status !== "Active") throw new Error(`This admin account is ${profile.account_status.toLowerCase()}.`);

    // The display name is optional; fall back to the email when it can't be read.
    const { data: names } = await client
      .from("user_profiles")
      .select("first_name, last_name")
      .eq("user_id", user.id)
      .maybeSingle();
    profile.display_name = [names?.first_name, names?.last_name].filter(Boolean).join(" ") || profile.email;
    return { user, profile };
  }

  async function signOut() {
    try {
      await client.auth.signOut();
    } catch (error) {
      console.warn("NavAble: sign-out request failed; clearing the local session anyway.", error);
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
  }

  window.NavAbleDB = Object.freeze({ client, requireAdmin, signOut });
})();
