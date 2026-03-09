import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  type KeyEvent
} from "@opentui/core";
import { LentoApiClient, type FeedItem, type InteractionKind } from "@lento/core";
import { flagNumber, tokenizeCommandLine } from "./command-parser";

interface TuiOptions {
  api: LentoApiClient;
  serverUrl: string;
  initialUserId?: string;
  initialFeedLimit?: number;
}

interface TuiState {
  selectedUserId?: string;
  feedLimit: number;
  feedItems: FeedItem[];
  logs: string[];
  busy: boolean;
  lastError?: string;
}

const HELP_TEXT = [
  "Commands",
  "",
  "/help",
  "/health",
  "/user <handle>",
  "/select <userId>",
  "/whoami",
  '/post [authorId] "<text>"',
  "/content [authorId]",
  "/feed [userId] [limit]",
  "/vouch <from> <to> [stake]",
  "/report <reporter> <target> <1-5>",
  "/interact <actor> <content> <kind> [nonce]",
  "/quit",
  "",
  "Shortcuts",
  "q or Ctrl+C: quit",
  "F5: refresh feed"
].join("\n");

function nowHms(): string {
  return new Date().toISOString().slice(11, 19);
}

function toLevelTag(level: "cmd" | "ok" | "err" | "info"): string {
  switch (level) {
    case "cmd":
      return "CMD ";
    case "ok":
      return " OK ";
    case "err":
      return "ERR ";
    default:
      return "INFO";
  }
}

function formatFeedItem(item: FeedItem, index: number): string {
  const body =
    item.content.body.length > 220 ? `${item.content.body.slice(0, 220)}...` : item.content.body;
  return [
    `#${index + 1}  score=${item.score.toFixed(4)}  trust=${item.authorTrust.toFixed(4)}`,
    `content=${item.content.id}  author=${item.content.authorId}`,
    body
  ].join("\n");
}

function coercePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function parseInteractionKind(raw: string): InteractionKind {
  if (raw === "react" || raw === "comment" || raw === "share" || raw === "dm") {
    return raw;
  }
  throw new Error(`Unknown interaction kind '${raw}'. Use react|comment|share|dm.`);
}

