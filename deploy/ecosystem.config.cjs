// PM2 process definition for the API. Copied alongside server/ on deploy;
// lives in deploy/ (not server/) so it doesn't get swept up by the client
// build or confused with app source. Started once via `pm2 start` (see
// VPS_DEPLOY.md); every later deploy just does `pm2 reload wca-crm-api`.
//
// Env vars (DATABASE_URL, JWT_SECRET, ...) come from server/.env on the VPS
// (written once by deploy/setup-vps.sh) — dotenv loads it at process start,
// so nothing secret needs to live in this file.
module.exports = {
  apps: [
    {
      name: 'wca-crm-api',
      cwd: __dirname + '/../server',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
