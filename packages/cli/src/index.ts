import {
  LentoApiClient,
  SqliteStore,
  exportProtocolStore,
  importProtocolStore,
  type InteractionKind,
  type ProtocolStoreSnapshot
} from "@lento/core";
import { flagNumber, flagString, parseCliArgs } from "./command-parser";
import { parseTuiFeedLimitFromFlags, runTui } from "./tui";

function createApiClient(
  serverUrl: string,
  flags: Record<string, string | boolean>
): LentoApiClient {
  const moltbookIdentityToken =
    flagString(flags, "moltbook-identity") ??
    flagString(flags, "identity-token") ??
    Bun.env.MOLTBOOK_IDENTITY_TOKEN;

  if (!moltbookIdentityToken) {
    return new LentoApiClient(serverUrl);
  }

  return new LentoApiClient(serverUrl, {
    moltbookIdentityToken
  });
}

function printHelp(): void {
  console.log(`Lento CLI

Commands:
  help
  tui [--url <http://localhost:3000>] [--user <userId>] [--limit <n>]
  store-export [--db <sqlite-path>] [--out <snapshot.json>]
  store-import [--db <sqlite-path>] --in <snapshot.json>
  identity [--url <http://localhost:3000>] [--moltbook-identity <token>]
  agent-me [--url <http://localhost:3000>] [--moltbook-identity <token>]
  agent-register [handle] [--url <http://localhost:3000>] [--moltbook-identity <token>]
  health [--url <http://localhost:3000>]
  user <handle> [--url <http://localhost:3000>]
  get-user <userId> [--url <http://localhost:3000>]
  post <authorId> <body...> [--url <http://localhost:3000>]
  content [authorId] [--url <http://localhost:3000>]
  feed <actorId> [limit] [--url <http://localhost:3000>]
  vouch <fromActorId> <toActorId> [stake] [--url <http://localhost:3000>]
  report <reporterActorId> <targetActorId> <severity1-5> [--url <http://localhost:3000>]
  interact <actorId> <contentId> <react|comment|share|dm> [nonce] [--url <http://localhost:3000>]

Examples:
  bun run --cwd packages/cli start -- user alice
  bun run --cwd packages/cli start -- post usr_abc "hello world"
  bun run --cwd packages/cli start -- identity --moltbook-identity <token>
  bun run --cwd packages/cli start -- agent-me --moltbook-identity <token>
  bun run --cwd packages/cli start -- store-export --db ./.lento/data/lento.sqlite --out ./lento-snapshot.json
  bun run --cwd packages/cli start -- store-import --db ./.lento/data/lento.sqlite --in ./lento-snapshot.json
  bun run --cwd packages/cli start -- tui --url http://localhost:3000
`);
}

function parseInteractionKind(kind: string): InteractionKind {
  if (kind === "react" || kind === "comment" || kind === "share" || kind === "dm") {
    return kind;
  }
  throw new Error(`Invalid interaction kind '${kind}'. Use react|comment|share|dm.`);
}

function asSeverity(raw: string): 1 | 2 | 3 | 4 | 5 {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Severity must be an integer from 1 to 5.");
  }
  return value as 1 | 2 | 3 | 4 | 5;
}

