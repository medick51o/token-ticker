(function () {
  "use strict";

  /* ── Visit Counter Config ── */
  const COUNTER = {
    enabled: true,
    siteCode: "medick",
    publicHost: "medick51o.github.io",
    baseline: 0
  };

  const COUNTER_COPY_MEASURED_ONLY = "Measured visits: {measured}";

  const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const CREDIT_LINKS = {
    "Anderson Method": "https://github.com/medick51o/anderson-method",
    "Team Rocket Method": "https://github.com/medick51o/team-rocket-method",
    "BUILD-LOG-PUBLIC.md": "./BUILD-LOG-PUBLIC.md"
  };

  const CREDITS_TEXT =
    "Built by Medick (medick51o), with Grok Bot, Cursor, Claude Code,\n" +
    "Codex, Grok Build and Antigravity (Gemini).\n" +
    "Anderson Method (human↔model intent) · Team Rocket Method.\n" +
    "Process receipts: BUILD-LOG-PUBLIC.md.";

  const START_RATIO = 0.996;
  const ANIM_DURATION_MS = 950;

  let animState = {
    active: false,
    start: 0,
    lastRatio: START_RATIO,
    entries: [],
    detailConfigs: null
  };

  function isNonnegSafeInt(n) {
    return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  }

  function compactBillions(n) {
    return (n / 1e9).toFixed(2) + "B";
  }

  function compactMonthly(n) {
    if (n >= 100000000) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1000000) return (n / 1e6).toFixed(1) + "M";
    return fmtInt(n);
  }

  function fmtInt(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function parseMonthLabels(ym) {
    const parts = String(ym || "").split("-");
    if (parts.length === 2) {
      const yr = parseInt(parts[0], 10);
      const mIdx = parseInt(parts[1], 10);
      if (!isNaN(yr) && mIdx >= 1 && mIdx <= 12) {
        const shortLbl = MONTH_NAMES[mIdx - 1];
        return { shortLbl: shortLbl, fullLbl: shortLbl + " " + yr };
      }
    }
    return { shortLbl: String(ym || ""), fullLbl: String(ym || "") };
  }

  /**
   * Strictly validate ticker data JSON before rendering.
   * Enforces additive accounting, Grok-in-Cursor subset invariant,
   * and zero-estimate/uncounted-tool exclusion.
   */
  function validateTickerData(d) {
    if (!d || typeof d !== "object") return false;
    if (d.schema_version !== 2) return false;
    if (!isNonnegSafeInt(d.featured_total) || d.featured_total <= 0) return false;
    if (!d.components || typeof d.components !== "object") return false;

    const requiredKeys = ["claude_code", "codex_cli", "cursor", "earlier_recorded"];
    let sum = 0;
    for (let i = 0; i < requiredKeys.length; i++) {
      const comp = d.components[requiredKeys[i]];
      if (!comp || typeof comp !== "object") return false;
      if (!isNonnegSafeInt(comp.tokens)) return false;
      if (comp.source_kind === "estimated") return false;
      sum += comp.tokens;
    }
    if (sum !== d.featured_total) return false;

    const cursor = d.components.cursor;
    if (!cursor.subset || typeof cursor.subset !== "object") return false;
    if (!isNonnegSafeInt(cursor.subset.tokens)) return false;
    if (cursor.subset.included_in_parent !== true) return false;
    if (cursor.subset.never_added_twice !== true) return false;
    if (cursor.subset.tokens > cursor.tokens) return false;

    const bd = cursor.breakdown;
    if (!bd || typeof bd !== "object") return false;
    const partKeys = ["other_cloud", "other_cursor", "grok_bot"];
    let partSum = 0;
    for (let k = 0; k < partKeys.length; k++) {
      const part = bd[partKeys[k]];
      if (!part || typeof part !== "object") return false;
      if (!isNonnegSafeInt(part.tokens)) return false;
      if (part.included_in_parent !== true || part.never_added_twice !== true) return false;
      partSum += part.tokens;
    }
    if (partSum !== cursor.tokens) return false;
    if (bd.grok_bot.tokens !== cursor.subset.tokens) return false;

    if (Array.isArray(d.also_used)) {
      for (let j = 0; j < d.also_used.length; j++) {
        const item = d.also_used[j];
        if (!item || item.included_in_total !== false || item.tokens !== null) {
          return false;
        }
      }
    }

    if (!d.cli_summary || !isNonnegSafeInt(d.cli_summary.sessions_recorded)) return false;
    const expectedCliBank =
      d.components.claude_code.tokens +
      d.components.codex_cli.tokens +
      d.components.earlier_recorded.tokens;
    if (d.cli_summary.cli_bank_total !== expectedCliBank) return false;
    return true;
  }

  function renderCredits() {
    const el = document.getElementById("credits");
    if (!el) return;
    el.textContent = "";
    const parts = CREDITS_TEXT.split(/(Anderson Method|Team Rocket Method|BUILD-LOG-PUBLIC\.md)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (Object.prototype.hasOwnProperty.call(CREDIT_LINKS, part)) {
        const a = document.createElement("a");
        const href = CREDIT_LINKS[part];
        a.href = href;
        if (href.indexOf("https://") === 0) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        a.className = "credits-link";
        a.textContent = part;
        el.appendChild(a);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    }
  }

  function setSnapshotPill(el, prefix, boldText, suffix) {
    if (!el) return;
    el.textContent = "";
    el.appendChild(document.createTextNode(prefix));
    const strong = document.createElement("strong");
    strong.textContent = boldText;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(suffix));
  }

  function buildCounterEntries(d) {
    const c = d.components;
    return [
      ["odometer", d.featured_total],
      ["tool-grok", c.cursor.subset.tokens],
      ["tool-cursor", c.cursor.tokens],
      ["tool-claude", c.claude_code.tokens],
      ["tool-codex", c.codex_cli.tokens],
      ["tool-history", c.earlier_recorded.tokens]
    ];
  }

  function buildDetailConfigs(d) {
    const c = d.components;
    const cliDateLabel = d.cli_summary.as_of_label || "Nov 2, 2026";
    const cursorRangeLabel = c.cursor.snapshot_label || "Nov 7, 2026";
    return {
      total: d.featured_total,
      contextCaption:
        d.context_caption ||
        fmtInt(d.featured_total) + " tokens across Claude Code, ChatGPT, Cursor and earlier usage",
      claude: {
        compactId: "tool-claude",
        detailId: "claude-detail",
        target: c.claude_code.tokens,
        suffix: " tokens · " + (c.claude_code.snapshot_label || "CLI bank " + cliDateLabel)
      },
      codex: {
        compactId: "tool-codex",
        detailId: "codex-detail",
        target: c.codex_cli.tokens,
        suffix: " tokens · " + (c.codex_cli.snapshot_label || "Codex CLI logs · " + cliDateLabel)
      },
      cursor: {
        compactId: "tool-cursor",
        detailId: "cursor-detail",
        target: c.cursor.tokens,
        suffix: " tokens · " + cursorRangeLabel
      },
      grok: {
        compactId: "tool-grok",
        detailId: "grok-detail",
        target: c.cursor.subset.tokens,
        suffix: " tokens · included in Cursor"
      },
      history: {
        compactId: "tool-history",
        detailId: "history-detail",
        target: c.earlier_recorded.tokens,
        suffix: " tokens · " + (c.earlier_recorded.snapshot_label || "carried in " + cliDateLabel + " CLI bank")
      }
    };
  }

  function renderAnimatedFrame(ratio, isFinal, detailConfigs) {
    const keys = ["claude", "codex", "cursor", "history"];
    let curTotal = 0;
    for (let i = 0; i < keys.length; i++) {
      const cfg = detailConfigs[keys[i]];
      const val = isFinal ? cfg.target : Math.floor(cfg.target * ratio);
      curTotal += val;
      const compactEl = document.getElementById(cfg.compactId);
      if (compactEl) compactEl.textContent = compactBillions(val);
      const detailEl = document.getElementById(cfg.detailId);
      if (detailEl) detailEl.textContent = fmtInt(val) + cfg.suffix;
    }

    const grokCfg = detailConfigs.grok;
    const grokVal = isFinal ? grokCfg.target : Math.floor(grokCfg.target * ratio);
    const grokCompact = document.getElementById(grokCfg.compactId);
    if (grokCompact) grokCompact.textContent = compactBillions(grokVal);
    const grokDetail = document.getElementById(grokCfg.detailId);
    if (grokDetail) grokDetail.textContent = fmtInt(grokVal) + grokCfg.suffix;

    const heroVal = isFinal ? detailConfigs.total : curTotal;
    const odometerEl = document.getElementById("odometer");
    if (odometerEl) odometerEl.textContent = compactBillions(heroVal);
    const contextEl = document.getElementById("usage-context");
    if (contextEl) {
      contextEl.textContent = isFinal
        ? detailConfigs.contextCaption
        : fmtInt(heroVal) + " tokens across Claude Code, ChatGPT, Cursor and earlier usage";
    }
  }

  function bindMonthlyBarButton(btn, fullLbl, tok, readoutEl, barsContainer) {
    if (!btn || typeof btn.addEventListener !== "function") return;

    function activate() {
      if (barsContainer && barsContainer.children) {
        for (let i = 0; i < barsContainer.children.length; i++) {
          const sib = barsContainer.children[i];
          if (sib && sib.classList) sib.classList.remove("is-active");
        }
      }
      if (btn.classList) btn.classList.add("is-active");
      if (readoutEl) {
        readoutEl.textContent = fullLbl + " · " + compactMonthly(tok) + " (" + fmtInt(tok) + " tokens)";
      }
    }

    function deactivate() {
      if (btn.classList) btn.classList.remove("is-active");
      if (readoutEl) {
        const def = readoutEl.getAttribute("data-default");
        if (def) readoutEl.textContent = def;
      }
    }

    btn.addEventListener("pointerenter", activate);
    btn.addEventListener("focus", activate);
    btn.addEventListener("click", activate);
    btn.addEventListener("pointerleave", deactivate);
    btn.addEventListener("blur", deactivate);
  }

  function updateMonthlyStrip(d) {
    const stripEl = document.getElementById("monthly-strip");
    const readoutEl = document.getElementById("monthly-readout");
    const barsEl = document.getElementById("monthly-bars");
    if (!stripEl || !readoutEl || !barsEl) return;

    const monthly = d.cli_summary && Array.isArray(d.cli_summary.monthly) ? d.cli_summary.monthly : [];
    barsEl.style.display = "";
    if (!monthly.length) {
      readoutEl.textContent = "—";
      barsEl.textContent = "";
      return;
    }

    let maxTok = 0;
    let peakIdx = 0;
    for (let i = 0; i < monthly.length; i++) {
      const t = isNonnegSafeInt(monthly[i].tokens) ? monthly[i].tokens : 0;
      if (t > maxTok) {
        maxTok = t;
        peakIdx = i;
      }
    }

    const peakMeta = parseMonthLabels(monthly[peakIdx].month);
    const peakTok = isNonnegSafeInt(monthly[peakIdx].tokens) ? monthly[peakIdx].tokens : 0;
    const defaultReadout =
      "Peak: " + peakMeta.fullLbl + " · " + compactMonthly(peakTok) + " (" + fmtInt(peakTok) + " tokens)";
    readoutEl.setAttribute("data-default", defaultReadout);
    readoutEl.textContent = defaultReadout;

    barsEl.textContent = "";
    for (let j = 0; j < monthly.length; j++) {
      const entry = monthly[j];
      const tok = isNonnegSafeInt(entry.tokens) ? entry.tokens : 0;
      const lbls = parseMonthLabels(entry.month);
      const pct = maxTok > 0 ? (tok / maxTok) * 100 : 0;

      const btn = document.createElement("button");
      btn.setAttribute("type", "button");
      btn.className = j === peakIdx ? "m-bar is-peak" : "m-bar";
      btn.setAttribute("data-month", lbls.fullLbl);
      btn.setAttribute("data-tokens", String(tok));
      btn.setAttribute("aria-label", lbls.fullLbl + ": " + fmtInt(tok) + " tokens");

      const valSpan = document.createElement("span");
      valSpan.className = "m-val";
      valSpan.textContent = compactMonthly(tok);

      const trackSpan = document.createElement("span");
      trackSpan.className = "m-track";

      const fillSpan = document.createElement("span");
      fillSpan.className = "m-fill";
      fillSpan.style.height = pct.toFixed(2) + "%";
      trackSpan.appendChild(fillSpan);

      const lblSpan = document.createElement("span");
      lblSpan.className = "m-lbl";
      lblSpan.textContent = lbls.shortLbl;

      btn.appendChild(valSpan);
      btn.appendChild(trackSpan);
      btn.appendChild(lblSpan);
      bindMonthlyBarButton(btn, lbls.fullLbl, tok, readoutEl, barsEl);
      barsEl.appendChild(btn);
    }
  }

  function updateDomMetadata(d) {
    const c = d.components;
    const claude = c.claude_code.tokens;
    const codex = c.codex_cli.tokens;
    const cursor = c.cursor.tokens;
    const grok = c.cursor.subset.tokens;
    const otherCloud = c.cursor.breakdown.other_cloud.tokens;
    const otherCursor = c.cursor.breakdown.other_cursor.tokens;
    const history = c.earlier_recorded.tokens;
    const total = d.featured_total;
    const cliBankTotal = d.cli_summary.cli_bank_total;
    const cliDateLabel = d.cli_summary.as_of_label || "Nov 2, 2026";
    const cursorRangeLabel = c.cursor.snapshot_label || "Nov 7, 2026";

    const contextEl = document.getElementById("usage-context");
    if (contextEl && d.context_caption) {
      contextEl.textContent = d.context_caption;
    }

    const statusEl = document.getElementById("odometer-status");
    if (statusEl) {
      statusEl.textContent = fmtInt(total) + " tokens across Claude Code, ChatGPT, Cursor and earlier usage";
    }

    setSnapshotPill(
      document.getElementById("cli-bank-pill"),
      "CLI bank: ",
      fmtInt(cliBankTotal),
      " as of " + cliDateLabel + " · " + fmtInt(d.cli_summary.sessions_recorded) + " sessions"
    );
    setSnapshotPill(
      document.getElementById("cursor-bank-pill"),
      "Cursor export: ",
      fmtInt(cursor),
      " (" + cursorRangeLabel + ")"
    );

    const rowUpdates = [
      ["row-claude", claude, "Claude Code, " + fmtInt(claude) + " tokens"],
      ["row-codex", codex, "ChatGPT, " + fmtInt(codex) + " tokens"],
      ["row-cursor", cursor, "Cursor, " + fmtInt(cursor) + " tokens"],
      ["row-history", history, "Earlier recorded usage, " + fmtInt(history) + " tokens"]
    ];
    rowUpdates.forEach(function (item) {
      const row = document.getElementById(item[0]);
      if (row) {
        const sharePct = total > 0 ? ((item[1] / total) * 100).toFixed(4) : "0.0000";
        row.setAttribute("data-component", String(item[1]));
        row.setAttribute("aria-label", item[2]);
        row.setAttribute("style", "--share:" + sharePct + "%");
      }
    });

    const breakdownEl = document.getElementById("cursor-breakdown");
    if (breakdownEl) {
      breakdownEl.setAttribute(
        "aria-label",
        "Cursor parts: Other cloud " +
          fmtInt(otherCloud) +
          ", Other Cursor " +
          fmtInt(otherCursor) +
          ", Grok Bot " +
          fmtInt(grok) +
          "; sum equals Cursor " +
          fmtInt(cursor) +
          ", not added again"
      );
    }

    const detailUpdates = {
      "claude-detail": fmtInt(claude) + " tokens · " + (c.claude_code.snapshot_label || "CLI bank " + cliDateLabel),
      "codex-detail": fmtInt(codex) + " tokens · " + (c.codex_cli.snapshot_label || "Codex CLI logs · " + cliDateLabel),
      "cursor-detail": fmtInt(cursor) + " tokens · " + cursorRangeLabel,
      "grok-detail": fmtInt(grok) + " tokens · included in Cursor",
      "history-detail": fmtInt(history) + " tokens · " + (c.earlier_recorded.snapshot_label || "carried in " + cliDateLabel + " CLI bank"),
      "cursor-parts-sum": fmtInt(cursor),
      "cursor-part-cloud": fmtInt(otherCloud),
      "cursor-part-other": fmtInt(otherCursor),
      "cursor-part-grok": fmtInt(grok)
    };
    Object.keys(detailUpdates).forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.textContent = detailUpdates[id];
    });

    updateMonthlyStrip(d);

    const methodNote = document.getElementById("method-note");
    if (methodNote && d.methodology && d.methodology.summary) {
      methodNote.textContent = d.methodology.summary;
    }

    const statsEl = document.getElementById("stats");
    if (statsEl) {
      statsEl.textContent = fmtInt(d.cli_summary.sessions_recorded) + " CLI sessions recorded.";
    }

    const barEl = document.getElementById("usage-bar");
    if (barEl) {
      barEl.setAttribute("aria-hidden", "false");
      barEl.style.opacity = "";
      barEl.setAttribute(
        "aria-label",
        "Combined snapshots: Claude Code " +
          fmtInt(claude) +
          "; ChatGPT " +
          fmtInt(codex) +
          "; Cursor " +
          fmtInt(cursor) +
          " including Grok Bot " +
          fmtInt(grok) +
          " as a subset; Earlier recorded usage " +
          fmtInt(history)
      );
      const partMap = {
        claude: claude,
        codex: codex,
        cursor: cursor,
        history: history
      };
      Object.keys(partMap).forEach(function (k) {
        const partNode = document.getElementById("bar-" + k);
        if (partNode) {
          partNode.style.display = "";
          partNode.style.flex = String(partMap[k]);
        }
      });
      const subsetBar = document.getElementById("bar-grok-subset");
      if (subsetBar && cursor > 0) {
        subsetBar.style.display = "";
        subsetBar.style.width = ((grok / cursor) * 100).toFixed(12) + "%";
      }
    }
  }

  function applySnapshotToDom(d, options) {
    const inPlace = Boolean(options && options.inPlace);
    updateDomMetadata(d);

    const entries = buildCounterEntries(d);
    const detailConfigs = buildDetailConfigs(d);
    const barEl = document.getElementById("usage-bar");
    const reduced = isReducedMotion();

    if (inPlace) {
      if (animState.active) {
        animState.entries = entries;
        animState.detailConfigs = detailConfigs;
        renderAnimatedFrame(animState.lastRatio, false, detailConfigs);
      } else {
        renderAnimatedFrame(1, true, detailConfigs);
        if (barEl) barEl.style.clipPath = "inset(0 0% 0 0)";
      }
      return;
    }

    entries.forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (!el) throw new Error("Missing measured display: " + pair[0]);
    });

    if (reduced || typeof requestAnimationFrame !== "function") {
      animState.active = false;
      renderAnimatedFrame(1, true, detailConfigs);
      if (barEl) barEl.style.clipPath = "inset(0 0% 0 0)";
      return;
    }

    animState.active = true;
    animState.start = performance.now();
    animState.lastRatio = START_RATIO;
    animState.entries = entries;
    animState.detailConfigs = detailConfigs;

    if (barEl) barEl.style.clipPath = "inset(0 0.4% 0 0)";
    renderAnimatedFrame(START_RATIO, false, detailConfigs);

    function frame(now) {
      if (!animState.active) return;
      if (isReducedMotion()) {
        animState.active = false;
        renderAnimatedFrame(1, true, animState.detailConfigs);
        if (barEl) barEl.style.clipPath = "inset(0 0% 0 0)";
        return;
      }
      const t = Math.max(0, Math.min(1, (now - animState.start) / ANIM_DURATION_MS));
      const eased = 1 - Math.pow(1 - t, 3);
      const ratio = START_RATIO + (1 - START_RATIO) * eased;
      animState.lastRatio = ratio;
      renderAnimatedFrame(ratio, t === 1, animState.detailConfigs);
      if (barEl) {
        barEl.style.clipPath =
          t === 1 ? "inset(0 0% 0 0)" : "inset(0 " + (0.4 * (1 - eased)).toFixed(4) + "% 0 0)";
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        animState.active = false;
      }
    }

    requestAnimationFrame(frame);
  }

  function snapshotChanged(a, b) {
    if (!a || !b) return true;
    if (a.featured_total !== b.featured_total) return true;
    if (a.generated_at !== b.generated_at) return true;
    const ac = a.components;
    const bc = b.components;
    return (
      ac.claude_code.tokens !== bc.claude_code.tokens ||
      ac.codex_cli.tokens !== bc.codex_cli.tokens ||
      ac.cursor.tokens !== bc.cursor.tokens ||
      ac.cursor.subset.tokens !== bc.cursor.subset.tokens ||
      ac.cursor.breakdown.other_cloud.tokens !== bc.cursor.breakdown.other_cloud.tokens ||
      ac.cursor.breakdown.other_cursor.tokens !== bc.cursor.breakdown.other_cursor.tokens ||
      ac.earlier_recorded.tokens !== bc.earlier_recorded.tokens ||
      a.cli_summary.sessions_recorded !== b.cli_summary.sessions_recorded
    );
  }

  function failClosed() {
    animState.active = false;
    window.__tickerData = null;

    const blankIds = [
      "odometer",
      "tool-grok",
      "tool-cursor",
      "tool-claude",
      "tool-codex",
      "tool-history",
      "claude-detail",
      "codex-detail",
      "cursor-detail",
      "grok-detail",
      "history-detail",
      "cursor-parts-sum",
      "cursor-part-cloud",
      "cursor-part-other",
      "cursor-part-grok",
      "monthly-readout",
      "stats"
    ];
    blankIds.forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.textContent = "—";
    });

    const monthlyBars = document.getElementById("monthly-bars");
    if (monthlyBars) {
      monthlyBars.textContent = "";
      monthlyBars.style.display = "none";
    }

    const status = document.getElementById("odometer-status");
    if (status) status.textContent = "Snapshot integrity check failed";

    const contextEl = document.getElementById("usage-context");
    if (contextEl) contextEl.textContent = "Measured snapshot unavailable (integrity check failed).";

    const cliPill = document.getElementById("cli-bank-pill");
    if (cliPill) cliPill.textContent = "CLI bank: —";

    const cursorPill = document.getElementById("cursor-bank-pill");
    if (cursorPill) cursorPill.textContent = "Cursor export: —";

    const methodNote = document.getElementById("method-note");
    if (methodNote) methodNote.textContent = "Snapshot integrity check failed; measured counts withheld.";

    const breakdownEl = document.getElementById("cursor-breakdown");
    if (breakdownEl) breakdownEl.setAttribute("aria-label", "Cursor breakdown unavailable");

    ["row-claude", "row-codex", "row-cursor", "row-history"].forEach(function (rowId) {
      const row = document.getElementById(rowId);
      if (row) {
        if (typeof row.removeAttribute === "function") {
          row.removeAttribute("data-component");
          row.removeAttribute("style");
        }
        row.setAttribute("aria-label", "Unavailable (integrity check failed)");
      }
    });

    const barEl = document.getElementById("usage-bar");
    if (barEl) {
      barEl.setAttribute("aria-label", "Snapshot integrity check failed");
      barEl.setAttribute("aria-hidden", "true");
      barEl.style.opacity = "0.25";
    }
    ["bar-claude", "bar-codex", "bar-cursor", "bar-history"].forEach(function (partId) {
      const part = document.getElementById(partId);
      if (part) {
        part.style.flex = "0";
        part.style.display = "none";
      }
    });
    const subsetBar = document.getElementById("bar-grok-subset");
    if (subsetBar) {
      subsetBar.style.width = "0%";
      subsetBar.style.display = "none";
    }
  }

  function loadAndRenderData() {
    let fallbackData = null;
    try {
      const fallbackEl = document.getElementById("ticker-data-fallback");
      if (fallbackEl) {
        const parsed = JSON.parse(fallbackEl.textContent);
        if (validateTickerData(parsed)) {
          fallbackData = parsed;
        }
      }
    } catch (e) {
      fallbackData = null;
    }

    if (fallbackData) {
      window.__tickerData = fallbackData;
      applySnapshotToDom(fallbackData, { inPlace: false });
    } else {
      failClosed();
    }

    const isHttp =
      typeof window !== "undefined" &&
      window.location &&
      (window.location.protocol === "http:" || window.location.protocol === "https:");

    if (isHttp && typeof fetch === "function") {
      fetch("./data/ticker.json", { cache: "no-store" })
        .then(function (res) {
          if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "err"));
          return res.json();
        })
        .then(function (data) {
          if (!validateTickerData(data)) {
            if (!fallbackData) failClosed();
            return;
          }
          if (!fallbackData) {
            window.__tickerData = data;
            applySnapshotToDom(data, { inPlace: false });
            return;
          }
          if (snapshotChanged(window.__tickerData, data)) {
            window.__tickerData = data;
            applySnapshotToDom(data, { inPlace: true });
          }
        })
        .catch(function () {
          if (!fallbackData) failClosed();
        });
    }
  }

  /* ── GoatCounter credential-free visit counter ── */
  function counterIsLive() {
    if (COUNTER.enabled !== true) return false;
    if (typeof COUNTER.siteCode !== "string") return false;
    const code = COUNTER.siteCode.trim();
    if (!code) return false;
    return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(code);
  }

  function isPublicHost() {
    return (
      typeof window !== "undefined" &&
      Boolean(window.location) &&
      window.location.protocol === "https:" &&
      window.location.hostname === COUNTER.publicHost
    );
  }

  function parseGoatCount(raw) {
    if (typeof raw === "number") {
      return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
    }
    if (typeof raw !== "string") return null;
    if (/^\d{1,15}$/.test(raw)) {
      const n = Number(raw);
      return Number.isSafeInteger(n) && n >= 0 ? n : null;
    }
    if (/^\d{1,3}(,\d{3})*$/.test(raw)) {
      const n2 = Number(raw.replace(/,/g, ""));
      return Number.isSafeInteger(n2) && n2 >= 0 ? n2 : null;
    }
    return null;
  }

  function visitCopy(measured) {
    return COUNTER_COPY_MEASURED_ONLY.replace("{measured}", fmtInt(measured));
  }

  function renderVisitStrip(measured) {
    try {
      if (document.getElementById("visit-counter")) return;
      const stats = document.getElementById("stats");
      if (!stats || !stats.parentNode) return;
      const el = document.createElement("p");
      el.id = "visit-counter";
      el.className = "visit-counter";
      el.setAttribute("role", "note");
      el.textContent = visitCopy(measured);
      stats.insertAdjacentElement("afterend", el);
    } catch (e) {
      /* silent */
    }
  }

  function appendHonestNetworkSentence() {
    const honest = document.querySelector("p.honest");
    if (!honest) return;
    const marker = "visit counter";
    if ((honest.textContent || "").indexOf(marker) !== -1) return;
    honest.appendChild(
      document.createTextNode(
        " On the public site, third-party requests go only to the visit counter (no cookies sent from this page, referrer omitted)."
      )
    );
  }

  function readVisitTotal(code, path) {
    if (typeof fetch !== "function") return;
    const pathKey = path === "/" ? "/" : path.charAt(0) === "/" ? path.slice(1) : path;
    const primaryUrl = "https://" + code + ".goatcounter.com/counter/" + pathKey + ".json";
    const altUrl = "https://" + code + ".goatcounter.com/counter/.json";

    function attempt(url, allowAlt) {
      fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store"
      })
        .then(function (res) {
          if (!res || !res.ok) {
            if (allowAlt) attempt(altUrl, false);
            return null;
          }
          return res.json();
        })
        .then(function (data) {
          if (!data) {
            if (allowAlt) attempt(altUrl, false);
            return;
          }
          const n = parseGoatCount(data.count);
          if (n === null) {
            if (allowAlt) attempt(altUrl, false);
            return;
          }
          renderVisitStrip(n);
        })
        .catch(function () {
          if (allowAlt) attempt(altUrl, false);
        });
    }

    attempt(primaryUrl, true);
  }

  function bootVisitCounter() {
    if (!counterIsLive()) return;
    const code = COUNTER.siteCode.trim();
    const path = "/";

    try {
      appendHonestNetworkSentence();
    } catch (e) {
      /* silent */
    }

    if (!isPublicHost() || typeof fetch !== "function") return;
    const countUrl = "https://" + code + ".goatcounter.com/count?p=" + encodeURIComponent(path);
    try {
      fetch(countUrl, {
        method: "GET",
        mode: "no-cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        keepalive: true
      })
        .then(function () {
          setTimeout(function () {
            readVisitTotal(code, path);
          }, 300);
        })
        .catch(function () {
          /* silent */
        });
    } catch (e) {
      /* silent */
    }
  }

  function isReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function bootTickerInteractions() {
    const tickerEl = document.getElementById("ticker");
    if (!tickerEl || typeof tickerEl.setAttribute !== "function") return;

    const pairs = [
      ["bar-claude", "claude"],
      ["bar-codex", "codex"],
      ["bar-cursor", "cursor"],
      ["bar-grok-subset", "grok"],
      ["bar-history", "history"],
      ["row-claude", "claude"],
      ["row-codex", "codex"],
      ["row-cursor", "cursor"],
      ["row-grok-subset", "grok"],
      ["row-history", "history"]
    ];

    function setFocusTool(toolName) {
      if (toolName) {
        tickerEl.setAttribute("data-focus-tool", toolName);
      } else if (typeof tickerEl.removeAttribute === "function") {
        tickerEl.removeAttribute("data-focus-tool");
      }
    }

    for (let i = 0; i < pairs.length; i++) {
      const id = pairs[i][0];
      const tool = pairs[i][1];
      const el = document.getElementById(id);
      if (!el || typeof el.addEventListener !== "function") continue;
      el.addEventListener("pointerenter", function (ev) {
        if (tool === "grok" && ev && typeof ev.stopPropagation === "function") {
          ev.stopPropagation();
        }
        setFocusTool(tool);
      });
      el.addEventListener("pointerleave", function (ev) {
        if (tool === "grok" && id === "row-grok-subset") {
          setFocusTool("cursor");
          if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
          return;
        }
        setFocusTool(null);
      });
    }
  }

  let bgCanvasController = null;

  function bootScrollReveals() {
    if (
      typeof document.querySelectorAll !== "function" ||
      !document.documentElement ||
      !document.documentElement.classList ||
      isReducedMotion() ||
      typeof IntersectionObserver !== "function"
    ) {
      return;
    }

    const targets = document.querySelectorAll(".rv");
    if (!targets || !targets.length) return;

    document.documentElement.classList.add("rv-ready");
    const vh = window.innerHeight || 800;
    for (let i = 0; i < targets.length; i++) {
      const rect = targets[i].getBoundingClientRect ? targets[i].getBoundingClientRect() : null;
      if (rect && rect.top < vh * 0.94) {
        targets[i].classList.add("on");
      }
    }

    const observer = new IntersectionObserver(
      function (entries) {
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            entries[i].target.classList.add("on");
            observer.unobserve(entries[i].target);
          }
        }
      },
      { threshold: 0.08 }
    );

    for (let j = 0; j < targets.length; j++) {
      if (!targets[j].classList.contains("on")) {
        observer.observe(targets[j]);
      }
    }
  }

  function makeGlowSprite(c) {
    const size = 64;
    const off = document.createElement("canvas");
    if (!off || typeof off.getContext !== "function") return null;
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    if (!octx) return null;
    const half = size / 2;
    const grad = octx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, "rgba(" + c.r + "," + c.g + "," + c.b + ",0.46)");
    grad.addColorStop(0.42, "rgba(" + c.r + "," + c.g + "," + c.b + ",0.14)");
    grad.addColorStop(1, "rgba(" + c.r + "," + c.g + "," + c.b + ",0)");
    octx.fillStyle = grad;
    octx.fillRect(0, 0, size, size);
    return off;
  }

  function bootBackgroundCanvas() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas || typeof canvas.getContext !== "function") return null;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;

    const COLORS = [
      { r: 245, g: 185, b: 144 }, // Claude coral
      { r: 132, g: 232, b: 194 }, // Codex emerald
      { r: 204, g: 198, b: 255 }, // Cursor periwinkle
      { r: 247, g: 173, b: 216 }, // Grok magenta
      { r: 96, g: 165, b: 250 },  // Gemini sky
      { r: 251, g: 191, b: 36 }   // Local amber
    ];

    const glowSprites = COLORS.map(makeGlowSprite);

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes = [];
    let pulses = [];
    let rafId = 0;
    let paused = Boolean(document.hidden);
    let reduced = isReducedMotion();
    let lastTime = 0;
    let targetPointerX = 0.5;
    let targetPointerY = 0.35;
    let smoothPointerX = 0.5;
    let smoothPointerY = 0.35;
    let targetScroll = 0;
    let smoothScroll = 0;

    function seedNodes() {
      const compact = width <= 650;
      const count = compact ? 22 : 42;
      nodes = [];
      for (let i = 0; i < count; i++) {
        const colorIdx = i % COLORS.length;
        const c = COLORS[colorIdx];
        const angle = (i * 2.39996) % (Math.PI * 2);
        const speed = 9 + (i % 5) * 4.2;
        nodes.push({
          x: ((i * 73 + 19) % 100) * 0.01 * width,
          y: ((i * 41 + 11) % 100) * 0.01 * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: compact ? 1.8 + (i % 3) * 0.75 : 2.0 + (i % 4) * 0.85,
          glow: compact ? 18 + (i % 3) * 6 : 24 + (i % 4) * 8,
          phase: i * 0.9,
          color: c,
          sprite: glowSprites[colorIdx]
        });
      }
      pulses = [];
      const pulseCount = compact ? 5 : 9;
      for (let p = 0; p < pulseCount; p++) {
        pulses.push({
          from: p % count,
          to: (p * 5 + 3) % count,
          t: (p * 0.17) % 1,
          speed: 0.22 + (p % 3) * 0.08
        });
      }
    }

    function resize() {
      width = window.innerWidth || 1280;
      height = window.innerHeight || 800;
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedNodes();
      if (reduced || paused) {
        drawFrame(0, 0);
      }
    }

    function drawFrame(dt, elapsed) {
      ctx.clearRect(0, 0, width, height);

      if (dt > 0 && !reduced) {
        const springLerp = Math.min(1, dt * 5.2);
        smoothPointerX += (targetPointerX - smoothPointerX) * springLerp;
        smoothPointerY += (targetPointerY - smoothPointerY) * springLerp;
        smoothScroll += (targetScroll - smoothScroll) * springLerp;
      }

      const linkDist = width <= 650 ? 135 : 180;
      const linkDistSq = linkDist * linkDist;
      const ox = reduced ? 0 : (smoothPointerX - 0.5) * 20;
      const oy = reduced ? 0 : (smoothPointerY - 0.5) * 15 - smoothScroll * 28;

      if (dt > 0 && !reduced) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          n.x += n.vx * dt;
          n.y += n.vy * dt;
          if (n.x < -30) n.x = width + 30;
          else if (n.x > width + 30) n.x = -30;
          if (n.y < -30) n.y = height + 30;
          else if (n.y > height + 30) n.y = -30;
        }
      }

      // Draw glowing constellation links
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ax = a.x + ox * (0.4 + (i % 3) * 0.2);
        const ay = a.y + oy * (0.4 + (i % 3) * 0.2);
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const bx = b.x + ox * (0.4 + (j % 3) * 0.2);
          const by = b.y + oy * (0.4 + (j % 3) * 0.2);
          const dx = ax - bx;
          const dy = ay - by;
          const dSq = dx * dx + dy * dy;
          if (dSq < linkDistSq) {
            const alpha = (1 - Math.sqrt(dSq) / linkDist) * 0.22;
            ctx.strokeStyle =
              "rgba(" + a.color.r + "," + a.color.g + "," + a.color.b + "," + alpha.toFixed(3) + ")";
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
      }

      // Draw travelling light pulses with comet trails between paired nodes
      if (!reduced) {
        for (let p = 0; p < pulses.length; p++) {
          const pulse = pulses[p];
          if (dt > 0) {
            pulse.t += pulse.speed * dt;
            if (pulse.t >= 1) {
              pulse.t = 0;
              pulse.from = pulse.to;
              pulse.to = (pulse.to + 3 + (p % 5)) % nodes.length;
            }
          }
          const na = nodes[pulse.from];
          const nb = nodes[pulse.to];
          const px = na.x + (nb.x - na.x) * pulse.t + ox * 0.6;
          const py = na.y + (nb.y - na.y) * pulse.t + oy * 0.6;
          const tailT = Math.max(0, pulse.t - 0.08);
          const tx = na.x + (nb.x - na.x) * tailT + ox * 0.6;
          const ty = na.y + (nb.y - na.y) * tailT + oy * 0.6;

          ctx.strokeStyle = "rgba(" + nb.color.r + "," + nb.color.g + "," + nb.color.b + ",0.35)";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(px, py);
          ctx.stroke();

          if (nb.sprite) {
            ctx.drawImage(nb.sprite, px - 13, py - 13, 26, 26);
          }
          ctx.fillStyle = "rgba(255,250,242,0.9)";
          ctx.beginPath();
          ctx.arc(px, py, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw luminous glowing nodes via cached sprites
      for (let k = 0; k < nodes.length; k++) {
        const node = nodes[k];
        const nx = node.x + ox * (0.4 + (k % 3) * 0.2);
        const ny = node.y + oy * (0.4 + (k % 3) * 0.2);
        const pulseScale = reduced ? 1 : 0.88 + 0.16 * Math.sin(elapsed * 1.4 + node.phase);
        const glowR = node.glow * pulseScale;
        const c = node.color;

        if (node.sprite) {
          ctx.drawImage(node.sprite, nx - glowR, ny - glowR, glowR * 2, glowR * 2);
        }

        ctx.fillStyle = "rgba(" + c.r + "," + c.g + "," + c.b + ",0.92)";
        ctx.beginPath();
        ctx.arc(nx, ny, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function step(now) {
      if (paused || reduced) {
        rafId = 0;
        return;
      }
      if (!lastTime) lastTime = now;
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      drawFrame(dt, now * 0.001);
      rafId = requestAnimationFrame(step);
    }

    resize();

    if (typeof window.addEventListener === "function") {
      window.addEventListener("resize", resize, { passive: true });
      window.addEventListener(
        "pointermove",
        function (ev) {
          if (!reduced && width > 0 && height > 0) {
            targetPointerX = Math.max(0, Math.min(1, ev.clientX / width));
            targetPointerY = Math.max(0, Math.min(1, ev.clientY / height));
          }
        },
        { passive: true }
      );
      window.addEventListener(
        "scroll",
        function () {
          if (!reduced) {
            const maxScroll = Math.max(1, (document.documentElement.scrollHeight || 1) - height);
            targetScroll = Math.max(0, Math.min(1, (window.scrollY || 0) / maxScroll));
          }
        },
        { passive: true }
      );
    }

    if (typeof window.matchMedia === "function") {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mql && typeof mql.addEventListener === "function") {
        mql.addEventListener("change", function (ev) {
          reduced = Boolean(ev.matches);
          if (reduced) {
            if (rafId && typeof cancelAnimationFrame === "function") {
              cancelAnimationFrame(rafId);
              rafId = 0;
            }
            if (document.documentElement && document.documentElement.classList) {
              document.documentElement.classList.remove("rv-ready");
            }
            drawFrame(0, 0);
          } else if (!paused && !rafId && typeof requestAnimationFrame === "function") {
            lastTime = 0;
            rafId = requestAnimationFrame(step);
          }
        });
      }
    }

    if (!reduced && !paused && typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(step);
    } else {
      drawFrame(0, 0);
    }

    return {
      setPaused: function (nextPaused) {
        paused = Boolean(nextPaused);
        if (paused) {
          if (rafId && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          lastTime = 0;
        } else if (!reduced && !rafId && typeof requestAnimationFrame === "function") {
          lastTime = 0;
          rafId = requestAnimationFrame(step);
        }
      }
    };
  }

  function bootVisibilityPause() {
    if (typeof document.visibilityState !== "string" || typeof document.addEventListener !== "function") {
      return;
    }

    function syncVisibility() {
      const hidden = Boolean(document.hidden);
      if (document.documentElement && document.documentElement.classList) {
        document.documentElement.classList.toggle("tab-hidden", hidden);
      }
      if (bgCanvasController) {
        bgCanvasController.setPaused(hidden);
      }
      if (!hidden && animState.active && animState.detailConfigs) {
        const elapsed = performance.now() - animState.start;
        if (elapsed >= ANIM_DURATION_MS) {
          animState.active = false;
          renderAnimatedFrame(1, true, animState.detailConfigs);
          const barEl = document.getElementById("usage-bar");
          if (barEl) barEl.style.clipPath = "inset(0 0% 0 0)";
        }
      }
    }

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
  }

  function boot() {
    loadAndRenderData();
    bootTickerInteractions();
    bootVisitCounter();
    renderCredits();
    bootScrollReveals();
    bgCanvasController = bootBackgroundCanvas();
    bootVisibilityPause();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
