# Reckon

Chat-first analytics agent platform. A Next.js app that runs a Claude Agent
SDK runtime over your data via GraphJin, with a workflow builder for saving
repeatable analyses and a scheduler for running them on cron.

- `/builder` — meta-agent that interviews you and saves a workflow
- `/run/[workflowId]` — runs a saved workflow with the same runtime
- `/runs` — replayable history of every run (interactive + scheduled)

See `CLAUDE.md` for architectural conventions.

## Prerequisites

- **Node.js** 20+ (tested on 23.x)
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **GraphJin** running and reachable from the app — Reckon talks to your
  database exclusively through `graphjin cli` (Bash) and prefetches a
  knowledge pack from `GET ${GRAPHJIN_BASE_URL}/discover/<section>` at boot.
  The `graphjin` binary must be on `PATH` for the agent to query data.
- **Anthropic API key** with access to the configured model (default
  `claude-sonnet-4-6`).

## Environment variables

Copy `.env.example` to `.env.local` (dev) or `.env.production` (deploy) and
fill in the values.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | — | Powers the agent runtime. |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-4-6` | Model id passed to the SDK. |
| `GRAPHJIN_BASE_URL` | no | `http://localhost:8080` | Used at boot to prefetch the knowledge pack via `/discover/<section>`. |
| `GRAPHJIN_TOKEN` | no | — | Set if your GraphJin server requires auth. |
| `AGENT_DB_PATH` | no | `./data/agent.db` | SQLite file for workflows, runs, run_events. Created on first boot. Resolved relative to the process CWD. |
| `AGENT_COST_CAP_USD` | no | `5.00` | Soft per-run cost cap; the run aborts past it. |
| `DISCOVERY_TIMEOUT_MS` | no | `10000` | Knowledge prefetch timeout per section. |
| `DISCOVERY_RETRIES` | no | `3` | Knowledge prefetch retries per section. |
| `DEFAULT_TIMEZONE` | no | `UTC` | Default tz for cron triggers when a workflow doesn't set one. |
| `NEXT_PUBLIC_BRAND_NAME` | no | `Reckon` | Inlined at build time — rebuild after changing. |
| `NEXT_PUBLIC_BRAND_LOGO` | no | `/brand/logo.svg` | Path under `/public`. Inlined at build time. |
| `TEST_DB_URL` | no | — | Direct Postgres URL used **only** by `pnpm smoke` for ground-truth verification. Not read by the app. |

`NEXT_PUBLIC_*` values are baked into the client bundle at `next build` time;
changing them requires a rebuild, not just a restart.

## Local development

```bash
pnpm install
cp .env.example .env.local        # then fill in ANTHROPIC_API_KEY etc.
pnpm dev                          # binds to 127.0.0.1:3000
```

Open http://127.0.0.1:3000.

GraphJin must be running before the dev server starts, otherwise the
knowledge prefetch fails on boot. The probe at `lib/agent/graphjin-probe.ts`
will keep retrying and recover automatically once GraphJin comes back.

## Build for production

```bash
pnpm install --frozen-lockfile
pnpm build
```

The build output lives in `.next/`. Production start:

```bash
pnpm start                        # binds to 127.0.0.1:3000
```

To listen on a different port, pass `-p`:

```bash
pnpm exec next start -H 127.0.0.1 -p 4000
```

> **Security note.** v1 has no auth and intentionally binds to `127.0.0.1`.
> Do not change the bind address to `0.0.0.0` or expose the port directly to
> the internet — front it with a reverse proxy that handles TLS and auth
> (nginx, Caddy, Cloudflare Tunnel, Tailscale, etc.).

## Deploying on a standalone server

Reference deployment on a Linux box using a non-root service user, pnpm, and
systemd. Adjust paths to taste.

### 1. Provision the host

```bash
# As root or via sudo
adduser --system --group --home /srv/reckon reckon
apt-get install -y git curl build-essential
# Node 20+ — install via nodesource, fnm, or asdf
# pnpm
corepack enable && corepack prepare pnpm@latest --activate
# graphjin — install per https://graphjin.com (binary must be on PATH for the reckon user)
```

### 2. Clone and build

```bash
sudo -u reckon -H bash -lc '
  cd /srv/reckon
  git clone <your-repo> app
  cd app
  pnpm install --frozen-lockfile
  cp .env.example .env.production && $EDITOR .env.production    # fill in
  pnpm build
  mkdir -p data                # SQLite file lives here
'
```

Reckon reads env from the process environment, not `.env.production`
automatically — load it via the systemd unit (`EnvironmentFile=`) below.

### 3. systemd unit

`/etc/systemd/system/reckon.service`:

```ini
[Unit]
Description=Reckon analytics agent
After=network-online.target graphjin.service
Wants=network-online.target

[Service]
Type=simple
User=reckon
Group=reckon
WorkingDirectory=/srv/reckon/app
EnvironmentFile=/srv/reckon/app/.env.production
ExecStart=/usr/bin/pnpm start
Restart=on-failure
RestartSec=5
# Reckon binds to 127.0.0.1 — front it with a reverse proxy.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reckon
sudo journalctl -u reckon -f
```

### 4. Reverse proxy (example: nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name reckon.example.com;
  # ssl_certificate ...

  # Reckon streams agent output via SSE — disable proxy buffering on /api.
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Add HTTP basic auth, OAuth2 proxy, or your SSO of choice at this layer — the
app itself trusts every request.

### 5. Updating

```bash
sudo -u reckon -H bash -lc '
  cd /srv/reckon/app
  git pull
  pnpm install --frozen-lockfile
  pnpm build
'
sudo systemctl restart reckon
```

The SQLite database (`data/agent.db`) and the GraphJin knowledge pack
(`lib/agent/knowledge/*.json`, regenerated each boot) are the only stateful
artifacts. Back up `data/` if you care about workflow + run history.

## Smoke test

After the server is up:

```bash
TEST_DB_URL=postgres://... AGENT_BASE_URL=http://127.0.0.1:3000 pnpm smoke
```

`pnpm smoke:sql` skips the agent calls and only verifies the ground-truth
SQL queries against `TEST_DB_URL`.