function ensure(value: string | undefined, message: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function resolveDatabasePath(flags: Record<string, string | boolean>): string {
  return ensure(
    flagString(flags, "db") ?? flagString(flags, "database") ?? Bun.env.LENTO_DATABASE_PATH,
    "A SQLite database path is required. Use --db <path> or set LENTO_DATABASE_PATH."
  );
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);
  const serverUrl =
    flagString(parsed.flags, "url") ??
    flagString(parsed.flags, "server") ??
    Bun.env.LENTO_SERVER_URL ??
    "http://localhost:3000";

  const api = createApiClient(serverUrl, parsed.flags);

  switch (parsed.command) {
    case "help": {
      printHelp();
      return;
    }

    case "store-export": {
      const databasePath = resolveDatabasePath(parsed.flags);
      const outPath = flagString(parsed.flags, "out");
      const store = new SqliteStore({ path: databasePath });

      try {
        const snapshot = exportProtocolStore(store);
        const payload = `${JSON.stringify(snapshot, null, 2)}\n`;

        if (outPath) {
          await Bun.write(outPath, payload);
          console.log(
            JSON.stringify(
              {
                ok: true,
                databasePath,
                outPath,
                actors: snapshot.users.length + snapshot.agents.length,
                content: snapshot.content.length,
                interactions: snapshot.interactions.length,
                vouches: snapshot.vouches.length,
                abuseReports: snapshot.abuseReports.length
              },
              null,
              2
            )
          );
          return;
        }

        console.log(payload.trimEnd());
        return;
      } finally {
        store.close();
      }
    }

    case "store-import": {
      const databasePath = resolveDatabasePath(parsed.flags);
      const inPath = ensure(
        flagString(parsed.flags, "in"),
        "Usage: store-import --db <sqlite-path> --in <snapshot.json>"
      );
      const store = new SqliteStore({ path: databasePath });

      try {
        const snapshot = (await Bun.file(inPath).json()) as ProtocolStoreSnapshot;
        importProtocolStore(store, snapshot);
        console.log(
          JSON.stringify(
            {
              ok: true,
              databasePath,
              inPath,
              actors: snapshot.users.length + snapshot.agents.length,
              content: snapshot.content.length,
              interactions: snapshot.interactions.length,
              vouches: snapshot.vouches.length,
              abuseReports: snapshot.abuseReports.length
            },
            null,
            2
          )
        );
        return;
      } finally {
        store.close();
      }
    }

    case "tui": {
      await runTui({
        api,
        serverUrl,
        initialUserId: flagString(parsed.flags, "user") ?? flagString(parsed.flags, "userId"),
        initialFeedLimit: parseTuiFeedLimitFromFlags(parsed.flags)
      });
      return;
    }

    case "health": {
      console.log(JSON.stringify(await api.health(), null, 2));
      return;
    }

    case "identity": {
      console.log(JSON.stringify(await api.getIdentity(), null, 2));
      return;
    }

    case "agent-me": {
      console.log(JSON.stringify(await api.getAuthenticatedAgent(), null, 2));
      return;
    }

    case "agent-register": {
      const handle = parsed.args[0] ?? flagString(parsed.flags, "handle");
      console.log(JSON.stringify(await api.registerAgent(handle), null, 2));
      return;
    }

    case "user": {
      const handle = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "handle"),
        "Usage: user <handle>"
      );
      console.log(JSON.stringify(await api.createUser(handle), null, 2));
      return;
    }

    case "get-user": {
      const userId = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "user"),
        "Usage: get-user <userId>"
      );
      console.log(JSON.stringify(await api.getUser(userId), null, 2));
      return;
    }

    case "post": {
      const authorId = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "author"),
        "Usage: post <authorId> <body>"
      );
      const positionalBody = parsed.args.slice(1).join(" ").trim();
      const body =
        positionalBody || flagString(parsed.flags, "body") || flagString(parsed.flags, "text");
      if (!body) {
        throw new Error("Usage: post <authorId> <body>");
      }
      console.log(JSON.stringify(await api.createContent(authorId, body), null, 2));
      return;
    }

    case "content": {
      const authorId = parsed.args[0] ?? flagString(parsed.flags, "author");
      console.log(JSON.stringify(await api.listContent(authorId), null, 2));
      return;
    }

    case "feed": {
      const userId = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "user"),
        "Usage: feed <userId> [limit]"
      );
      const limitRaw = parsed.args[1] ?? flagNumber(parsed.flags, "limit");
      const limit = limitRaw === undefined ? undefined : Number(limitRaw);
      const safeLimit =
        limit !== undefined && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : undefined;
      console.log(JSON.stringify(await api.getFeed(userId, safeLimit), null, 2));
      return;
    }

    case "vouch": {
      const fromUserId = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "from"),
        "Usage: vouch <from> <to> [stake]"
      );
      const toUserId = ensure(
        parsed.args[1] ?? flagString(parsed.flags, "to"),
        "Usage: vouch <from> <to> [stake]"
      );
      const stakeRaw = parsed.args[2] ?? flagString(parsed.flags, "stake");
      const stake = stakeRaw ? Number(stakeRaw) : undefined;
      console.log(JSON.stringify(await api.createVouch(fromUserId, toUserId, stake), null, 2));
      return;
    }

    case "report": {
      const reporter = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "reporter"),
        "Usage: report <reporterUserId> <targetUserId> <severity1-5>"
      );
      const target = ensure(
        parsed.args[1] ?? flagString(parsed.flags, "target"),
        "Usage: report <reporterUserId> <targetUserId> <severity1-5>"
      );
      const severityRaw = ensure(
        parsed.args[2] ?? flagString(parsed.flags, "severity"),
        "Usage: report <reporterUserId> <targetUserId> <severity1-5>"
      );
      const severity = asSeverity(severityRaw);
      console.log(JSON.stringify(await api.createAbuseReport(reporter, target, severity), null, 2));
      return;
    }

    case "interact": {
      const actor = ensure(
        parsed.args[0] ?? flagString(parsed.flags, "actor"),
        "Usage: interact <actorUserId> <contentId> <kind> [nonce]"
      );
      const contentId = ensure(
        parsed.args[1] ?? flagString(parsed.flags, "content"),
        "Usage: interact <actorUserId> <contentId> <kind> [nonce]"
      );
      const kind = parseInteractionKind(
        ensure(
          parsed.args[2] ?? flagString(parsed.flags, "kind"),
          "Usage: interact <actorUserId> <contentId> <kind> [nonce]"
        )
      );
      const nonce = parsed.args[3] ?? flagString(parsed.flags, "nonce");
      console.log(
        JSON.stringify(await api.createInteraction(actor, contentId, kind, nonce), null, 2)
      );
      return;
    }

    default:
      throw new Error(`Unknown command '${parsed.command}'. Use 'help'.`);
  }
}
