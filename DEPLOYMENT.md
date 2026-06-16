# Deployment & infrastructure

How `shreyafadia.com` is built, hosted, and deployed, and where every moving
piece lives. This repository is the **source of truth**; everything else is
derived from it.

> **History (June 2026):** the site previously had three half-configured deploy
> targets at once — a DigitalOcean droplet (where DNS pointed), a Netlify project,
> and this Hetzner setup. It was consolidated onto a single host (Hetzner). The
> DigitalOcean droplet and the Netlify project are being retired; nothing in the
> live path depends on them anymore.

## TL;DR

- **Edit** content via the CMS at `https://shreyafadia.com/admin` *or* by
  committing directly to `main`.
- **Any push to `main`** triggers a GitHub webhook → the host pulls and rebuilds
  with Hugo → the new site is live in a few seconds.
- **Everything runs on one box:** Hetzner VPS, `ssh main.hetzner.deb`
  (`5.161.126.195`). Hosting, builds, and CMS auth are all self-hosted there.

## Architecture

```
                edits                         git push to main
   Editor ───────────────► GitHub repo ──────────────────────────┐
     │  (a) CMS /admin       shreyafadia/                         │
     │      login via         shreyafadia.com                     │ webhook
     │      OAuth broker          ▲                               │ (push event)
     │  (b) git push              │ commit                        ▼
     │                            │                   POST /api/v1/trigger-build
     ▼                            │                               │
  GitHub OAuth ◄──── /auth ◄──────┼─────────── Hetzner box (main.hetzner.deb) ──┐
  "Auth for          /callback    │            │                                │
   shreyafadia.com"   (broker)    │            │  nginx ──► fcgiwrap ──► build   │
                                  │            │                         hook    │
                                  └────────────┼── git pull --ff-only           │
                                   token used   │   + hugo build                 │
                                   by CMS to    │        │                       │
                                   commit       │        ▼                       │
                                                │  /home/main/shreyafadia.com/   │
                                   visitors ───►│  public  ──► served by nginx   │
                                                └────────────────────────────────┘
```

## The source repository

| Thing | Where |
| --- | --- |
| Static site generator | **Hugo (extended), v0.145** |
| Site config | `hugo.toml` (`baseURL = https://shreyafadia.com`, `theme = gruvhugo`) |
| Content | `content/` (Markdown), `data/site.yml` (site config edited via CMS) |
| Theme | **vendored** at `themes/gruvhugo` (committed files, a fork of `gruvhugo`) |
| Build output | `public/` — **gitignored**, generated on the host at deploy time |
| CMS | Decap CMS, loaded from `static/js/decap-cms_3.0.0.js` via `static/admin/index.html`, configured by `static/admin/config.yml` |

Editing happens either through the CMS or by normal git commits to `main`. There
is no build step in CI — the host builds the site itself (see below).

## The host (Hetzner VPS)

`ssh main.hetzner.deb` → `5.161.126.195`. All paths below are on that box.

