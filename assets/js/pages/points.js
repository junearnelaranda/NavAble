// Points & Levels: what the Small / Regular / Big award boxes are worth
// (table `point_presets`) and how many points each contributor level needs
// (table `contributor_levels`), the same tables the phone app uses. Saving
// goes through the set_point_presets and set_level_thresholds database
// functions, which only admins can run. Level names are fixed; Newcomer is
// everyone below Explorer and always needs 0 points.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const K = window.NavAbleKit;
  const { el } = K;
  const db = K.db();
  const main = document.getElementById("main-content");
  const tiersPanel = main.querySelector('[data-panel="tiers"]');
  const levelsPanel = main.querySelector('[data-panel="levels"]');
  const fmt = K.format.number;

  const TIER_MAX = K.CUSTOM_POINTS.max;
  const LEVEL_MAX = 1_000_000;

  let settings = null; // { tiers, levels } as last loaded
  let totals = null; // each contributor's total points, or null when they couldn't load
  // Forms with unsaved edits are not redrawn by a refresh.
  const dirty = { tiers: false, levels: false };

  // ---------- helpers ----------

  function lastSaved(rows) {
    const latest = rows.map((row) => row.updated_at).filter(Boolean).sort().pop();
    return latest ? el("p", { className: "nv-cell-sub" }, "Last saved ", K.timeEl(latest), ".") : null;
  }

  // Whole number in [min, max], or null.
  function readWhole(control, min, max) {
    const raw = control.value.trim();
    const value = Number(raw);
    return raw && Number.isInteger(value) && value >= min && value <= max ? value : null;
  }

  function formError(form) {
    const node = form.querySelector(".nv-form-error");
    return (message, control) => {
      node.textContent = message || "";
      node.hidden = !message;
      form.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
      if (control) {
        control.setAttribute("aria-invalid", "true");
        control.focus();
      }
    };
  }

  // ---------- point boxes ----------

  function renderTiers() {
    const tiers = settings.tiers;
    const form = el("form", { novalidate: true, "aria-labelledby": "tiersTitle" },
      el("div", { className: "nv-points-fields" }, tiers.map((tier) => K.field({
        label: tier.tier, name: tier.tier, type: "number", value: tier.points,
        min: 1, max: TIER_MAX, step: 1, required: true, inputMode: "numeric"
      }))),
      el("p", { className: "nv-note" }, K.icon("info"), "Applies to new awards only. Past awards keep their points."),
      el("p", { className: "nv-form-error", role: "alert", hidden: true }),
      el("div", { className: "nv-row-actions", style: "justify-content:flex-start" },
        K.button("Save point boxes", { iconName: "save", tone: "primary", type: "submit" })),
      lastSaved(tiers));
    const showError = formError(form);

    form.addEventListener("input", () => { dirty.tiers = true; showError(""); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      K.withBusy(submit, async () => {
        const values = {};
        for (const tier of tiers) {
          const control = form.elements[tier.tier];
          const value = readWhole(control, 1, TIER_MAX);
          if (value === null) {
            showError(`${tier.tier} must be a whole number from 1 to ${fmt.format(TIER_MAX)}.`, control);
            return;
          }
          values[tier.tier.toLowerCase()] = value;
        }
        if (tiers.every((tier) => values[tier.tier.toLowerCase()] === tier.points)) {
          dirty.tiers = false;
          K.toast("Nothing changed, so nothing was saved.");
          return;
        }
        const saved = await K.mutate(() => db.rpc("set_point_presets", values), {
          success: `Point boxes saved: Small +${values.small}, Regular +${values.regular}, Big +${values.big}. New awards use these values.`,
          failure: "The point boxes were not saved.",
          onError: (message) => showError(message)
        });
        if (!saved) return;
        dirty.tiers = false;
        await view.load();
      });
    });
    tiersPanel.replaceChildren(form);
  }

  // ---------- levels ----------

  function countsByLevel(levels) {
    const counts = new Map(levels.map((level) => [level.level, 0]));
    (totals || []).forEach((points) => {
      const level = K.levelFor(points, levels)?.level;
      if (level) counts.set(level, counts.get(level) + 1);
    });
    return counts;
  }

  // Contributors whose level would drop, grouped by "Gold → Silver".
  function movesDown(oldLevels, newLevels) {
    const rank = (levels, points) => K.levelFor(points, levels)?.rank ?? 1;
    const moves = new Map();
    let total = 0;
    (totals || []).forEach((points) => {
      const before = K.levelFor(points, oldLevels);
      const after = K.levelFor(points, newLevels);
      if (rank(newLevels, points) >= rank(oldLevels, points)) return;
      const key = `${before.level} → ${after.level}`;
      moves.set(key, (moves.get(key) || 0) + 1);
      total += 1;
    });
    return { total, moves: [...moves.entries()].sort((a, b) => b[1] - a[1]) };
  }

  function renderLevels() {
    const levels = settings.levels;
    const counts = countsByLevel(levels);
    const body = levels.map((level) => {
      const isStart = level.rank === 1;
      const input = isStart ? null : el("input", {
        className: "nv-input", type: "number", name: level.level, min: 1, max: LEVEL_MAX, step: 1,
        inputmode: "numeric", required: true, "aria-label": `Points needed for ${level.level}`
      });
      if (input) input.value = level.min_points;
      return el("tr", {},
        el("th", { scope: "row" }, K.levelBadge(level.level)),
        el("td", {}, isStart
          ? el("div", {}, el("strong", { text: "0" }), el("div", { className: "nv-cell-sub", text: "Everyone starts here" }))
          : input),
        el("td", { className: "nv-hide-sm" }, totals
          ? el("span", { text: fmt.format(counts.get(level.level) || 0) })
          : el("span", { className: "nv-cell-sub", title: "Contributor totals could not load", text: "—" })));
    });

    const table = el("div", { className: "nv-table-scroll nv-level-table" },
      el("table", { className: "nv-table" },
        el("caption", { className: "sr-only", text: "Contributor levels and the points each one needs" }),
        el("thead", {}, el("tr", {},
          el("th", { scope: "col", text: "Level" }),
          el("th", { scope: "col", text: "Points needed" }),
          el("th", { scope: "col", className: "nv-hide-sm", text: "Contributors now" }))),
        el("tbody", {}, body)));

    const form = el("form", { novalidate: true, "aria-labelledby": "levelsTitle" },
      table,
      el("p", { className: "nv-note" }, K.icon("info"), "Each level must need more points than the one before. \"Contributors now\" counts people with at least one award."),
      el("p", { className: "nv-form-error", role: "alert", hidden: true }),
      el("div", { className: "nv-row-actions", style: "justify-content:flex-start" },
        K.button("Save levels", { iconName: "save", tone: "primary", type: "submit" })),
      lastSaved(levels));
    const showError = formError(form);

    async function save(values) {
      const saved = await K.mutate(() => db.rpc("set_level_thresholds", values), {
        success: "Levels saved. Badges everywhere now use the new points.",
        failure: "The levels were not saved."
      });
      if (!saved) return false;
      dirty.levels = false;
      await view.load();
      return true;
    }

    form.addEventListener("input", () => { dirty.levels = true; showError(""); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      K.withBusy(submit, async () => {
        const next = levels.map((level) => ({ ...level }));
        for (const level of next.slice(1)) {
          const control = form.elements[level.level];
          const value = readWhole(control, 1, LEVEL_MAX);
          if (value === null) {
            showError(`${level.level} must be a whole number from 1 to ${fmt.format(LEVEL_MAX)}.`, control);
            return;
          }
          level.min_points = value;
        }
        for (let index = 1; index < next.length; index += 1) {
          const previous = next[index - 1];
          if (next[index].min_points <= previous.min_points) {
            showError(`${next[index].level} must need more points than ${previous.level} (more than ${fmt.format(previous.min_points)}).`, form.elements[next[index].level]);
            return;
          }
        }
        if (next.every((level, index) => level.min_points === levels[index].min_points)) {
          dirty.levels = false;
          K.toast("Nothing changed, so nothing was saved.");
          return;
        }

        // Explorer, Bronze, Silver, Gold, Platinum, in order.
        const values = { thresholds: next.slice(1).map((level) => level.min_points) };
        const down = totals ? movesDown(levels, next) : null;
        if (down && !down.total) {
          if (!(await save(values))) showError("The levels were not saved. Check your connection and try again.");
          return;
        }

        // Someone moves down (or totals couldn't be checked): ask first.
        const message = !down
          ? "Contributor totals couldn't load, so this can't show who would move down a level. Save anyway?"
          : `This moves ${K.plural(down.total, "contributor")} down a level (${down.moves.length === 1
            ? down.moves[0][0]
            : down.moves.map(([move, count]) => `${fmt.format(count)} ${move}`).join(", ")}). Save anyway?`;
        K.openDialog({
          title: "Save the new levels?",
          description: message,
          submitLabel: "Save anyway",
          submitIcon: "save",
          danger: true,
          returnFocus: submit,
          content: [el("p", { className: "nv-cell-sub", text: "Their points stay the same; only the level shown changes." })],
          onSubmit: async (_form, { showError: showDialogError }) => {
            const ok = await save(values);
            if (!ok) showDialogError("The levels were not saved. Check your connection and try again.");
            return ok;
          }
        });
      });
    });
    levelsPanel.replaceChildren(form);
  }

  // ---------- load ----------

  async function run() {
    const [settingsResult, totalsResult] = await Promise.allSettled([
      K.loadPointSettings({ fresh: true }),
      K.allRows(() => db.from("user_point_totals").select("user_id, total_points").order("user_id"))
    ]);
    totals = totalsResult.status === "fulfilled" ? totalsResult.value.map((row) => row.total_points || 0) : null;

    if (settingsResult.status === "fulfilled") {
      settings = settingsResult.value;
      if (settings.tiers.length !== K.POINT_TIER_NAMES.length || settings.levels.length !== K.LEVEL_NAMES.length) {
        const reason = new Error("Some point boxes or levels are missing from the database.");
        tiersPanel.replaceChildren(K.errorBox("Point settings are incomplete", reason));
        levelsPanel.replaceChildren(K.errorBox("Point settings are incomplete", reason));
        return [{ status: "rejected", reason }, totalsResult];
      }
      if (!dirty.tiers) renderTiers();
      if (!dirty.levels) renderLevels();
    } else if (!settings) {
      tiersPanel.replaceChildren(K.errorBox("Point boxes could not load", settingsResult.reason, () => view.load()));
      levelsPanel.replaceChildren(K.errorBox("Levels could not load", settingsResult.reason, () => view.load()));
    }
    return [settingsResult, totalsResult];
  }

  const view = K.createPage({ name: "Points & Levels", run });
});
