// pm2 process file for production deploys. Run via `scripts/deploy.sh`.
//
// Notes:
// - We invoke the `next` binary directly so pm2 manages a single process
//   (no extra `pnpm` shell wrapper).
// - PORT and other env vars are loaded from `.env.production` by the deploy
//   script before pm2 spawns the child.
// - Reckon binds to 127.0.0.1 by design — keep it that way and front it with
//   a reverse proxy (see README).

const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "reckon",
      cwd: __dirname,
      script: path.resolve(__dirname, "node_modules/next/dist/bin/next"),
      args: "start -H 127.0.0.1",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      time: true,
    },
  ],
};