| Component | Location / detail |
| --- | --- |
| Git checkout | `/home/main/shreyafadia.com` (owned by `www-data`, `origin` = this repo over HTTPS) |
| Web root | `/home/main/shreyafadia.com/public` (Hugo output; served as static files) |
| nginx vhost | `/etc/nginx/sites-available/www.shreyafadia.com` (enabled; `server_name shreyafadia.com www.shreyafadia.com`) |
| Build/deploy hook | `/usr/local/bin/shreyafadia.com_github-build-hook.sh` (runs as `www-data` via `fcgiwrap`, socket `/run/fcgiwrap.socket`) |
| Deploy log | `/var/log/webhook.log` |
| CMS OAuth broker | dir `/home/main/netlify-cms-github-oauth-provider`; service `cms-oauth.service` (user `cmsoauth`); listens on `:8090`, reached only via nginx |
| Broker config | `/etc/cms-oauth/env` (mode `0640`, `root:cmsoauth`) — **holds the OAuth client secret** |
| TLS certificate | `/etc/letsencrypt/live/shreyafadia.com/` (Let's Encrypt via certbot; auto-renews) |

The nginx vhost has three relevant routes inside the `https` server block:

- `location /` → serves the static files from `public/`.
- `location = /api/v1/trigger-build` → the deploy webhook receiver (→ fcgiwrap → build hook).
- `location = /auth` and `location = /callback` → reverse-proxied to the OAuth broker on `127.0.0.1:8090`.

## Deploy pipeline (push → live)

1. A commit lands on `main` (from the CMS or a direct push).
2. GitHub fires the repo **webhook** (push event) to
   `https://shreyafadia.com/api/v1/trigger-build`, signed with `X-Hub-Signature-256`.
3. nginx strips the `sha256=` prefix and hands the request to `fcgiwrap`, which runs
   the **build hook**.
4. The build hook:
   - verifies the HMAC-SHA256 signature against the shared secret (rejects with `403` if it doesn't match);
   - `git pull --ff-only` in `/home/main/shreyafadia.com`;
   - `git submodule update --init --recursive` (no-op today — see "Known cruft");
   - `hugo -s . -d public`;
   - logs everything to `/var/log/webhook.log`; returns **`200` on success**, or
     **`500` if `git pull` or `hugo` fails** — so a broken deploy shows up as a
     failed delivery in GitHub (Settings → Webhooks → Recent Deliveries) instead
     of silently rebuilding stale content.

### Ownership (important)

The checkout, its `.git/`, and `public/` must be owned by **`www-data`** — that's
the user the deploy hook runs as (via `fcgiwrap`). **Never run `git` or `hugo`
against this checkout as `root` or `main`.** Doing so leaves `root`-owned objects
in `.git/objects`, after which the webhook's `git pull` fails with
`insufficient permission for adding an object` and deploys quietly rebuild
**stale** content. If you must run something manually, use `sudo -u www-data …`.
To repair ownership after a slip:

```sh
sudo chown -R www-data:www-data /home/main/shreyafadia.com
```

### GitHub webhook settings (repo → Settings → Webhooks)

- **Payload URL:** `https://shreyafadia.com/api/v1/trigger-build`
- **Content type:** `application/json` (the hook HMACs the raw JSON body)
- **Secret:** shared with the build hook; the value lives **only** in
  `/usr/local/bin/shreyafadia.com_github-build-hook.sh` on the host (`SECRET=`).
- **Events:** just the **push** event.
- **SSL verification:** enabled.

## CMS authentication (no Netlify dependency)

The CMS uses Decap's **GitHub backend** with a **self-hosted OAuth broker**, so
login does not depend on Netlify's hosted OAuth.

- `static/admin/config.yml` sets:
  - `backend.name: github`, `repo: shreyafadia/shreyafadia.com`, `branch: main`
  - `base_url: https://shreyafadia.com` and `auth_endpoint: auth` → points Decap at our broker
- **GitHub OAuth App:** "Auth for shreyafadia.com" (owned by the `shreyafadia`
  account; GitHub → Settings → Developer settings → OAuth Apps).
  - **Client ID:** `Ov23ct1A7HnXLoR1i6rb` (not secret)
  - **Authorization callback URL:** `https://shreyafadia.com/callback`
  - **Client secret:** stored only in `/etc/cms-oauth/env` on the host
- **Login flow:** `/admin` → broker `/auth` → GitHub authorize → GitHub redirects
  to broker `/callback` → broker exchanges the code for a token → Decap uses that
  token to commit to the repo.
- **Who can log in:** anyone who authorizes the OAuth App **and** has **write
  access to this repository**. Access control is effectively the repo's
  collaborator list — the broker itself does not gate users.

## DNS

- Registrar **Namecheap** delegates the domain to **Hetzner DNS** nameservers
  (`*.ns.hetzner.com/.de`); records are managed in the Hetzner DNS console.
- `A  shreyafadia.com → 5.161.126.195` and `A  www → 5.161.126.195`.
- Mail is handled by **Migadu** (the `autoconfig`/`_domainkey` CNAMEs, `_imaps`/
  `_pop3s`/`_submissions` SRV records, and SPF/DKIM/DMARC TXT records). Leave
  those alone when touching web records.

## Runbook

| Task | How |
| --- | --- |
| Force a rebuild | Re-deliver the latest delivery in GitHub → Settings → Webhooks → Recent Deliveries; or on the host run `sudo -u www-data hugo -s /home/main/shreyafadia.com -d /home/main/shreyafadia.com/public` (note `sudo -u www-data`) |
| Watch a deploy | `ssh main.hetzner.deb 'tail -f /var/log/webhook.log'` |
| A deploy ran but the site didn't change | Check the delivery status in GitHub (a failed deploy returns **500**) and `/var/log/webhook.log`. Most common cause is `.git` ownership drift — see [Ownership](#ownership-important); repair with `sudo chown -R www-data:www-data /home/main/shreyafadia.com` |
| Restart the OAuth broker | `ssh main.hetzner.deb 'sudo systemctl restart cms-oauth'` (status: `systemctl status cms-oauth`) |
| Renew TLS | Automatic (certbot timer). Manual: `sudo certbot renew` |
| Rotate the webhook secret | Update `SECRET=` in the build-hook script **and** the secret in the GitHub webhook |
| Rotate the OAuth client secret | Generate a new secret on the GitHub OAuth App, update `OAUTH_CLIENT_SECRET` in `/etc/cms-oauth/env`, then `sudo systemctl restart cms-oauth` |

## Local development

- `hugo server` for a live preview.
- `static/admin/config.yml` has `local_backend: false`. To edit content locally
  against a running `decap-server`, flip it to `true` and run the Decap proxy
  (`npx decap-server`); revert before committing.

## Known cruft / cleanup candidates

These are harmless but worth tidying:

- **Netlify Identity widget** is still loaded in `static/admin/index.html` (and
  the root `index.html`): `https://identity.netlify.com/v1/netlify-identity-widget.js`.
  It is unused with the GitHub backend + self-hosted broker and can be removed —
  doing so also drops the last stray Netlify reference from the admin page.
- **Root `index.html`** is leftover scaffolding ("Nice. It's looking good
  already.") and is **ignored by Hugo** (Hugo builds from `content/`/`layouts/`/
  `static/`); safe to delete.
- **`.gitmodules`** declares a `gruvhugo-theme-fork` submodule (a GitLab SSH URL)
  that is not actually used — the theme is vendored directly under
  `themes/gruvhugo`, and `git submodule status` is empty. Safe to remove the
  stale `.gitmodules` entry.
- **`package.json`** lists `decap-cms@^3.5.0`, but the site loads a vendored
  `static/js/decap-cms_3.0.0.js`; `node_modules` is gitignored and not used by the
  Hugo build. Either bump+vendor a matching version or drop the unused manifest.
- **Retired infrastructure:** the old DigitalOcean droplet (`165.227.215.80`) and
  the Netlify project should be destroyed/disconnected; the old, now-unused OAuth
  client secret on the GitHub App can be deleted.

## Hardening notes

- The OAuth broker binds `:8090` on all interfaces; it's only meant to be reached
  through nginx (`/auth`, `/callback`). Consider binding it to `127.0.0.1` or
  firewalling the port.
- The build hook embeds the webhook secret in the script file; keep its
  permissions tight (`root:root`, `0755`) and rotate the secret if it leaks.
