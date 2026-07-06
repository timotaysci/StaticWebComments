<p align="center">
  <img src="docs/logo.svg" width="120" alt="Static Web Comments logo — a speech bubble with a function bolt inside" />
</p>

<h1 align="center">Static Web Comments</h1>

<p align="center">
  <a href="https://github.com/timotaysci/StaticWebComments/actions/workflows/ci.yml"><img src="https://github.com/timotaysci/StaticWebComments/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2a78d6" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-339933" alt="Node 20 or later" />
  <img src="https://img.shields.io/badge/runs%20on-Azure%20SWA%20Free%20tier-0078D4" alt="Runs on the Azure Static Web Apps Free tier" />
  <img src="https://img.shields.io/badge/runtime%20cost-~%C2%A30%2Fmonth-2a9d3f" alt="Runtime cost approximately zero per month" />
</p>

<p align="center"><em>Own your comment box.</em></p>

First-party blog comments for **Azure Static Web Apps** — no third-party service, no cookies, no tracking, and effectively no cost. The API runs on the managed Azure Functions that are already included in the SWA **Free tier**; comments live in an Azure Table Storage account that costs pennies per year at blog scale.

Built after one too many hosted comment services broke or was abandoned. ~200 lines of API you can read in one sitting.

**See it live** on any post at [timothyjohnsonsci.com](https://timothyjohnsonsci.com/writing/) — and the full build story (dead vendors, the honeypot, the `admin*` route trap, the ROI maths) is written up here: [Has the build vs buy maths changed? A small, yet practical, example](https://timothyjohnsonsci.com/writing/2026-07-06-building-first-party-comments-with-claude-code/).

## Features

- **Anonymous commenting** — name + comment text only; no accounts, no email collected, no IP stored
- **Pre-moderation** — nothing appears publicly until you approve it
- **Honeypot spam trap** — a hidden field bots fill in; the server silently discards their submission while telling them it succeeded
- **Flood guard** — a page stops accepting new comments once too many sit unmoderated
- **Moderation page** — approve/delete queued comments and delete published ones, gated behind SWA's built-in GitHub login with a `moderator` role
- **Push notifications** (optional) — new comments ping your phone via [ntfy](https://ntfy.sh) with a tap-through to the moderation queue
- **Framework-free widget** — a drop-in `<div>` + script for any static site; all user content rendered via `textContent` (no HTML injection)

## How it works

```
Browser ── POST /api/comments ──► SWA managed function ──► Azure Table Storage
   ▲                                      │                      (approved=false)
   └── GET /api/comments?pageId=… ◄───────┘ (approved only)

You ── /admin/comments (GitHub login, "moderator" role)
        └── GET/POST /api/moderation ──► approve / delete
```

One table, partitioned by page path. Comments are written `approved: false` and only the moderation endpoints can flip or remove them.

## Quickstart

Prerequisites: an Azure Static Web App deployed from GitHub, and the `az` CLI logged in.

**1. Copy `api/` into your repository root**, then tell your deploy workflow about it — in the `Azure/static-web-apps-deploy` step add:

```yaml
api_location: "api"
```

**2. Merge `staticwebapp.config.example.json`** into your `staticwebapp.config.json` (the `platform.apiRuntime`, the three route rules, and the 401 redirect).

**3. Create the storage** (Standard LRS is plenty; pick your own names/region):

```
az storage account create -n <yourname>comments -g <your-rg> -l westeurope --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
az storage table create --connection-string "$(az storage account show-connection-string -n <yourname>comments -g <your-rg> -o tsv)" -n comments
```

**4. Configure the Static Web App:**

```
az staticwebapp appsettings set -n <your-swa> --setting-names "TABLES_CONNECTION=$(az storage account show-connection-string -n <yourname>comments -g <your-rg> -o tsv)" "PAGE_ID_PATTERN=^/blog/[a-z0-9-]+/$"
```

Set `PAGE_ID_PATTERN` to match *your* content paths — it stops bots creating junk comment threads on made-up URLs.

**5. Add the widget** to your post template:

```html
<link rel="stylesheet" href="/comments.css" />
<div data-swc-comments></div>
<script src="/comments.js" defer></script>
```

Copy `widget/comments.js` and `widget/comments.css` into your static assets. The thread key defaults to `location.pathname`; override with `data-page-id` if you need to.

**6. Add the moderation page:** copy `admin/comments/index.html` into your site so it deploys at `/admin/comments/`. Exclude `/admin/` from your sitemap and robots.txt.

**7. Invite yourself as moderator** (SWA Free tier includes role invitations):

```
az staticwebapp users invite -n <your-swa> -g <your-rg> --authentication-provider GitHub --user-details <your-github-username> --role moderator --domain <your-domain> --invitation-expiration-in-hours 168
```

Open the returned URL while signed into GitHub.

**8. (Optional) notifications:** install the ntfy app, pick a random un-guessable topic name, and:

```
az staticwebapp appsettings set -n <your-swa> --setting-names "NTFY_TOPIC=<your-secret-topic>" "ADMIN_URL=https://<your-domain>/admin/comments/"
```

Treat the topic name as a secret — ntfy topics are not authenticated on the free server.

Push, let the workflow deploy, and comment on one of your own posts. It should land in `/admin/comments/` awaiting approval (and ping your phone, if you did step 8).

## Configuration reference

App settings on the Static Web App (Portal → Environment variables, or `az staticwebapp appsettings set`):

| Setting | Required | Default | Purpose |
|---|---|---|---|
| `TABLES_CONNECTION` | yes | — | Storage account connection string |
| `PAGE_ID_PATTERN` | recommended | `^/[a-zA-Z0-9/_-]{1,200}$` | Regex a `pageId` must match; tighten to your content paths |
| `COMMENTS_TABLE` | no | `comments` | Table name |
| `NTFY_TOPIC` | no | — | Enables push notifications via ntfy.sh |
| `ADMIN_URL` | no | — | Click-through URL on notifications |
| `MODERATOR_ROLE` | no | `moderator` | Role checked by the moderation endpoint |
| `MAX_NICKNAME_LENGTH` | no | `50` | |
| `MAX_CONTENT_LENGTH` | no | `4000` | |
| `MAX_PENDING_PER_PAGE` | no | `25` | Flood guard threshold |

## Security model

- **Moderation-first**: spam can reach your queue but never your readers.
- **Honeypot** (`website` field): filled → the API returns a fake success and stores nothing, so bots don't learn to adapt.
- **Role gating twice**: SWA route rules block `/api/moderation*` at the edge for anyone without the `moderator` role, and the function re-checks the `x-ms-client-principal` header in code.
- **Output safety**: the widget and moderation page only ever render user content with `textContent`.
- **Data minimisation**: name, comment text, page, timestamp. No email requested, no IP recorded — your privacy policy gets shorter, not longer.

## Gotchas (learned the hard way)

- **API routes must not start with `admin`.** The Functions host reserves `admin*` for its internal administration API and *silently refuses to register your endpoint* — the function deploys, shows in the portal, and 404s forever. This is why the moderation endpoint is `/api/moderation`.
- **Debug with a local Functions host, not the deployed one.** Azure swallows the registration error above; `func start` prints it. See below.
- **Framework users**: if you rebuild the widget in Astro/Vue/Svelte with scoped styles, remember that scoped CSS won't match elements your script creates at runtime — use global styles for the comment cards.
- **Table key characters**: partition keys can't contain `/ \ # ?`, so page paths are sanitised to `_writing_my-post_`-style keys. Two paths that differ only in stripped characters would collide — in practice URL slugs never do.

## Local development

```
cd api && npm install
FUNCTIONS_WORKER_RUNTIME=node TABLES_CONNECTION="<connection-string>" func start --javascript
```

To exercise the moderation endpoint locally, fake the SWA auth header:

```
curl http://localhost:7071/api/moderation -H "x-ms-client-principal: $(printf '{"identityProvider":"github","userDetails":"you","userRoles":["anonymous","authenticated","moderator"]}' | base64 -w0)"
```

## Cost

- SWA managed functions: **£0** — included in the Free tier, cannot bill separately.
- Table Storage: pennies. Roughly 4p per *million* reads; a blog's comment volume rounds to zero.
- ntfy.sh: free.

A sensible companion is a small monthly budget alert on the subscription so any surprise (on anything, not just this) emails you.

## License

MIT — see [LICENSE](LICENSE). Built by [Timothy Johnson](https://timothyjohnsonsci.com) with [Claude Code](https://github.com/anthropics/claude-code).
