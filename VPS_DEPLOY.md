# Deploying WCA CRM to a Hostinger VPS (with auto-deploy on push)

This supersedes the old split Render+Vercel setup in `DEPLOY.md` — everything
now runs on one VPS: Nginx serves the built React app and reverse-proxies
`/api` to a PM2-managed Node process, backed by PostgreSQL.

Every step below is tagged **[You]** (only you can do it — account/VPS/GitHub
access) or **[Automated]** (already built; happens by itself once the [You]
steps are done).

---

## 1. [You] Get the VPS

1. Order a Hostinger VPS. **Ubuntu 22.04 or 24.04** is what the provisioning
   script targets — pick that as the OS image.
2. Once it's running, note its **public IP address** and the **root
   password/SSH key** Hostinger gives you.
3. (Optional) If you have a domain, point its **A record** at that IP now —
   DNS propagation takes a while, so starting it early saves time later. If
   you don't have one, skip this; you can use the bare IP.

## 2. [You] Provision the VPS (one command)

SSH into the VPS:

```bash
ssh root@YOUR_VPS_IP
```

Copy `deploy/setup-vps.sh` from this repo onto the VPS (paste its contents
into a file, or `scp` it up), then run it:

```bash
sudo bash setup-vps.sh
```

It will ask for:
- **A password for the new `wca_crm` Postgres user** — pick anything, it's
  stored only in `server/.env` on the VPS, never in git.
- **A domain name** (optional — leave blank to use the bare IP).

What it installs/configures, all idempotent (safe to re-run): Node.js 20,
PostgreSQL + a `wca_crm` database, PM2 (with a systemd unit so it survives
reboots), Nginx (reverse-proxying `/api` to `127.0.0.1:4000`, serving
`client/dist` for everything else), and `ufw` (SSH + HTTP/HTTPS only).

At the end it prints the app directory (`/var/www/wca-crm` by default) —
you'll need that for step 4.

## 3. [You] Create a deploy SSH key

On **your own machine** (not the VPS):

```bash
ssh-keygen -t ed25519 -f wca_crm_deploy_key -C "github-actions-deploy" -N ""
```

This makes two files: `wca_crm_deploy_key` (private) and
`wca_crm_deploy_key.pub` (public). Add the **public** one to the VPS:

```bash
ssh-copy-id -i wca_crm_deploy_key.pub root@YOUR_VPS_IP
# or, if ssh-copy-id isn't available:
cat wca_crm_deploy_key.pub | ssh root@YOUR_VPS_IP "cat >> ~/.ssh/authorized_keys"
```

Keep the **private** key (`wca_crm_deploy_key`, no `.pub`) — you'll paste its
full contents into a GitHub secret next. Don't commit either file.

## 4. [You] Add GitHub Actions secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**. Add all five:

| Secret name | Value |
|---|---|
| `VPS_HOST` | Your VPS IP (or domain) |
| `VPS_USER` | `root` (or whichever user you provisioned/SSH'd as) |
| `VPS_PORT` | `22` (only needed if you changed the SSH port) |
| `VPS_SSH_KEY` | The full contents of the **private** key file from step 3 |
| `VPS_APP_DIR` | `/var/www/wca-crm` (or whatever `setup-vps.sh` printed) |

## 5. [You] Push to main

```bash
git add -A
git commit -m "Deploy: migrate to Postgres + VPS hosting"
git push origin main
```

## 6. [Automated] The rest happens by itself

`.github/workflows/deploy.yml` fires on that push and:
1. Builds the React client (`npm run build`).
2. `rsync`s the built client + server source to the VPS over SSH.
3. Runs `npm ci` for the server on the VPS.
4. Starts (first time) or reloads (every time after) the API under PM2 —
   zero-downtime restart, no dropped requests.

Watch it run under the **Actions** tab of your GitHub repo. First deploy
takes a couple of minutes; every push after that is faster.

## 7. [You] Verify

Visit `http://YOUR_VPS_IP` (or your domain). Log in with `WCA_ADMIN` /
`Admin@123` — same seeded demo data as local dev, now backed by Postgres.
`initDb()` creates the schema and seeds demo data automatically on first
boot, exactly like it did with SQLite locally.

## 8. [You, optional] HTTPS

If you pointed a domain at the VPS in step 1 and DNS has propagated:

```bash
ssh root@YOUR_VPS_IP
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

Certbot edits the Nginx config in place and sets up auto-renewal — no
further action needed. Re-run `.github` deploys don't touch Nginx config, so
this survives every future push.

---

## Every deploy after this

Just `git push` to `main`. No manual steps — build, sync, install, restart
all happen in CI. To roll back, `git revert` the bad commit and push; the
workflow redeploys the reverted state the same way.

## Troubleshooting

- **Workflow fails at "Trust VPS host key" or the rsync steps** — double
  check `VPS_HOST`/`VPS_PORT` and that the public half of the deploy key is
  actually in `~/.ssh/authorized_keys` on the VPS for `VPS_USER`.
- **Site loads but login/API calls fail** — SSH in and check
  `pm2 logs wca-crm-api`. Most likely `server/.env`'s `DATABASE_URL` is
  wrong, or Postgres isn't running (`systemctl status postgresql`).
- **`pm2 reload` says the process doesn't exist** — the workflow already
  falls back to `pm2 start` automatically the first time; if it still fails,
  SSH in and run `cd /var/www/wca-crm/deploy && pm2 start ecosystem.config.cjs`
  once by hand.
- **Nginx 502 on `/api/...`** — the Node process isn't up. Check
  `pm2 status` and `pm2 logs wca-crm-api` on the VPS.
- **rsync fails with a `mkdir ... failed: No such file or directory` that
  makes no sense** (the directory demonstrably exists) — if you set
  `VPS_APP_DIR` from **Git Bash on Windows**, MSYS2 silently rewrites any
  argument starting with `/` into a Windows path (e.g. `/var/www/foo` becomes
  `C:/Program Files/Git/var/www/foo`) before the `gh` CLI ever sees it. Fix:
  set it via stdin instead of `--body`, which isn't subject to that mangling:
  `printf '%s' "/var/www/crm.wecareassurance.com" | gh secret set VPS_APP_DIR`.
