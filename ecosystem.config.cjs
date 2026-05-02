// pm2 process file for production deploys. Run via `scripts/deploy.sh`.
//
// We load `.env.production` here and place its contents into the `env` block
// so that whenever PM2 evaluates this file (`pm2 start|reload|startOrReload
// ecosystem.config.cjs`), the file's values win over whatever the PM2 god
// daemon happens to have cached in its own environment. Without this, an
// operator who edits `.env.production` and then runs plain `pm2 restart
// reckon` ships the daemon's stale env — which has burned us with a stale
// ANTHROPIC_API_KEY billing the wrong account.
//
// Reckon defaults to 127.0.0.1 — front it with a reverse proxy (see README).
// Override the bind address by setting HOST in .env.production (e.g. on a
// VPN-only host where the network already restricts ingress).

const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvFile(path.resolve(__dirname, ".env.production"));
const host = fileEnv.HOST || process.env.HOST || "127.0.0.1";

module.exports = {
  apps: [
    {
      name: "reckon",
      cwd: __dirname,
      script: path.resolve(__dirname, "node_modules/next/dist/bin/next"),
      args: `start -H ${host}`,
      env: {
        ...fileEnv,
        NODE_ENV: "production",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      time: true,
    },
  ],
};