export async function runTui(options: TuiOptions): Promise<void> {
  const state: TuiState = {
    selectedUserId: options.initialUserId,
    feedLimit: Math.max(1, options.initialFeedLimit ?? 20),
    feedItems: [],
    logs: [],
    busy: false
  };

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: false,
    autoFocus: true,
    useAlternateScreen: true,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true
    }
  });

  renderer.root.flexDirection = "column";
  renderer.root.padding = 0;

  const headerBox = new BoxRenderable(renderer, {
    height: 4,
    border: true,
    title: "Lento Agent Cockpit",
    borderColor: "cyan",
    paddingX: 1,
    paddingY: 0
  });
  const headerText = new TextRenderable(renderer, {
    content: ""
  });
  headerBox.add(headerText);

  const bodyBox = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "row",
    gap: 1
  });

  const feedBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 7,
    border: true,
    borderColor: "yellow",
    title: "Live Feed",
    stickyScroll: false,
    paddingX: 1,
    paddingY: 0
  });
  const feedText = new TextRenderable(renderer, {
    content: "No feed loaded yet. Run /feed <userId> or /select <userId> then /feed.",
    wrapMode: "word"
  });
  feedBox.add(feedText);

  const sideBox = new BoxRenderable(renderer, {
    flexGrow: 5,
    flexDirection: "column",
    gap: 1
  });

  const helpBox = new BoxRenderable(renderer, {
    height: 20,
    border: true,
    borderColor: "brightBlue",
    title: "Playbook",
    paddingX: 1,
    paddingY: 0
  });
  const helpText = new TextRenderable(renderer, {
    content: HELP_TEXT
  });
  helpBox.add(helpText);

  const activityBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    border: true,
    borderColor: "brightGreen",
    title: "Activity",
    stickyScroll: true,
    stickyStart: "bottom",
    paddingX: 1,
    paddingY: 0
  });
  const activityText = new TextRenderable(renderer, {
    content: "No activity yet.",
    wrapMode: "word"
  });
  activityBox.add(activityText);

  sideBox.add(helpBox);
  sideBox.add(activityBox);
  bodyBox.add(feedBox);
  bodyBox.add(sideBox);

  const inputBox = new BoxRenderable(renderer, {
    height: 4,
    border: true,
    borderColor: "magenta",
    title: "Command Input",
    flexDirection: "column",
    paddingX: 1,
    paddingY: 0
  });

  const inputHint = new TextRenderable(renderer, {
    content: "Type a command and press Enter. Prefix '/' is optional."
  });

  const inputRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 1
  });
  const prompt = new TextRenderable(renderer, {
    width: 2,
    content: "> "
  });
  const input = new InputRenderable(renderer, {
    width: "100%",
    placeholder: "help"
  });

  inputRow.add(prompt);
  inputRow.add(input);
  inputBox.add(inputHint);
  inputBox.add(inputRow);

  renderer.root.add(headerBox);
  renderer.root.add(bodyBox);
  renderer.root.add(inputBox);

  const updateHeader = (): void => {
    const status = state.busy ? "busy" : "idle";
    const selected = state.selectedUserId ?? "<none>";
    const errorPart = state.lastError ? `lastError=${state.lastError}` : "lastError=<none>";
    headerText.content = [
      `server=${options.serverUrl}  selected=${selected}  feedLimit=${state.feedLimit}  status=${status}`,
      errorPart
    ].join("\n");
  };

  const updateActivity = (): void => {
    activityText.content = state.logs.length > 0 ? state.logs.join("\n") : "No activity yet.";
    activityBox.scrollTop = activityBox.scrollHeight;
  };

  const updateFeed = (): void => {
    if (state.feedItems.length === 0) {
      feedText.content = "No feed items available.";
      return;
    }

    feedText.content = state.feedItems
      .map((item, index) => formatFeedItem(item, index))
      .join("\n\n");
    feedBox.scrollTop = 0;
  };

  const log = (level: "cmd" | "ok" | "err" | "info", message: string): void => {
    const line = `[${nowHms()}] ${toLevelTag(level)} ${message}`;
    state.logs.push(line);
    if (state.logs.length > 200) {
      state.logs.splice(0, state.logs.length - 200);
    }
    updateActivity();
  };

  const execute = async (work: () => Promise<void>): Promise<void> => {
    state.busy = true;
    updateHeader();

    try {
      await work();
      state.lastError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message;
      log("err", message);
    } finally {
      state.busy = false;
      updateHeader();
    }
  };

  const refreshFeed = async (userId = state.selectedUserId, withLog = true): Promise<void> => {
    if (!userId) {
      throw new Error("No selected user. Use /select <userId> or /feed <userId>.");
    }

    const feed = await options.api.getFeed(userId, state.feedLimit);
    state.feedItems = feed;
    state.selectedUserId = userId;
    updateFeed();
    if (withLog) {
      log("ok", `Loaded ${feed.length} feed item(s) for ${userId}.`);
    }
  };

  const printHelpToActivity = (): void => {
    for (const line of HELP_TEXT.split("\n")) {
      if (line.length > 0) {
        log("info", line);
      }
    }
  };

  const handleCommand = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return;
    }

    const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    log("cmd", normalized);

    let tokens: string[];
    try {
      tokens = tokenizeCommandLine(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }

    if (tokens.length === 0) {
      return;
    }

    const [command, ...args] = tokens;

    switch (command) {
      case "help":
        printHelpToActivity();
        return;

      case "health": {
        const health = await options.api.health();
        log("ok", `Health: ok=${health.ok}`);
        return;
      }

      case "user": {
        const handle = args[0];
        if (!handle) {
          throw new Error("Usage: /user <handle>");
        }
        const user = await options.api.createUser(handle);
        state.selectedUserId = user.id;
        log("ok", `Created user ${user.handle} (${user.id}). Selected user updated.`);
        return;
      }

      case "select": {
        const userId = args[0];
        if (!userId) {
          throw new Error("Usage: /select <userId>");
        }
        const user = await options.api.getUser(userId);
        state.selectedUserId = user.id;
        log("ok", `Selected user ${user.handle} (${user.id}) trust=${user.trustScore.toFixed(4)}.`);
        return;
      }

      case "whoami": {
        if (!state.selectedUserId) {
          throw new Error("No selected user. Use /select <userId> first.");
        }
        const user = await options.api.getUser(state.selectedUserId);
        log(
          "info",
          `id=${user.id} handle=${user.handle} trust=${user.trustScore.toFixed(4)} energy=${user.energy.current}/${user.energy.max}`
        );
        return;
      }

      case "post": {
        let authorId = state.selectedUserId;
        let bodyStartIndex = 0;

        if (state.selectedUserId === undefined) {
          authorId = args[0];
          bodyStartIndex = 1;
        } else if (args[0]?.startsWith("usr_")) {
          authorId = args[0];
          bodyStartIndex = 1;
        }

        if (!authorId) {
          throw new Error("Usage: /post [authorId] <body>");
        }

        const body = args.slice(bodyStartIndex).join(" ").trim();
        if (body.length === 0) {
          throw new Error("Usage: /post [authorId] <body>");
        }

        const content = await options.api.createContent(authorId, body);
        log("ok", `Created content ${content.id} by ${content.authorId}.`);
        return;
      }

      case "content": {
        const authorId = args[0] ?? state.selectedUserId;
        const items = await options.api.listContent(authorId);
        log("info", `Content items: ${items.length}`);
        for (const item of items.slice(0, 5)) {
          const body = item.body.length > 90 ? `${item.body.slice(0, 90)}...` : item.body;
          log("info", `${item.id} by ${item.authorId} :: ${body}`);
        }
        return;
      }

      case "feed": {
        const userId = args[0] ?? state.selectedUserId;
        const limit = coercePositiveInt(args[1], state.feedLimit);
        state.feedLimit = limit;
        await refreshFeed(userId, true);
        return;
      }

      case "vouch": {
        const from = args[0];
        const to = args[1];
        if (!from || !to) {
          throw new Error("Usage: /vouch <fromUserId> <toUserId> [stake]");
        }
        const stake = args[2] ? Number(args[2]) : undefined;
        const result = await options.api.createVouch(from, to, stake);
        log("ok", `Vouch ${result.vouch.id}: trust score now ${result.trustScore.toFixed(4)}.`);
        return;
      }

      case "report": {
        const reporter = args[0];
        const target = args[1];
        const severityRaw = args[2];
        if (!reporter || !target || !severityRaw) {
          throw new Error("Usage: /report <reporterUserId> <targetUserId> <severity1-5>");
        }
        const severity = Number(severityRaw);
        if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
          throw new Error("Severity must be an integer between 1 and 5.");
        }
        const result = await options.api.createAbuseReport(
          reporter,
          target,
          severity as 1 | 2 | 3 | 4 | 5
        );
        log("ok", `Report recorded. Target trust score now ${result.trustScore.toFixed(4)}.`);
        return;
      }

      case "interact": {
        const actor = args[0];
        const content = args[1];
        const kindRaw = args[2];
        if (!actor || !content || !kindRaw) {
          throw new Error(
            "Usage: /interact <actorUserId> <contentId> <react|comment|share|dm> [nonce]"
          );
        }
        const kind = parseInteractionKind(kindRaw);
        const interaction = await options.api.createInteraction(actor, content, kind, args[3]);
        log(
          "ok",
          `Interaction ${interaction.id} cost=${interaction.appliedCost} multiplier=${interaction.multiplier.toFixed(4)}`
        );
        return;
      }

      case "quit":
      case "exit":
      case "q":
        await shutdown();
        return;

      default:
        throw new Error(`Unknown command '${command}'. Use /help.`);
    }
  };

  let shuttingDown = false;
  let doneResolve = () => {};

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(refreshInterval);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    renderer.destroy();
    doneResolve();
  };

  const onSignal = (): void => {
    void shutdown();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      void shutdown();
      return;
    }

    if (key.name === "q" && !key.ctrl && !key.meta) {
      void shutdown();
      return;
    }

    if (key.name === "f5") {
      void execute(async () => {
        await refreshFeed(state.selectedUserId, true);
      });
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      input.focus();
    }
  });

  input.on(InputRenderableEvents.ENTER, (value: string) => {
    const line = String(value ?? "");
    input.value = "";
    void execute(async () => {
      await handleCommand(line);
    });
  });

  const refreshInterval = setInterval(() => {
    if (state.selectedUserId === undefined || state.busy) {
      return;
    }
    void execute(async () => {
      await refreshFeed(state.selectedUserId, false);
    });
  }, 10_000);

  const done = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  log("info", "TUI ready. Run /help to see commands.");
  if (state.selectedUserId) {
    void execute(async () => {
      await refreshFeed(state.selectedUserId, true);
    });
  }
  updateHeader();
  updateFeed();
  updateActivity();
  input.focus();

  await done;
}

export function parseTuiFeedLimitFromFlags(
  flags: Record<string, string | boolean>
): number | undefined {
  const limit = flagNumber(flags, "limit");
  if (limit === undefined) {
    return undefined;
  }
  return Math.max(1, Math.floor(limit));
}
