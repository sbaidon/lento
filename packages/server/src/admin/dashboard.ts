export function renderAdminDashboardHtml(pushIntervalMs = 4000): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lento Internal Control Room</title>
    <style>
      :root {
        --paper: #f4efe6;
        --ink: #121212;
        --ink-soft: rgba(18, 18, 18, 0.72);
        --line: rgba(18, 18, 18, 0.14);
        --signal: #d74f2a;
        --trust: #0f8a5f;
        --warn: #8a2d17;
        --panel: rgba(255, 255, 255, 0.54);
        --shadow: 0 18px 40px rgba(40, 21, 10, 0.08);
        --radius: 22px;
        --mono:
          "SFMono-Regular", "Menlo", "Monaco", "Cascadia Mono", "Segoe UI Mono",
          monospace;
        --serif:
          "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "URW Palladio L",
          "Georgia", serif;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, rgba(215, 79, 42, 0.16), transparent 32%),
          radial-gradient(circle at top right, rgba(15, 138, 95, 0.12), transparent 28%),
          linear-gradient(180deg, #f8f3eb 0%, #efe6d8 100%);
        color: var(--ink);
        font-family: var(--mono);
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(18, 18, 18, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(18, 18, 18, 0.04) 1px, transparent 1px);
        background-size: 28px 28px;
        mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.4), transparent 88%);
      }

      .shell {
        max-width: 1600px;
        margin: 0 auto;
        padding: 24px;
      }

      .masthead {
        position: relative;
        overflow: hidden;
        padding: 28px 30px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.42)),
          linear-gradient(120deg, rgba(215, 79, 42, 0.08), transparent 55%);
        box-shadow: var(--shadow);
      }

      .masthead::after {
        content: "";
        position: absolute;
        inset: auto -8% -36% auto;
        width: 320px;
        height: 320px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(215, 79, 42, 0.18), transparent 66%);
        pointer-events: none;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--ink-soft);
      }

      .eyebrow::before {
        content: "";
        width: 42px;
        height: 1px;
        background: var(--signal);
      }

      h1 {
        margin: 14px 0 6px;
        font-family: var(--serif);
        font-size: clamp(2.6rem, 4vw, 4.6rem);
        line-height: 0.94;
        letter-spacing: -0.05em;
        max-width: 11ch;
      }

      .subhead {
        max-width: 58rem;
        margin: 0;
        color: var(--ink-soft);
        font-size: 0.95rem;
        line-height: 1.6;
      }

      .status-strip {
        margin-top: 18px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 13px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        font-size: 12px;
      }

      .pill strong { color: var(--signal); }

      .grid {
        display: grid;
        grid-template-columns: 1.15fr 0.95fr;
        gap: 18px;
        margin-top: 18px;
      }

      .stack, .detail-rail {
        display: grid;
        gap: 18px;
      }

      .panel {
        position: relative;
        overflow: hidden;
        border-radius: var(--radius);
        border: 1px solid var(--line);
        background: var(--panel);
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow);
      }

      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 20px 0;
      }

      .panel-title {
        margin: 0;
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.22em;
        color: var(--ink-soft);
      }

      .panel-body { padding: 16px 20px 20px; }

      .metrics {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 12px;
      }

      .metric {
        padding: 16px;
        border-radius: 18px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.46));
        border: 1px solid rgba(18, 18, 18, 0.08);
        min-height: 100px;
        transform: translateY(10px);
        opacity: 0;
        animation: rise 0.45s ease forwards;
      }

      .metric:nth-child(2) { animation-delay: 0.05s; }
      .metric:nth-child(3) { animation-delay: 0.1s; }
      .metric:nth-child(4) { animation-delay: 0.15s; }
      .metric:nth-child(5) { animation-delay: 0.2s; }
      .metric:nth-child(6) { animation-delay: 0.25s; }

      .metric-label {
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-soft);
      }

      .metric-value {
        margin-top: 16px;
        font-family: var(--serif);
        font-size: 2rem;
        line-height: 1;
        letter-spacing: -0.04em;
      }

      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }

      .controls input, .controls select, .controls button {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 10px 12px;
        font: inherit;
        background: rgba(255, 255, 255, 0.78);
        color: var(--ink);
      }

      .controls button {
        cursor: pointer;
        background: linear-gradient(180deg, #1b1b1b, #0f0f0f);
        color: #faf7f1;
      }

      .actors {
        display: grid;
        gap: 10px;
        max-height: 600px;
        overflow: auto;
        padding-right: 4px;
      }

      .actor-card {
        border: 1px solid rgba(18, 18, 18, 0.08);
        border-radius: 18px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.7);
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
        cursor: pointer;
      }

      .actor-card:hover,
      .actor-card.is-selected {
        transform: translateX(4px);
        border-color: rgba(215, 79, 42, 0.38);
        background: rgba(255, 250, 245, 0.92);
      }

      .actor-row, .content-row, .report-row, .interaction-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .actor-name { font-weight: 700; font-size: 0.95rem; }
      .muted { color: var(--ink-soft); }

      .trust-bar {
        margin-top: 10px;
        height: 8px;
        border-radius: 999px;
        background: rgba(18, 18, 18, 0.08);
        overflow: hidden;
      }

      .trust-bar > span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--signal), var(--trust));
      }

      .hero-actor {
        padding: 18px;
        border-radius: 20px;
        background:
          linear-gradient(145deg, rgba(18, 18, 18, 0.96), rgba(44, 29, 20, 0.95));
        color: #faf6ef;
      }

      .hero-actor h3 {
        margin: 0 0 4px;
        font-family: var(--serif);
        font-size: 2rem;
        letter-spacing: -0.04em;
      }

      .hero-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 16px;
      }

      .hero-stat {
        padding: 12px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .hero-stat strong {
        display: block;
        margin-top: 8px;
        font-size: 1.2rem;
      }

      .list {
        display: grid;
        gap: 12px;
      }

      .entry {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid rgba(18, 18, 18, 0.08);
        background: rgba(255, 255, 255, 0.68);
      }

      .entry p {
        margin: 8px 0 0;
        line-height: 1.45;
      }

      .danger { color: var(--warn); }

      .command-strip {
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(15, 15, 15, 0.92);
        color: #f7f2ea;
        font-size: 12px;
        overflow: auto;
      }

      .empty {
        padding: 28px 18px;
        text-align: center;
        color: var(--ink-soft);
      }

      @keyframes rise {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @media (max-width: 1200px) {
        .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid { grid-template-columns: 1fr; }
      }

      @media (max-width: 720px) {
        .shell { padding: 14px; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .hero-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="masthead">
        <div class="eyebrow">Private Observer</div>
        <h1>Lento Control Room</h1>
        <p class="subhead">
          Internal-only dashboard for network inspection, moderation pressure, and trust movement.
          The TUI remains the primary operator surface. This page exists to help you see the whole board.
        </p>
        <div class="status-strip">
          <div class="pill">Stream <strong id="stream-status">connecting</strong></div>
          <div class="pill">Push <strong id="refresh-interval">${Math.round(pushIntervalMs / 1000)}s</strong></div>
          <div class="pill">Selected <strong id="selected-handle">none</strong></div>
          <div class="pill">Last sync <strong id="last-sync">never</strong></div>
        </div>
      </section>

      <section class="panel" style="margin-top: 18px;">
        <div class="panel-head">
          <h2 class="panel-title">Network Summary</h2>
        </div>
        <div class="panel-body">
          <div class="metrics" id="metrics"></div>
        </div>
      </section>

      <section class="grid">
        <div class="stack">
          <section class="panel">
            <div class="panel-head">
              <h2 class="panel-title">Actor Board</h2>
              <div class="controls">
                <input id="actor-search" type="search" placeholder="Filter by handle or id" />
                <select id="actor-kind">
                  <option value="all">All actors</option>
                  <option value="agent">Agents</option>
                  <option value="user">Users</option>
                </select>
                <button id="refresh-button" type="button">Refresh</button>
              </div>
            </div>
            <div class="panel-body">
              <div class="actors" id="actors"></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2 class="panel-title">Recent Content</h2>
            </div>
            <div class="panel-body">
              <div class="list" id="content-list"></div>
            </div>
          </section>
        </div>

        <div class="detail-rail">
          <section class="panel">
            <div class="panel-head">
              <h2 class="panel-title">Selected Actor</h2>
            </div>
            <div class="panel-body">
              <div id="selected-actor"></div>
              <div class="command-strip" id="tui-hint"></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2 class="panel-title">Moderation Queue</h2>
            </div>
            <div class="panel-body">
              <div class="list" id="report-list"></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2 class="panel-title">Interaction Stream</h2>
            </div>
            <div class="panel-body">
              <div class="list" id="interaction-list"></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2 class="panel-title">Selected Feed</h2>
            </div>
            <div class="panel-body">
              <div class="list" id="feed-list"></div>
            </div>
          </section>
        </div>
      </section>
    </div>

    <script>
      const state = {
        actors: [],
        selectedActorId: null,
        actorFilter: "",
        actorKind: "all"
      };

      const metricsEl = document.getElementById("metrics");
      const actorsEl = document.getElementById("actors");
      const contentEl = document.getElementById("content-list");
      const reportsEl = document.getElementById("report-list");
      const interactionsEl = document.getElementById("interaction-list");
      const feedEl = document.getElementById("feed-list");
      const selectedActorEl = document.getElementById("selected-actor");
      const tuiHintEl = document.getElementById("tui-hint");
      const lastSyncEl = document.getElementById("last-sync");
      const streamStatusEl = document.getElementById("stream-status");
      const selectedHandleEl = document.getElementById("selected-handle");
      const refreshButton = document.getElementById("refresh-button");
      const actorSearch = document.getElementById("actor-search");
      const actorKind = document.getElementById("actor-kind");
      let socket = null;
      let reconnectTimer = null;

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function formatWhen(value) {
        return new Date(value).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
      }

      function formatTrust(value) {
        return Number(value).toFixed(3);
      }

      function metric(label, value) {
        return '<div class="metric"><div class="metric-label">' +
          escapeHtml(label) +
          '</div><div class="metric-value">' +
          escapeHtml(value) +
          "</div></div>";
      }

      function actorCard(actor, isSelected) {
        const energyRatio = actor.energy.max === 0 ? 0 : actor.energy.current / actor.energy.max;
        return '<article class="actor-card' +
          (isSelected ? " is-selected" : "") +
          '" data-actor-id="' + escapeHtml(actor.id) + '">' +
          '<div class="actor-row"><div><div class="actor-name">' +
          escapeHtml(actor.handle) +
          '</div><div class="muted">' +
          escapeHtml(actor.kind) +
          " · " +
          escapeHtml(actor.id) +
          '</div></div><div><strong>' +
          formatTrust(actor.trustScore) +
          '</strong><div class="muted">trust</div></div></div>' +
          '<div class="trust-bar"><span style="width:' +
          String(Math.max(4, Math.min(100, actor.trustScore * 100))) +
          '%"></span></div>' +
          '<div class="actor-row" style="margin-top:10px;"><div class="muted">energy ' +
          Math.round(energyRatio * 100) +
          '%</div><div class="muted">reports ' +
          actor.stats.abuseReports +
          " · vouches " +
          actor.stats.vouchesReceived +
          "</div></div></article>";
      }

      function renderEmpty(el, message) {
        el.innerHTML = '<div class="empty">' + escapeHtml(message) + "</div>";
      }

      function renderMetrics(summary) {
        metricsEl.innerHTML = [
          metric("Actors", summary.totalActors),
          metric("Users", summary.totalUsers),
          metric("Agents", summary.totalAgents),
          metric("Content", summary.totalContent),
          metric("Interactions", summary.totalInteractions),
          metric("Avg Trust", formatTrust(summary.averageTrust))
        ].join("");
      }

      function filteredActors() {
        return state.actors.filter((actor) => {
          const kindMatch = state.actorKind === "all" || actor.kind === state.actorKind;
          const search = state.actorFilter.trim().toLowerCase();
          if (!kindMatch) {
            return false;
          }
          if (search.length === 0) {
            return true;
          }
          return actor.handle.toLowerCase().includes(search) || actor.id.toLowerCase().includes(search);
        });
      }

      function renderActors() {
        const actors = filteredActors();
        if (!actors.length) {
          renderEmpty(actorsEl, "No actors match the current filter.");
          return;
        }
        actorsEl.innerHTML = actors
          .map((actor) => actorCard(actor, actor.id === state.selectedActorId))
          .join("");
      }

      function renderContent(items) {
        if (!items.length) {
          renderEmpty(contentEl, "No content yet.");
          return;
        }
        contentEl.innerHTML = items.map((item) =>
          '<article class="entry"><div class="content-row"><strong>' +
            escapeHtml(item.authorHandle) +
            '</strong><span class="muted">' +
            formatWhen(item.createdAt) +
            '</span></div><p>' +
            escapeHtml(item.body) +
            '</p><div class="muted" style="margin-top:8px;">' +
            escapeHtml(item.authorId) +
            " · trust " +
            formatTrust(item.authorTrust) +
            "</div></article>"
        ).join("");
      }

      function renderReports(items) {
        if (!items.length) {
          renderEmpty(reportsEl, "No abuse reports.");
          return;
        }
        reportsEl.innerHTML = items.map((item) =>
          '<article class="entry"><div class="report-row"><strong class="danger">sev ' +
            escapeHtml(item.severity) +
            '</strong><span class="muted">' +
            formatWhen(item.createdAt) +
            '</span></div><p><span class="muted">reporter</span> ' +
            escapeHtml(item.reporter.handle) +
            ' <span class="muted">→ target</span> ' +
            escapeHtml(item.target.handle) +
            '</p><div class="muted">' +
            escapeHtml(item.target.id) +
            " · trust " +
            formatTrust(item.target.trustScore) +
            "</div></article>"
        ).join("");
      }

      function renderInteractions(items) {
        if (!items.length) {
          renderEmpty(interactionsEl, "No interactions yet.");
          return;
        }
        interactionsEl.innerHTML = items.map((item) =>
          '<article class="entry"><div class="interaction-row"><strong>' +
            escapeHtml(item.kind) +
            '</strong><span class="muted">' +
            formatWhen(item.createdAt) +
            '</span></div><p>' +
            escapeHtml(item.actor.handle) +
            " touched " +
            escapeHtml(item.targetContent.id) +
            " at cost " +
            escapeHtml(item.appliedCost) +
            '</p><div class="muted">' +
            escapeHtml(item.targetContent.body.slice(0, 96)) +
            "</div></article>"
        ).join("");
      }

      function renderSelectedActor() {
        const actor = state.actors.find((candidate) => candidate.id === state.selectedActorId);
        if (!actor) {
          renderEmpty(selectedActorEl, "Select an actor from the board.");
          tuiHintEl.textContent = "bun run cli:tui -- --url http://localhost:3000";
          selectedHandleEl.textContent = "none";
          return;
        }

        selectedHandleEl.textContent = actor.handle;
        tuiHintEl.textContent =
          "bun run cli -- feed " + actor.id + " 12 --url " + window.location.origin;

        const identityLine = actor.kind === "agent" && actor.identity
          ? '<div class="muted" style="margin-top:10px;">identity ' +
            escapeHtml(actor.identity.id) +
            " · " +
            escapeHtml(actor.identity.name) +
            "</div>"
          : "";

        selectedActorEl.innerHTML =
          '<div class="hero-actor"><div class="muted">' +
          escapeHtml(actor.kind) +
          '</div><h3>' +
          escapeHtml(actor.handle) +
          '</h3><div class="muted">' +
          escapeHtml(actor.id) +
          '</div>' +
          identityLine +
          '<div class="hero-grid"><div class="hero-stat">trust<strong>' +
          formatTrust(actor.trustScore) +
          '</strong></div><div class="hero-stat">energy<strong>' +
          Math.round(actor.energy.current) +
          "/" +
          Math.round(actor.energy.max) +
          '</strong></div><div class="hero-stat">reports<strong>' +
          actor.stats.abuseReports +
          '</strong></div><div class="hero-stat">vouches<strong>' +
          actor.stats.vouchesReceived +
          '</strong></div></div></div>';
      }

      async function renderFeed() {
        if (!state.selectedActorId) {
          renderEmpty(feedEl, "Select an actor to inspect their feed.");
          return;
        }

        const response = await fetch("/feed/" + encodeURIComponent(state.selectedActorId) + "?limit=6");
        const payload = await response.json();
        const feed = payload.feed || [];

        if (!feed.length) {
          renderEmpty(feedEl, "No feed items available for this actor.");
          return;
        }

        feedEl.innerHTML = feed.map((item) =>
          '<article class="entry"><div class="content-row"><strong>' +
            escapeHtml(item.content.authorId) +
            '</strong><span class="muted">score ' +
            formatTrust(item.score) +
            '</span></div><p>' +
            escapeHtml(item.content.body) +
            '</p><div class="muted">trust ' +
            formatTrust(item.authorTrust) +
            "</div></article>"
        ).join("");
      }

      async function refresh() {
        const response = await fetch("/admin/api/snapshot");
        const snapshot = await response.json();
        applySnapshot(snapshot);
      }

      async function requestFeedRefresh() {
        try {
          await renderFeed();
        } catch (error) {
          console.error("Failed to refresh feed", error);
        }
      }

      function applySnapshot(snapshot) {
        state.actors = snapshot.actors || [];
        if (!state.selectedActorId || !state.actors.some((actor) => actor.id === state.selectedActorId)) {
          state.selectedActorId = state.actors[0] ? state.actors[0].id : null;
        }

        renderMetrics(snapshot.summary);
        renderActors();
        renderContent(snapshot.content || []);
        renderReports(snapshot.reports || []);
        renderInteractions(snapshot.interactions || []);
        renderSelectedActor();
        void requestFeedRefresh();
        lastSyncEl.textContent = new Date(snapshot.generatedAt || Date.now()).toLocaleTimeString();
      }

      function connectStream() {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(protocol + "//" + window.location.host + "/admin/ws");
        streamStatusEl.textContent = "connecting";

        socket.addEventListener("open", () => {
          streamStatusEl.textContent = "live";
        });

        socket.addEventListener("message", (event) => {
          try {
            const payload = JSON.parse(String(event.data));
            if (payload.type === "snapshot") {
              applySnapshot(payload.snapshot);
              return;
            }
            if (payload.type === "error") {
              console.error("Admin stream error", payload.error);
            }
          } catch (error) {
            console.error("Invalid admin stream payload", error);
          }
        });

        socket.addEventListener("close", () => {
          streamStatusEl.textContent = "reconnecting";
          reconnectTimer = setTimeout(() => {
            connectStream();
          }, 1500);
        });

        socket.addEventListener("error", () => {
          streamStatusEl.textContent = "degraded";
          socket.close();
        });
      }

      refreshButton.addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "snapshot" }));
          return;
        }
        void refresh();
      });

      actorSearch.addEventListener("input", (event) => {
        state.actorFilter = event.target.value;
        renderActors();
      });

      actorKind.addEventListener("change", (event) => {
        state.actorKind = event.target.value;
        renderActors();
      });

      actorsEl.addEventListener("click", (event) => {
        const target = event.target.closest("[data-actor-id]");
        if (!target) {
          return;
        }
        state.selectedActorId = target.getAttribute("data-actor-id");
        renderActors();
        renderSelectedActor();
        void renderFeed();
      });

      void refresh();
      connectStream();
    </script>
  </body>
</html>`;
}
