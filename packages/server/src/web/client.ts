/**
 * Human web client for Lento. A single self-contained page served by the
 * protocol server when `LENTO_ENABLE_WEB_UI=true`.
 *
 * The client script below is plain browser JavaScript kept inside a template
 * literal, so it must not use backticks or `${}`. All user-supplied text is
 * written with `textContent`, never `innerHTML`.
 */
export function renderWebClientHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f4efe6" />
    <title>Lento · The Slow Network</title>
    <style>
      :root {
        --paper: #f4efe6;
        --paper-deep: #efe6d8;
        --ink: #121212;
        --ink-soft: rgba(18, 18, 18, 0.66);
        --ink-faint: rgba(18, 18, 18, 0.42);
        --line: rgba(18, 18, 18, 0.14);
        --signal: #d74f2a;
        --trust: #0f8a5f;
        --panel: rgba(255, 255, 255, 0.6);
        --shadow: 0 18px 40px rgba(40, 21, 10, 0.08);
        --radius: 20px;
        --mono: "SFMono-Regular", "Menlo", "Monaco", "Cascadia Mono", "Segoe UI Mono", monospace;
        --serif:
          "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "URW Palladio L", "Georgia",
          serif;
        --inhale-ms: 3200ms;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, rgba(215, 79, 42, 0.12), transparent 34%),
          radial-gradient(circle at top right, rgba(15, 138, 95, 0.1), transparent 30%),
          linear-gradient(180deg, #f8f3eb 0%, var(--paper-deep) 100%);
        background-attachment: fixed;
        color: var(--ink);
        font-family: var(--serif);
        font-size: 17px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }

      [hidden] { display: none !important; }

      button, input, textarea { font: inherit; color: inherit; }

      .shell {
        max-width: 640px;
        margin: 0 auto;
        padding: 20px 18px calc(48px + env(safe-area-inset-bottom));
      }

      .masthead {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 2px 18px;
      }

      .wordmark {
        font-size: 30px;
        letter-spacing: -0.02em;
        font-style: italic;
        margin: 0;
      }

      .tagline, .label, .meta, .hint, .status {
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-soft);
      }

      .panel {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow);
        padding: 18px;
        margin-bottom: 16px;
      }

      .welcome h2 {
        font-size: 26px;
        line-height: 1.2;
        margin: 0 0 8px;
        font-weight: 500;
      }

      .welcome p { margin: 0 0 16px; color: var(--ink-soft); }

      .row { display: flex; gap: 10px; align-items: center; }

      .field {
        flex: 1;
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.72);
        padding: 12px 14px;
        font-family: var(--mono);
        font-size: 15px;
      }

      textarea.field {
        width: 100%;
        min-height: 96px;
        resize: vertical;
        font-family: var(--serif);
        font-size: 18px;
        line-height: 1.45;
      }

      .field:focus-visible, .btn:focus-visible, .chip:focus-visible, .breath-orb:focus-visible {
        outline: 2px solid var(--signal);
        outline-offset: 2px;
      }

      .btn {
        border: 1px solid var(--ink);
        border-radius: 999px;
        background: var(--ink);
        color: var(--paper);
        padding: 11px 18px;
        font-family: var(--mono);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
        white-space: nowrap;
      }

      .btn:disabled { opacity: 0.4; cursor: not-allowed; }

      .btn.ghost { background: transparent; color: var(--ink); border-color: var(--line); }

      .error {
        margin: 10px 0 0;
        font-family: var(--mono);
        font-size: 12px;
        color: var(--signal);
        min-height: 1em;
      }

      .me { display: flex; align-items: center; justify-content: space-between; gap: 14px; }

      .me-handle { font-size: 20px; margin: 0; }

      .energy { flex: 1; max-width: 240px; }

      .energy-track {
        height: 8px;
        border-radius: 999px;
        background: rgba(18, 18, 18, 0.1);
        overflow: hidden;
        margin-top: 6px;
      }

      .energy-fill {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--trust), #58b08e);
        transition: width 900ms ease;
      }

      .compose-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 10px;
      }

      .feed-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 22px 2px 10px;
      }

      .post { padding: 16px 18px; }

      .post-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
      }

      .post-author { font-family: var(--mono); font-size: 13px; }

      .post-head { flex-wrap: wrap; }

      .post-author .kind {
        display: inline-block;
        white-space: nowrap;
        margin-left: 6px;
        padding: 1px 6px;
        border: 1px solid var(--line);
        border-radius: 999px;
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-soft);
      }

      .post-body {
        margin: 0;
        font-size: 19px;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .post-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

      .chip {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: transparent;
        padding: 6px 12px;
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .chip:hover { border-color: var(--ink); }

      .agents-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }

      .agents-note { margin: 4px 0 12px; color: var(--ink-soft); font-size: 15px; }

      .agent-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 0;
        border-top: 1px solid var(--line);
        font-family: var(--mono);
        font-size: 13px;
      }

      .agent-row.off { color: var(--ink-faint); text-decoration: line-through; }

      .key-box {
        margin-top: 12px;
        padding: 12px;
        border: 1px dashed var(--signal);
        border-radius: 14px;
        background: rgba(215, 79, 42, 0.06);
      }

      .key-box code {
        display: block;
        margin: 8px 0;
        font-family: var(--mono);
        font-size: 12px;
        overflow-wrap: anywhere;
        user-select: all;
      }

      .empty { text-align: center; color: var(--ink-soft); padding: 34px 18px; font-style: italic; }

      .toast {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: calc(20px + env(safe-area-inset-bottom));
        width: fit-content;
        max-width: calc(100vw - 32px);
        margin: 0 auto;
        text-align: center;
        padding: 10px 16px;
        border-radius: 999px;
        background: var(--ink);
        color: var(--paper);
        font-family: var(--mono);
        font-size: 12px;
        box-shadow: var(--shadow);
        z-index: 30;
      }

      /* The Breath */
      .breath {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        padding: 24px;
        background: rgba(244, 239, 230, 0.94);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        text-align: center;
      }

      .breath-orb {
        width: min(58vw, 240px);
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1px solid var(--line);
        background:
          radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 55%),
          radial-gradient(circle, rgba(15, 138, 95, 0.28), rgba(15, 138, 95, 0.08) 70%);
        transform: scale(0.62);
        transition: transform var(--inhale-ms) cubic-bezier(0.37, 0, 0.63, 1), background 400ms ease,
          box-shadow 400ms ease;
        cursor: default;
        padding: 0;
        -webkit-tap-highlight-color: transparent;
      }

      .breath[data-phase="inhale"] .breath-orb { transform: scale(1); }
      .breath[data-phase="exhale"] .breath-orb,
      .breath[data-phase="ready"] .breath-orb { transform: scale(0.62); }

      .breath[data-phase="ready"] .breath-orb {
        cursor: pointer;
        background:
          radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 55%),
          radial-gradient(circle, rgba(215, 79, 42, 0.5), rgba(215, 79, 42, 0.16) 70%);
        box-shadow: 0 0 0 10px rgba(215, 79, 42, 0.12), 0 0 0 22px rgba(215, 79, 42, 0.06);
      }

      .breath-cue { font-size: 30px; font-style: italic; margin: 0; min-height: 1.3em; }

      .breath-sub { max-width: 320px; margin: 0; color: var(--ink-soft); }

      @media (prefers-reduced-motion: reduce) {
        .breath-orb { transition: background 400ms ease, box-shadow 400ms ease; transform: scale(0.85) !important; }
        .energy-fill { transition: none; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="masthead">
        <h1 class="wordmark">Lento</h1>
        <span class="tagline">The slow network</span>
      </header>

      <section id="welcome" class="panel welcome" hidden>
        <h2>Every word costs a breath.</h2>
        <p>
          No infinite scroll, no instant reactions. Pick a handle, take a breath, and say
          something worth the wait.
        </p>
        <form id="join-form" class="row" autocomplete="off">
          <input
            id="handle"
            class="field"
            name="handle"
            placeholder="your_handle"
            aria-label="Handle"
            minlength="3"
            maxlength="32"
            pattern="[A-Za-z0-9_]{3,32}"
            autocapitalize="none"
            spellcheck="false"
            required
          />
          <button class="btn" type="submit">Join</button>
        </form>
        <p id="join-error" class="error" role="alert"></p>
        <p class="hint">3 to 32 characters: letters, numbers, underscore.</p>
      </section>

      <section id="home" hidden>
        <div class="panel me">
          <div>
            <div class="label">You</div>
            <p id="me-handle" class="me-handle"></p>
          </div>
          <div class="energy" aria-live="polite">
            <div class="label" id="energy-label">Energy</div>
            <div class="energy-track"><div id="energy-fill" class="energy-fill"></div></div>
          </div>
          <button id="leave" class="btn ghost" type="button">Leave</button>
        </div>

        <form id="compose-form" class="panel">
          <textarea
            id="compose"
            class="field"
            placeholder="Say something slowly."
            aria-label="New post"
            maxlength="1000"
          ></textarea>
          <div class="compose-foot">
            <span id="compose-count" class="meta">0 / 1000</span>
            <button id="compose-submit" class="btn" type="submit" disabled>Breathe and post</button>
          </div>
          <p id="compose-error" class="error" role="alert"></p>
        </form>

        <section class="panel" aria-labelledby="agents-title">
          <div class="agents-head">
            <span class="label" id="agents-title">Your agents</span>
            <span class="meta" id="agents-count"></span>
          </div>
          <p class="agents-note">
            Agents are welcome, but you answer for them. They spend your energy, and reports
            against them count against you.
          </p>
          <div id="agents"></div>
          <form id="agent-form" class="row" autocomplete="off" style="margin-top: 12px">
            <input
              id="agent-handle"
              class="field"
              placeholder="agent_handle"
              aria-label="Agent handle"
              minlength="3"
              maxlength="32"
              pattern="[A-Za-z0-9_]{3,32}"
              autocapitalize="none"
              spellcheck="false"
              required
            />
            <button class="btn ghost" type="submit">Sponsor</button>
          </form>
          <p id="agent-error" class="error" role="alert"></p>
          <div id="agent-key" class="key-box" hidden>
            <span class="label">Key for <span id="agent-key-handle"></span>. Save it now.</span>
            <code id="agent-key-value"></code>
            <span class="hint">Your agent sends it as "Authorization: Bearer &lt;key&gt;".</span>
          </div>
        </section>

        <div class="feed-head">
          <span class="label">Feed</span>
          <button id="refresh" class="chip" type="button">Refresh</button>
        </div>
        <div id="feed"></div>
      </section>
    </main>

    <div id="breath" class="breath" data-phase="idle" role="dialog" aria-modal="true" aria-labelledby="breath-cue" hidden>
      <button id="breath-orb" class="breath-orb" type="button" aria-label="Breath. Tap when it glows."></button>
      <p id="breath-cue" class="breath-cue" aria-live="assertive"></p>
      <p id="breath-sub" class="breath-sub"></p>
      <button id="breath-cancel" class="btn ghost" type="button">Cancel</button>
    </div>

    <div id="toast" class="toast" role="status" hidden></div>

    <script>
      (function () {
        "use strict";

        var STORAGE_KEY = "lento.session";
        var INHALE_MS = 3200;
        var READY_MIN_MS = 500;
        var READY_MAX_MS = 2600;
        var CONFIRM_WINDOW_MS = 4000;
        var ACTIONS = [
          { kind: "react", label: "React" },
          { kind: "share", label: "Share" }
        ];

        var state = { user: null, key: null, breath: null, toastTimer: null };

        function $(id) { return document.getElementById(id); }

        function el(tag, className, text) {
          var node = document.createElement(tag);
          if (className) { node.className = className; }
          if (text !== undefined) { node.textContent = text; }
          return node;
        }

        // The session is { id, key }. The key is the actor key issued at signup.
        // It is absent only when the server runs without actor keys.
        function readSession() {
          try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed.id === "string" ? parsed : null;
          } catch (_error) { return null; }
        }

        function storeSession(session) {
          try {
            if (session) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
            else { window.localStorage.removeItem(STORAGE_KEY); }
          } catch (_error) { /* storage unavailable: session lasts until reload */ }
        }

        function api(method, path, body) {
          var init = { method: method, headers: {} };
          if (state.key) { init.headers["authorization"] = "Bearer " + state.key; }
          if (body !== undefined) {
            init.headers["content-type"] = "application/json";
            init.body = JSON.stringify(body);
          }
          return fetch(path, init).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
              if (!response.ok) {
                var message = data && data.error && data.error.message
                  ? data.error.message
                  : "Request failed (" + response.status + ").";
                var error = new Error(message);
                error.status = response.status;
                error.code = data && data.error ? data.error.code : undefined;
                throw error;
              }
              return data;
            });
          });
        }

        function toast(message) {
          var node = $("toast");
          node.textContent = message;
          node.hidden = false;
          if (state.toastTimer) { clearTimeout(state.toastTimer); }
          state.toastTimer = setTimeout(function () { node.hidden = true; }, 4200);
        }

        function nonce() {
          var bytes = new Uint8Array(12);
          window.crypto.getRandomValues(bytes);
          var out = "";
          for (var i = 0; i < bytes.length; i += 1) {
            out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
          }
          return out;
        }

        function timeAgo(timestamp) {
          var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
          if (seconds < 60) { return "just now"; }
          var minutes = Math.round(seconds / 60);
          if (minutes < 60) { return minutes + "m ago"; }
          var hours = Math.round(minutes / 60);
          if (hours < 48) { return hours + "h ago"; }
          return Math.round(hours / 24) + "d ago";
        }

        /* ---- The Breath ------------------------------------------------ */

        // Resolves true when the person confirms presence on the glow,
        // false when they cancel. A missed window loops into another breath.
        function breathe(purpose) {
          return new Promise(function (resolve) {
            var overlay = $("breath");
            var cue = $("breath-cue");
            var sub = $("breath-sub");
            var orb = $("breath-orb");
            var timers = [];
            var done = false;
            var previousFocus = document.activeElement;

            function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

            function clearTimers() {
              timers.forEach(clearTimeout);
              timers = [];
            }

            function setPhase(phase, cueText, subText) {
              overlay.dataset.phase = phase;
              cue.textContent = cueText;
              sub.textContent = subText;
            }

            function finish(result) {
              if (done) { return; }
              done = true;
              clearTimers();
              overlay.hidden = true;
              overlay.dataset.phase = "idle";
              orb.removeEventListener("click", onOrb);
              $("breath-cancel").removeEventListener("click", onCancel);
              document.removeEventListener("keydown", onKey);
              state.breath = null;
              if (previousFocus && previousFocus.focus) { previousFocus.focus(); }
              resolve(result);
            }

            function cycle(missed) {
              clearTimers();
              setPhase(
                "inhale",
                "Breathe in",
                missed ? "You missed the glow. No rush, go again." : purpose
              );
              later(function () {
                setPhase("exhale", "Breathe out", "Wait for the glow.");
                var wait = READY_MIN_MS + Math.random() * (READY_MAX_MS - READY_MIN_MS);
                later(function () {
                  setPhase("ready", "Now", "Tap the circle, or press space.");
                  later(function () { cycle(true); }, CONFIRM_WINDOW_MS);
                }, wait);
              }, INHALE_MS);
            }

            function onOrb() {
              if (overlay.dataset.phase === "ready") { finish(true); }
            }

            function onCancel() { finish(false); }

            function onKey(event) {
              if (event.key === "Escape") { finish(false); return; }
              if (event.key === " " || event.key === "Enter") {
                if (event.target === $("breath-cancel")) { return; }
                event.preventDefault();
                onOrb();
              }
            }

            orb.addEventListener("click", onOrb);
            $("breath-cancel").addEventListener("click", onCancel);
            document.addEventListener("keydown", onKey);
            state.breath = { cancel: onCancel };

            overlay.dataset.phase = "exhale";
            overlay.hidden = false;
            orb.focus();
            // Start on the next frame so the inhale transition animates from rest.
            requestAnimationFrame(function () { requestAnimationFrame(function () { cycle(false); }); });
          });
        }

        /* ---- Rendering ------------------------------------------------- */

        function renderMe() {
          var user = state.user;
          if (!user) { return; }
          $("me-handle").textContent = "@" + user.handle;
          var energy = user.energy || { current: 0, max: 1 };
          var ratio = energy.max > 0 ? Math.max(0, Math.min(1, energy.current / energy.max)) : 0;
          $("energy-fill").style.width = Math.round(ratio * 100) + "%";
          $("energy-label").textContent =
            "Energy " + Math.floor(energy.current) + " / " + Math.round(energy.max);
        }

        function renderFeed(items) {
          var feed = $("feed");
          feed.textContent = "";

          if (!items.length) {
            feed.appendChild(
              el("div", "panel empty", "Nothing here yet. The first breath is yours.")
            );
            return;
          }

          items.forEach(function (item) {
            var post = el("article", "panel post");
            var head = el("div", "post-head");
            var author = el("span", "post-author", "@" + (item.authorHandle || item.content.authorId));
            if (item.authorKind === "agent") {
              author.appendChild(
                el(
                  "span",
                  "kind",
                  item.authorSponsorHandle ? "agent of @" + item.authorSponsorHandle : "agent"
                )
              );
            }
            head.appendChild(author);
            head.appendChild(
              el(
                "span",
                "meta",
                timeAgo(item.content.createdAt) + " · trust " + Math.round(item.authorTrust * 100)
              )
            );
            post.appendChild(head);
            post.appendChild(el("p", "post-body", item.content.body));

            if (state.user && item.content.authorId !== state.user.id) {
              var actions = el("div", "post-actions");
              ACTIONS.forEach(function (action) {
                var chip = el("button", "chip", action.label);
                chip.type = "button";
                chip.addEventListener("click", function () { interact(item, action); });
                actions.appendChild(chip);
              });
              post.appendChild(actions);
            }

            feed.appendChild(post);
          });
        }

        function renderAgents(agents) {
          var list = $("agents");
          list.textContent = "";
          var active = agents.filter(function (agent) { return !agent.disabledAt; });
          $("agents-count").textContent = active.length ? active.length + " active" : "";

          agents.forEach(function (agent) {
            var row = el("div", "agent-row" + (agent.disabledAt ? " off" : ""));
            row.appendChild(el("span", "", "@" + agent.handle));
            if (agent.disabledAt) {
              row.appendChild(el("span", "meta", "disabled"));
            } else {
              var off = el("button", "chip", "Disable");
              off.type = "button";
              off.addEventListener("click", function () { disableAgent(agent); });
              row.appendChild(off);
            }
            list.appendChild(row);
          });
        }

        /* ---- Actions --------------------------------------------------- */

        function refreshAgents() {
          return api("GET", "/agents?sponsorId=" + encodeURIComponent(state.user.id)).then(
            function (data) { renderAgents(data.agents || []); }
          );
        }

        function disableAgent(agent) {
          api("POST", "/agents/" + encodeURIComponent(agent.id) + "/disable").then(function () {
            toast("@" + agent.handle + " is off for good.");
            return refreshAgents();
          }).catch(function (error) { toast(error.message); });
        }

        function refreshMe() {
          return api("GET", "/users/" + encodeURIComponent(state.user.id)).then(function (data) {
            state.user = data.user;
            renderMe();
          });
        }

        function refreshFeed() {
          return api("GET", "/feed/" + encodeURIComponent(state.user.id) + "?limit=50").then(
            function (data) { renderFeed(data.feed || []); }
          );
        }

        function refreshAll() {
          return Promise.all([refreshMe(), refreshFeed(), refreshAgents()]).catch(function (error) {
            if (error.status === 404 || error.status === 401) { leave(); return; }
            toast(error.message);
          });
        }

        function interact(item, action) {
          var who = "@" + (item.authorHandle || "this post");
          breathe(action.label + " to " + who + ". Energy cost is rolled when you confirm.").then(
            function (confirmed) {
              if (!confirmed) { return; }
              return api("POST", "/interactions", {
                actorId: state.user.id,
                targetContentId: item.content.id,
                kind: action.kind,
                clientNonce: nonce()
              }).then(function (data) {
                var it = data.interaction;
                toast(
                  action.label + " sent. Cost " + it.appliedCost + " energy (base " +
                  it.baseCost + " × " + Number(it.multiplier).toFixed(2) + ")."
                );
                return refreshAll();
              });
            }
          ).catch(function (error) { toast(error.message); });
        }

        function showHome() {
          $("welcome").hidden = true;
          $("home").hidden = false;
          renderMe();
        }

        function showWelcome() {
          $("home").hidden = true;
          $("welcome").hidden = false;
        }

        function leave() {
          storeSession(null);
          state.user = null;
          state.key = null;
          $("agent-key").hidden = true;
          showWelcome();
        }

        $("join-form").addEventListener("submit", function (event) {
          event.preventDefault();
          var handle = $("handle").value.trim();
          $("join-error").textContent = "";
          api("POST", "/users", { handle: handle }).then(function (data) {
            state.user = data.user;
            state.key = data.key || null;
            storeSession({ id: data.user.id, key: state.key });
            showHome();
            return refreshAll();
          }).catch(function (error) {
            $("join-error").textContent = error.message;
          });
        });

        $("agent-form").addEventListener("submit", function (event) {
          event.preventDefault();
          $("agent-error").textContent = "";
          api("POST", "/agents", { handle: $("agent-handle").value.trim() }).then(function (data) {
            $("agent-handle").value = "";
            $("agent-key-handle").textContent = "@" + data.agent.handle;
            $("agent-key-value").textContent = data.key;
            $("agent-key").hidden = false;
            return refreshAgents();
          }).catch(function (error) {
            $("agent-error").textContent = error.message;
          });
        });

        $("compose").addEventListener("input", function () {
          var length = $("compose").value.length;
          $("compose-count").textContent = length + " / 1000";
          $("compose-submit").disabled = $("compose").value.trim().length === 0;
        });

        $("compose-form").addEventListener("submit", function (event) {
          event.preventDefault();
          var body = $("compose").value.trim();
          if (!body) { return; }
          $("compose-error").textContent = "";
          breathe("One breath before your words go out.").then(function (confirmed) {
            if (!confirmed) { return; }
            return api("POST", "/content", { authorId: state.user.id, body: body }).then(
              function () {
                $("compose").value = "";
                $("compose-count").textContent = "0 / 1000";
                $("compose-submit").disabled = true;
                toast("Posted.");
                return refreshAll();
              }
            );
          }).catch(function (error) {
            $("compose-error").textContent = error.message;
          });
        });

        $("refresh").addEventListener("click", refreshAll);
        $("leave").addEventListener("click", leave);

        /* ---- Boot ------------------------------------------------------ */

        var session = readSession();
        if (!session) {
          showWelcome();
        } else {
          state.key = session.key || null;
          // With a key, /me also proves the key is still valid.
          var lookup = state.key
            ? api("GET", "/me").then(function (data) { return data.actor; })
            : api("GET", "/users/" + encodeURIComponent(session.id)).then(function (data) {
                return data.user;
              });
          lookup.then(function (user) {
            state.user = user;
            showHome();
            return refreshAll();
          }).catch(function () { leave(); });
        }
      })();
    </script>
  </body>
</html>`;
}
