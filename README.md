# Page Speed Tester

Automatischer Lighthouse Page-Speed-Tester mit **GitHub Actions** (Tests), **Cloudflare R2** (JSON-Berichte), **D1** (Metriken) und **Pages** (Dashboard).

## Deployment (mydomain.tld)


| Dienst                | URL                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| **Dashboard (Pages)** | [https://page-speed-tester.mydomain.tld](https://page-speed-tester.mydomain.tld)                     |
| **Worker API**        | [https://api.page-speed-tester.mydomain.tld](https://api.page-speed-tester.mydomain.tld)             |
| **Health-Check**      | [https://api.page-speed-tester.mydomain.tld/health](https://api.page-speed-tester.mydomain.tld/health) |


### R2 Bucket Endpoints

Für GitHub Secret `R2_ENDPOINT` (S3-kompatibel) — einer der folgenden:


| Endpoint                                        | URL                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Account-Endpoint (empfohlen für GitHub Actions) | `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com` |


Bucket-Name: `page-speed-reports`

### Login & Dashboard

Öffne [https://page-speed-tester.mydomain.tld](https://page-speed-tester.mydomain.tld) — beim ersten Besuch Admin-Account anlegen, dann Projekt/URL wählen, Charts ansehen und **Run now** starten.

## Architektur

```
Cron / Dashboard „Run now“ → Worker (Cloudflare, pro Instanz)
  → repository_dispatch → GitHub Actions (im Kunden-Repo)
  → Lighthouse CLI
                          ↓
                  R2 (JSON) + D1 (Metriken)
                          ↓
              Dashboard (Pages, Session-Login)
```

Mehrere **Projekte** pro Instanz; URLs und Cron pro Projekt in D1. Benutzer sehen nur zugewiesene Projekte (Rolle `user`); Admins verwalten alles.

### Self-Hosting — ein Repo pro Kunde

**Nicht** ein leeres GitHub-Repo: Der Worker triggert per `repository_dispatch` ein Repo, in dem der Lighthouse-Workflow und die CI-Skripte liegen (idealerweise **dieses komplette Projekt**).

1. Kunde erstellt Repo aus **Template** dieses öffentlichen Upstreams → z. B. privates `firma/page-speed-tester`
2. Deploy: Worker + Pages in **eigenem** Cloudflare-Account (aus demselben Repo)
3. GitHub Actions Secrets + Worker `GH_PAT` für dieses Repo
4. **Admin → Instance settings:** GitHub owner/repository = dieses Repo

Details: [`docs/INSTALLATION.md`](docs/INSTALLATION.md) → Abschnitt **Praxis — ein GitHub-Repo pro Kunde**.

## Voraussetzungen

- Cloudflare Account (Workers Paid empfohlen, ~$5/Mo)
- **Eigenes GitHub-Repository mit diesem Projektcode** (Workflow + Skripte — kein leeres Repo)
- Node.js 24+

**Ausführliche Einrichtung (Cloudflare Dashboard + GitHub, inkl. FAQ):** [`docs/INSTALLATION.md`](docs/INSTALLATION.md)

## Einrichtung (Kurz)

### 1. Cloudflare-Ressourcen anlegen

```bash
npm install
# D1_DATABASE_ID + KV_NAMESPACE_ID in .env (see .env.example)

wrangler d1 create page-speed-db
wrangler r2 bucket create page-speed-reports
wrangler kv namespace create page-speed-tester-worker-kv
# IDs in .env, dann:
npm run db:migrate:remote
npm run deploy
```

### 2. R2 API-Token für GitHub Actions

Im Cloudflare Dashboard: **R2 → Manage R2 API Tokens → Create API Token** mit Read/Write auf den Bucket.

### 3. Worker Secrets (Cloudflare Dashboard oder CLI)

Bei **Git-Deploy:** Secrets unter **Workers → Settings → Secrets** setzen (nicht Build-Env). Lokal optional:

```bash
wrangler secret put SESSION_SECRET    # z.B. openssl rand -hex 32
wrangler secret put GH_PAT              # GitHub PAT mit repo scope
wrangler secret put WORKER_API_SECRET   # z.B. openssl rand -hex 32
```

In `wrangler.toml` stehen nur Bindings und Cron — die Datei wird aus [`wrangler.toml.template`](wrangler.toml.template) + **`D1_DATABASE_ID`** / **`KV_NAMESPACE_ID`** generiert (`npm run wrangler:generate`). Keine Secrets in der Datei.

Unter **Admin → Instance settings:** GitHub owner/repository, cookie domain (z. B. `.deine-domain.net`, leer für Pages-Preview), timezone.

### 4. GitHub Secrets

Im Repository unter **Settings → Secrets → Actions** (Laufzeit der GitHub Actions, nicht Worker, nicht Pages):


| Secret                 | Beschreibung                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `R2_ACCESS_KEY_ID`     | R2 API Token Access Key                                                            |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret                                                                |
| `R2_BUCKET`            | `page-speed-reports`                                                               |
| `R2_ENDPOINT`          | `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com` |
| `WORKER_API_URL`       | `https://api.page-speed-tester.mydomain.tld`                                       |
| `WORKER_API_SECRET`    | Gleicher Wert wie Worker Secret                                                    |


### 5. Projekte & URLs

Im Dashboard unter **Admin** anlegen (oder per API).

### 6. Deploy

```bash
# Worker deployen
npm run deploy

# Dashboard deployen (PST_API_URL aus lokaler .env, falls gesetzt)
npm run deploy:dashboard
```

### Umgebungsvariablen — Kurzüberblick

| Variable | Wo | Typ |
| -------- | -- | --- |
| `D1_DATABASE_ID`, `KV_NAMESPACE_ID` | **Workers → Build env** (Git deploy) | Build |
| `PST_API_URL` | **Cloudflare Pages → Build env** | Build (nicht Worker, nicht Pages Runtime) |
| `COOKIE_DOMAIN`, `GH_OWNER`, `GH_REPO` | **Admin → Instance settings** (D1); optional Worker `[vars]` | Worker-Laufzeit |
| `DASHBOARD_ORIGIN` | optional Worker `[vars]` | Worker-Laufzeit |
| `SESSION_SECRET`, `GH_PAT`, `WORKER_API_SECRET` | **Worker Secrets** | Worker-Laufzeit |
| `WORKER_API_URL`, `WORKER_API_SECRET`, `R2_*` | **GitHub Secrets** | Actions-Laufzeit |

`PST_API_URL` wird beim Pages-Build in `dashboard/config.js` geschrieben. **Custom Domain:** optional — Fallback im Browser: `https://api.<dashboard-host>`. **Pflicht** bei `*.pages.dev` / `*.workers.dev`. Worker-Custom-Domain: **`api.`**-Subdomain; Dashboard auf kürzerer Pages-/Custom-Domain.

## Nutzung

### Manueller Test

Im Dashboard: Projekt wählen → **Run test**. Oder `POST /api/projects/{id}/trigger` (Session-Cookie, Admin oder zugewiesener User).

**Ohne Login** (Projekt-Access-Key):

```text
GET /api/public/trigger/{project_id}?key={access_key}
```

Optional nur eine URL: `&url_id={url_id}`. Den Key legst du in der Admin-UI pro Projekt fest (auto-generiert oder manuell, max. 64 Zeichen). Später kann derselbe Key auch für Gast-Zugriff auf das Dashboard dienen.

GitHub Actions Fallback: Workflow manuell starten mit Input `project_id`.

Rate-Limit: max. 1 Lauf alle 15 Minuten pro Projekt (KV).

### Cron

Worker-Cron alle **15 Minuten** prüft pro Projekt den konfigurierten Ausdruck (z. B. `0 6 * * *` = täglich 06:00 UTC).

### Dashboard

Login erforderlich. Admins sehen **Admin**-Link für Projekte, URLs, User und Zuweisungen.

## API

| Endpoint | Auth | Beschreibung |
| -------- | ---- | ------------ |
| `POST /api/auth/login` | — | Login → Session-Cookie |
| `POST /api/auth/logout` | Session | Logout |
| `GET /api/auth/me` | Session | Aktueller User |
| `POST /api/auth/bootstrap` | — | Erster Admin (nur wenn keine Users) |
| `GET /api/projects` | Session | Projekte (User: nur zugewiesene) |
| `POST /api/projects` | Admin | Projekt anlegen |
| `GET/POST/PATCH/DELETE /api/projects/:id/urls` | Admin / Session | URL-CRUD |
| `POST /api/projects/:id/trigger` | Session + Zugriff | Lighthouse-Lauf starten |
| `GET /api/public/trigger/:id?key=` | Access key | Lighthouse-Lauf ohne Login |
| `GET /api/metrics?project_id=&url_id=&strategy=` | Session | Metriken-Zeitreihe |
| `GET /api/reports?project_id=&url_id=` | Session | Berichtsliste |
| `GET /api/reports?key=` | Session | Lighthouse JSON |
| `GET /api/internal/projects/:id/urls` | Bearer `WORKER_API_SECRET` | Für GitHub Actions |
| `POST /api/runs` | Bearer `WORKER_API_SECRET` | Metrik eintragen |
| `GET /api/users` … | Admin | User-Verwaltung |


## Lokale Entwicklung

```bash
npm run dev
# Worker auf http://localhost:8787
```

D1 lokal: `npm run db:migrate` · remote: `npm run db:migrate:remote` (führt [`schema.sql`](schema.sql) aus)

## Berichtsformat

R2-Pfad: `reports/{project_id}/2026-06-23T143052Z-desktop-example-com.json`

Dateiname: `{yyyy-mm-dd}T{HHMMSS}Z-{desktop|mobile}-{url-slug}.json` (UTC, eindeutig pro Lauf)