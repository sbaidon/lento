# Deploying Lento

Lento runs as one process with one SQLite file. That keeps it cheap and simple, and it means: **one machine, one volume, no horizontal scaling**. In-memory state (rate limit counters, admin sockets) also assumes a single instance.

## What the server refuses to do

When bound to a public address, the server exits at startup if:

- `LENTO_SERVER_SECRET` is unset (actor keys would be forgeable)
- the web client is on without `LENTO_REQUIRE_IDENTITY_FOR_WRITES=true`
- the admin UI is on without `LENTO_ADMIN_TOKEN`

Bound to loopback (`LENTO_SERVER_HOSTNAME=127.0.0.1`), these are warnings, so local development stays easy.

## Settings

| Variable                                      | Purpose                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `LENTO_SERVER_SECRET`                         | Signs actor keys and cost proofs. Long and random. Changing it logs everyone out.                            |
| `LENTO_DATABASE_PATH`                         | SQLite file. Put it on a persistent volume.                                                                  |
| `LENTO_REQUIRE_IDENTITY_FOR_WRITES`           | `true` in production. Writes need an actor key.                                                              |
| `LENTO_REQUIRE_BREATH`                        | `true` in production. Posts, interactions, and vouches need a breath pass.                                   |
| `LENTO_GENESIS_ACTOR_IDS`                     | Comma-separated actor ids of genesis accounts. See below.                                                    |
| `LENTO_ENABLE_WEB_UI`                         | Serves the web client at `/` and the about page at `/about`.                                                 |
| `LENTO_CONTACT_EMAIL`                         | Shown on `/about` for reports and removal requests.                                                          |
| `LENTO_CLIENT_IP_HEADER`                      | Header your proxy sets to the real client IP (`fly-client-ip` on Fly). Only set this behind a trusted proxy. |
| `LENTO_RATE_LIMIT`                            | On by default. `off` disables it.                                                                            |
| `LENTO_LOG_REQUESTS`                          | `true` prints one JSON line per request (method, path, status, duration, IP).                                |
| `LENTO_ENABLE_ADMIN_UI` / `LENTO_ADMIN_TOKEN` | Admin dashboard at `/admin`, protected by HTTP Basic auth. Any username, the token as password.              |

Default rate limits per client IP: 5 signups per hour, 30 writes per minute, 300 reads per minute. Request bodies are capped at 64 KB.

## Genesis accounts

Trust on Lento flows out from genesis accounts. A vouch is worth only as much standing as other people have given the voucher, so until someone is genesis, vouches are recorded but worth nothing.

1. Deploy, then sign up as yourself.
2. Find your actor id: it is the `usr_...` part of your key, or `GET /me`.
3. Set it and restart: `fly secrets set LENTO_GENESIS_ACTOR_IDS=usr_...` (comma-separated for several).

It is an id, not a handle, on purpose: anyone could sign up with a handle before you do. Genesis accounts start at 0.9 trust and their full-stake vouch is worth +0.08. Pick people you would stake the network on, and keep the list short.

## Fly.io

The repo ships a `Dockerfile` and `fly.toml`.

```bash
fly launch --no-deploy --copy-config        # pick an app name, keep the existing config
fly volumes create lento_data --size 1 --snapshot-retention 30   # 1 GB, same region as the app
fly secrets set LENTO_SERVER_SECRET="$(openssl rand -hex 32)"
fly deploy
fly certs add lento.social                  # then point DNS as Fly instructs
```

Optional:

```bash
fly secrets set LENTO_ADMIN_TOKEN="$(openssl rand -hex 24)"
# then add LENTO_ENABLE_ADMIN_UI = "true" and LENTO_CONTACT_EMAIL to [env] in fly.toml
```

Keep `fly scale count` at 1. A second machine would get its own empty volume and its own database.

## Backups

Two layers. Use both.

1. **Fly volume snapshots.** Fly snapshots volumes daily and keeps them for 5 days by default (1 to 60 is allowed). `fly.toml` asks for 30 on volumes that `fly deploy` creates. For a volume you created by hand, run `fly volumes update <volume-id> --snapshot-retention 30`. Check with `fly volumes snapshots list <volume-id>`. Fly itself says snapshots should not be your primary backup.
2. **Database copies.** `scripts/backup.ts` writes a consistent, integrity-checked copy while the server runs:

   ```bash
   fly ssh console -C "bun run scripts/backup.ts --keep 14"
   ```

   Copies land in `/data/backups`, on the same volume. To survive losing the volume, pull them off the machine on a schedule:

   ```bash
   fly ssh sftp get /data/backups/<file> ./
   ```

Restore by stopping the app, replacing `/data/lento.sqlite` with a backup copy, and starting it again.

Not automated yet: scheduled backups and off-site upload. Until that exists, put the two commands above in a cron job or a scheduled GitHub Action.

## Before inviting people

- Set `LENTO_CONTACT_EMAIL` and read `/about`. It is a plain-language template, not reviewed legal terms. Adapt it, and get real terms and a privacy policy reviewed if this grows.
- Sign up yourself and keep your actor key somewhere safe. There is no key recovery yet.
- Watch `fly logs` for `"status":429` and `"status":5` lines.
