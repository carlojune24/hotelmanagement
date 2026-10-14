# HR app: server deployment

How `apps/hr` runs on `mmserver` at **https://hr.mmgroupcompanies.com**, as set up on 2026-10-14.
Everything below was done by hand once; day-to-day updates use `pnpm deploy:hr` (see "Deploying updates").

## Overview

```
browser ──HTTPS──▶ Cloudflare edge ──tunnel──▶ cloudflared (mmserver)
                                                   │ https://localhost:443 (noTLSVerify)
                                                   ▼
                                                nginx :443  (server_name hr.mmgroupcompanies.com)
                                                   │ http://127.0.0.1:3010
                                                   ▼
                                           pm2 "mm-hr" → node build/index.js
                                                   │ postgres://mm_hr@localhost:5432/mm_hr
                                                   ▼
                                               PostgreSQL 18 (database mm_hr)
```

| What | Where |
|---|---|
| Server | `mmserver@100.109.167.10` (Tailscale), Ubuntu, Node 22 |
| Repo / source | `/home/mmserver/mmhotel/` |
| HR app and build | `/home/mmserver/mmhotel/apps/hr/` (runs `build/index.js`) |
| App config | `/home/mmserver/mmhotel/apps/hr/.env` (mode 600) |
| Uploaded files | `/home/mmserver/hr-uploads/` |
| pm2 process | `mm-hr`, logs in `~/.pm2/logs/mm-hr-*.log` |
| Database | PostgreSQL 18, database and role `mm_hr` |
| nginx site | `/etc/nginx/sites-available/mmhr` (linked in `sites-enabled/`) |
| Tunnel config | `/etc/cloudflared/config.yml` (backup: `config.yml.bak`) |
| Tunnel ID | `a56c3e42-2071-4636-afde-e8d3de1d09a2` |

## Step 1: SSH access with a key

The first login was by password, which cannot be typed non-interactively. A key was installed instead:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519      # on the laptop
ssh-copy-id mmserver@100.109.167.10                    # asks the password once
ssh mmserver@100.109.167.10 hostname                   # must print "mmserver" with no prompt
```

`sudo` on the server still needs the account password.

## Step 2: install pnpm, pm2, PostgreSQL

Node 22 and npm were already present; nginx and cloudflared already served the other sites.

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-client   # PostgreSQL 18, provides psql
sudo npm install -g pnpm pm2
```

## Step 3: database

Create a dedicated role and database, then restore a dump of the local `mm_hr`.

On the laptop (PostgreSQL 18 client, custom format, no owners or grants):

```bash
pg_dump --no-owner --no-privileges -Fc "$DATABASE_URL" -f mm_hr.dump
scp mm_hr.dump mmserver@100.109.167.10:/tmp/
```

On the server:

```bash
sudo -u postgres psql -c "create role mm_hr login password '<generated password>'"
sudo -u postgres psql -c "create database mm_hr owner mm_hr"
cp /tmp/mm_hr.dump /tmp/pgr.dump        # postgres user must be able to read it
sudo -u postgres pg_restore --no-owner --role=mm_hr -d mm_hr /tmp/pgr.dump
sudo -u postgres psql -d mm_hr -c "select count(*) from pg_tables where schemaname='public'"   # 41
sudo rm /tmp/mm_hr.dump /tmp/pgr.dump
```

`--role=mm_hr` makes the restored tables owned by `mm_hr`. This was a one-time snapshot, so local and server data do not sync.

## Step 4: put the code on the server and build

`pnpm deploy:hr` automates this (see below). By hand:

```bash
# laptop, from the repo root
tar --exclude=node_modules --exclude=.git --exclude=build --exclude=.svelte-kit \
    --exclude=.env --exclude='.env.*' --exclude=uploads -czf src.tgz .
scp src.tgz mmserver@100.109.167.10:/tmp/mmsrc.tgz

# server
mkdir -p ~/mmhotel && tar xzf /tmp/mmsrc.tgz -C ~/mmhotel
cd ~/mmhotel
pnpm install --frozen-lockfile --filter @mm/hr...
cd apps/hr && pnpm exec svelte-kit sync && pnpm build
```

The build happens on the server, not on the laptop, because `@node-rs/argon2` installs a per-OS native binary (Windows laptop, Linux server).

## Step 5: server `.env`

`/home/mmserver/mmhotel/apps/hr/.env`:

```
DATABASE_URL=postgres://mm_hr:<password>@localhost:5432/mm_hr
AUTH_PEPPER=
ORIGIN=https://hr.mmgroupcompanies.com
PORT=3010
HOST=127.0.0.1
UPLOADS_DIR=/home/mmserver/hr-uploads
```

- `ORIGIN` is required by `adapter-node`; without it form posts fail CSRF checks.
- `AUTH_PEPPER` is **empty on purpose**. The copied database's password hashes were made with an empty pepper; setting one would invalidate every login.
- `HOST=127.0.0.1` keeps the app off the network; only nginx reaches it.
- The app does not load `.env` itself; pm2 passes it with `--env-file`.

```bash
mkdir -p ~/hr-uploads
chmod 600 ~/mmhotel/apps/hr/.env
```

## Step 6: pm2

```bash
cd ~/mmhotel/apps/hr
pm2 start build/index.js --name mm-hr --node-args="--env-file=.env"
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u mmserver --hp /home/mmserver   # start on boot
pm2 save
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010/    # 302 → /auth/login
```

Everyday commands: `pm2 status`, `pm2 logs mm-hr`, `pm2 restart mm-hr --update-env`.

## Step 7: nginx

`/etc/nginx/sites-available/mmhr`, same origin certificate as the other sites:

```nginx
server {
    listen 443 ssl;
    server_name hr.mmgroupcompanies.com;

    ssl_certificate     /etc/nginx/ssl/cloudflare-origin.pem;
    ssl_certificate_key /etc/nginx/ssl/cloudflare-origin.key;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mmhr /etc/nginx/sites-enabled/mmhr
sudo nginx -t && sudo systemctl reload nginx
```

`client_max_body_size 25m` allows payslip, DTR and document uploads.

## Step 8: cloudflared tunnel and DNS

Add an ingress rule to `/etc/cloudflared/config.yml` **above** the final `http_status:404` catch-all (back the file up first):

```yaml
  - hostname: hr.mmgroupcompanies.com
    service: https://localhost:443
    originRequest:
      noTLSVerify: true
```

`noTLSVerify` matches the other sites: nginx presents a Cloudflare *origin* certificate that the tunnel does not trust by name.

Create the DNS record (a proxied CNAME to the tunnel) and restart:

```bash
sudo cloudflared tunnel route dns a56c3e42-2071-4636-afde-e8d3de1d09a2 hr.mmgroupcompanies.com
sudo systemctl restart cloudflared
systemctl is-active cloudflared nginx          # active, active
curl -sI https://hr.mmgroupcompanies.com/       # 302 → /auth/login
```

The tunnel UUID is the argument, not a name. A new site needs this same two-part change (ingress rule, DNS route) plus an nginx server block.

## Deploying updates

From `apps/hr` on the laptop:

```bash
pnpm deploy:hr              # pack, upload, install, build, pm2 restart
pnpm deploy:hr --migrate    # also run DB migrations before the restart
```

`apps/hr/scripts/deploy.sh` does Step 4 plus the pm2 restart. It never overwrites the server `.env`, and it deploys the working tree, committed or not. Override `HR_DEPLOY_HOST`, `HR_DEPLOY_DIR`, `HR_DEPLOY_PM2` if the target changes. There is no rollback: fix and redeploy.

## Known gaps

- **No access gate in front of the app.** The URL is public and protected only by the app's own login. For payroll data, put Cloudflare Access (allow-listed emails) on `hr.mmgroupcompanies.com` in Zero Trust → Access → Applications. It needs no server change. Check nothing posts to the app from outside a browser first, since Access would block it.
- **Database contains test data** from the laptop copy (mock hotels, the DTR sample hotel, test staff). Clean it before real use; `apps/hr/scripts/remove-dtr-sample.sql` removes the DTR sample.
- **No backups.** Nothing dumps `mm_hr` on a schedule. Add a nightly `pg_dump` cron job before relying on this data.
- **The deploy script has not been run end to end**; it repeats the manual steps.
- **`AUTH_PEPPER` is empty**; changing it later forces every user to reset their password.
