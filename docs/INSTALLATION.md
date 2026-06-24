# Installation: Cloudflare + GitHub

Schritt-für-Schritt-Anleitung für die Einrichtung des Page-Speed-Testers — **nur mit Cloudflare-Dashboard und GitHub**, ohne lokale CLI zwingend nötig.

Referenz-Installation: **mydomain.tld** (Stand: Juni 2026)

---

## Übersicht: Wer macht was?


| Komponente         | Wo             | Aufgabe                                                |
| ------------------ | -------------- | ------------------------------------------------------ |
| **Lighthouse**     | GitHub Actions | Führt Page-Speed-Tests aus (braucht Chrome)            |
| **Worker**         | Cloudflare     | API, Auth, Sessions, Cron → startet GitHub pro Projekt |
| **R2**             | Cloudflare     | Speichert Lighthouse-JSON-Berichte                     |
| **D1**             | Cloudflare     | SQLite-Metriken für Dashboard-Charts                   |
| **KV**             | Cloudflare     | Rate-Limit beim manuellen Trigger                      |
| **Pages**          | Cloudflare     | Statisches Dashboard (HTML/JS)                         |
| **GitHub Secrets** | GitHub         | Upload von Actions → R2 + Worker-API                   |


Lighthouse läuft **nicht** direkt in Cloudflare Workers (kein Chrome dort).

---

## Wo welche Umgebungsvariable hingehört


| Variable                                    | Wo setzen                                                    | Wann                              | Zweck                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------- |
| **`D1_DATABASE_ID`**, **`KV_NAMESPACE_ID`** | **Workers → Git deploy → Build environment variables**       | Vor jedem Worker-Deploy           | Generiert `wrangler.toml` (Bindings)                                                     |
| **`PST_API_URL`**                           | **Pages → Build environment variables**                      | Beim Pages-Deploy (Build-Schritt) | Worker-URL in `dashboard/config.js` (optional bei Custom Domain — Fallback `api.<host>`) |
| `COOKIE_DOMAIN`                             | **Admin → Instance settings** (D1); optional Worker `[vars]` | Worker-Laufzeit                   | Session-Cookie für Dashboard + API (z. B. `.page-speed-tester.mydomain.tld`)             |
| `DASHBOARD_ORIGIN`                          | optional Worker `[vars]`                                     | Worker-Laufzeit                   | Zusätzliche Dashboard-Origins für CORS (kommagetrennt, volle URLs)                       |
| `GH_OWNER`, `GH_REPO`                       | **Admin → Instance settings** (D1); optional Worker `[vars]` | Worker-Laufzeit                   | GitHub `repository_dispatch`-Ziel                                                        |
| `SESSION_SECRET`                            | **Worker → Secrets**                                         | Worker-Laufzeit                   | Session-Verschlüsselung                                                                  |
| `GH_PAT`                                    | **Worker → Secrets**                                         | Worker-Laufzeit                   | GitHub API                                                                               |
| `WORKER_API_SECRET`                         | **Worker → Secrets** + **GitHub Secrets**                    | Worker + Actions                  | Upload `/api/runs`, interne URL-API                                                      |
| `WORKER_API_URL`                            | **GitHub Secrets** (optional lokal in `.env`)                | GitHub Actions                    | Worker-Basis-URL in CI                                                                   |
| `R2_*`                                      | **GitHub Secrets** (optional lokal in `.env`)                | GitHub Actions                    | Upload nach R2                                                                           |


**Wichtig:** `PST_API_URL` ist **keine** Worker-Variable. Sie wird nur beim **Pages-Build** gelesen (`node scripts/dashboard/prepare-dashboard.mjs`) und landet als `window.PST_API_URL` im statischen Dashboard. Der Worker kennt sie nicht.

In Cloudflare Pages: **Settings → Environment variables →** Typ **Build** (nicht „Runtime“) wählen, falls das Dashboard beides anbietet.

---

## Live-URLs (mydomain.tld)


| Dienst                | URL                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- |
| **Dashboard (Pages)** | [https://page-speed-tester.mydomain.tld](https://page-speed-tester.mydomain.tld)         |
| **Worker API**        | [https://api.page-speed-tester.mydomain.tld](https://api.page-speed-tester.mydomain.tld) |
| Health-Check          | `GET /health` auf der **API**-URL                                                        |


### R2 Endpoints (für GitHub Secret `R2_ENDPOINT`)


| Variante                                            | URL                                                |
| --------------------------------------------------- | -------------------------------------------------- |
| Account-Endpoint (**empfohlen** für GitHub Actions) | `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com` |
| Custom Domain                                       | `https://bucket-page-speed-reports.mydomain.tld`   |
| Custom Domain (alternativ)                          | `https://bucket.page-speed-tester.mydomain.tld`    |


Bucket-Name: `page-speed-reports`

---

## Voraussetzungen

- Cloudflare-Account (Workers Paid ~5 $/Mo empfohlen)
- **Eigenes** GitHub-Repository mit diesem Code (Lighthouse-Workflow läuft dort)
- Zugriff auf **Cloudflare Dashboard** und **GitHub Repo Settings**

### Praxis — ein GitHub-Repo pro Kunde (kein leeres Repo)

**Kurzantwort:** Nein — ein **leeres** GitHub-Repo reicht **nicht**. Der Kunde braucht eine **Kopie dieses Projekts** (mit Workflow, Skripten und `package.json`), deployt Worker und Dashboard in **seinen** Cloudflare-Account und trägt **dieselbe** Repo-URL in den Admin-Einstellungen ein.

#### Was passiert beim „Run test“?

```
Dashboard / Cron  →  Cloudflare Worker (Kunde)
                         │
                         │  repository_dispatch
                         ▼
                   GitHub Actions im Kunden-Repo
                         │
                         ├─ URLs vom Worker laden
                         ├─ Lighthouse (Chrome)
                         └─ Ergebnisse → R2 + D1 (beim Kunden)
```

Der Worker ruft **nicht** Lighthouse selbst auf. Er sendet nur an GitHub: „Starte Workflow in Repo X“. GitHub Actions braucht deshalb die Dateien aus diesem Repository — mindestens:


| Pfad                                 | Zweck                      |
| ------------------------------------ | -------------------------- |
| `.github/workflows/lighthouse.yml`   | Workflow (wird getriggert) |
| `scripts/ci/lighthouse-audit.sh`     | Lighthouse-Aufruf          |
| `package.json` + `package-lock.json` | `npm ci` im Workflow       |


Empfohlen wird das **gesamte** Repository (Worker-Code, Dashboard, Actions) — nicht nur ein Minimal-Subset.

#### Was legt der Kunde konkret an?


| Schritt | Aktion                                                                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | **GitHub-Repo** mit Projektcode anlegen — z. B. Template/Fork vom öffentlichen Upstream `[page-speed-tester-demo](PUBLIC-UPSTREAM.md#benennung-github-ordner-cloudflare)` → eigenes privates Repo `meine-firma/page-speed-tester` |
| 2       | **Cloudflare:** D1, R2, KV anlegen; **Build-Env** `D1_DATABASE_ID` + `KV_NAMESPACE_ID`; Worker Secrets; deployen                                                                                                                  |
| 3       | **Cloudflare Pages:** **dasselbe** Repo verbinden, Dashboard bauen/deployen                                                                                                                                                       |
| 4       | **GitHub Secrets** im Kunden-Repo (`WORKER_API_URL`, `WORKER_API_SECRET`, `R2_*`)                                                                                                                                                 |
| 5       | **Worker Secret** `GH_PAT` — PAT mit Zugriff auf **dieses** Repo                                                                                                                                                                  |
| 6       | **Admin → Instance settings:** GitHub owner + repository, cookie domain, timezone                                                                                                                                                 |


In Schritt 6 trägt der Kunde **`meine-firma`** und **`page-speed-tester`** ein — genau das Repo, in dem der Workflow liegt und aus dem Worker/Pages deployt wurden.

#### Repo anlegen — welcher Weg?


| Weg                             | Beschreibung                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GitHub Template** (empfohlen) | Upstream `[page-speed-tester-demo](PUBLIC-UPSTREAM.md)` als Template → Kunde: **Use this template** → eigenes privates Repo (kein Pflicht-Fork, volle Kopie) |
| **Clone + Push**                | Repo klonen, als neues Repo unter Kunden-Org pushen                                                                                                          |
| **ZIP / Import**                | Archiv entpacken, in neues Repo committen                                                                                                                    |


**Nicht ausreichend:** leeres Repo, nur Workflow-Datei ohne `package-lock.json`, oder ein Repo ohne Verbindung zu den Cloudflare-Ressourcen des Kunden.

#### Privates Repo des Anbieters?

Fork ist oft unpraktisch (Rechte, Sichtbarkeit). Stattdessen: **Template** oder **Kopie** — der Kunde betreibt eine **eigenständige Instanz** (eigene CF, eigene D1, eigener PAT), nicht einen Fork mit Sync zum Anbieter.

---

## Teil 1 — Cloudflare

### Schritt 1: Plan prüfen

**Dashboard → Account Home**

Workers Paid wird empfohlen (Cron, D1, längere Laufzeit). Free-Tier reicht zum Testen eingeschränkt.

---

### Schritt 2: R2 Bucket (JSON-Berichte)

1. **Storage & databases → R2 Object Storage → Create bucket**
2. Name: `page-speed-tester-reports`
3. Storage Class: Standard

**API-Token für GitHub Actions:**

1. **R2 → Manage R2 API Tokens → Create API token**
2. Permission: **Object Read & Write** auf diesen Bucket
3. Notieren:
  - Access Key ID
  - Secret Access Key
  - Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`  
  (Account ID steht in der Cloudflare-Sidebar)

Diese Werte kommen später in **GitHub Secrets** (Teil 2).

---

### Schritt 3: D1 Datenbank (Metriken)

#### Anlegen

1. **Storage & databases → D1 SQL Database → Create**
2. Name: `page-speed-tester-db`
3. **Database ID** notieren (UUID für `wrangler.toml`)

#### Schema ausführen

Die Datenbank muss **leer** sein (neue Installation). In der D1 Console (**Storage & databases → D1 → `page-speed-tester-db` → Console**) den gesamten Inhalt von `[schema.sql](../schema.sql)` einfügen und ausführen:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  access_key TEXT NOT NULL UNIQUE,
  share_token TEXT UNIQUE,
  cron_expression TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scheduled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS urls (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_users (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Europe/Berlin');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cron_enabled', '1');

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  url_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  run_at TEXT NOT NULL,
  performance REAL,
  lcp_ms REAL,
  cls REAL,
  fcp_ms REAL,
  tbt_ms REAL,
  speed_index REAL,
  report_key TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK(trigger_source IN ('cron', 'manual')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_project_url ON runs(project_id, url_id, strategy, run_at);
```

**Alternativ per Wrangler** (lokal oder remote):

```bash
npm run db:migrate:remote
```

Prüfen unter **Tables** → `projects`, `urls`, `users`, `project_users`, `sessions`, `runs` müssen erscheinen.

**Hinweis:** Projekte und URLs legst du danach im Dashboard unter **Admin** an — nicht per SQL. Der erste Admin-User wird beim ersten Login über **Initial setup** im Dashboard erstellt.

---

### Schritt 4: KV Namespace (Worker)

#### Rückfrage: Wo lege ich `RATE_LIMIT` an? Gibt es eine übergeordnete Projekt-Gruppe?

**Antwort:** Nein. In Cloudflare KV gibt es nur **Namespaces** (Container) und darin **Keys** (werden vom Worker automatisch geschrieben).


| Begriff                      | Was du machst                                                       |
| ---------------------------- | ------------------------------------------------------------------- |
| **Namespace-Name** (in CF)   | Einmal anlegen, z. B. `page-speed-tester-worker-kv`                 |
| **Binding-Name** (am Worker) | `KV` — exakt so, wie im Code (`env.KV`)                             |
| **Keys** (z. B. `last-run:…`, `run-status:…`) | Nicht manuell anlegen — der Worker schreibt sie |


1. **Workers & Pages → KV → Create a namespace**
2. Name: `page-speed-tester-worker-kv`
3. **Namespace ID** notieren

---

### Schritt 5: Worker (API + Trigger)

#### Git-Verbindung

1. **Workers & Pages → Create → Workers → Connect to Git**
2. **Worker-Name** in Cloudflare: `page-speed-tester-api` (erscheint auch als `*.workers.dev`-Subdomain)
3. Repo (z. B. `meine-firma/page-speed-tester`), Branch `main`
4. Deploy command: `node scripts/generate-wrangler.mjs && npx wrangler deploy`
5. **Path / Root directory:** leer oder `/` (Repo-Root) — **nicht** `dashboard`

#### Worker Build environment variables (Git deploy)

Unter **Workers → dein Worker → Settings → Variables and secrets → Build** (nicht Runtime):


| Variable          | Pflicht  | Beispiel / Quelle                                 |
| ----------------- | -------- | ------------------------------------------------- |
| `D1_DATABASE_ID`  | ✅        | D1 → `page-speed-tester-db` → Database ID                |
| `KV_NAMESPACE_ID` | ✅        | KV → `page-speed-tester-worker-kv` → Namespace ID |
| `WORKER_NAME`     | optional | `page-speed-tester-api` (Default im Script; Demo-Staging z. B. `page-speed-tester-demo-api`) |
| `CRON_EXPRESSION` | optional | `*/5 * * * *` |


Das Script [`scripts/generate-wrangler.mjs`](../scripts/generate-wrangler.mjs) schreibt daraus `wrangler.toml` (gitignored, nicht committen). **Kein** manuelles Bearbeiten der Datei nötig — Fork auf GitHub, IDs nur in Cloudflare.

#### Worker Secrets (Runtime)

Unter **Workers → Settings → Secrets** (verschlüsselt, bleiben über Deploys):


| Secret              | Pflicht |
| ------------------- | ------- |
| `SESSION_SECRET`    | ✅       |
| `GH_PAT`            | ✅       |
| `WORKER_API_SECRET` | ✅       |


**Nicht** als Plain-Text Build-Variable — nur Secrets. Kein `[vars]` in `wrangler.toml` nötig; GitHub-Repo und Cookie-Domain → **Admin → Instance settings** (D1).

#### Sync-Warnung „nicht synchron mit wrangler.toml“

Tritt auf, wenn du **Plain-Text-Variables** im Dashboard pflegst, die Wrangler aus der Datei erwartet. Dieses Projekt nutzt **keine** Runtime-`[vars]` in `wrangler.toml` — nur Build-Env für die Generierung. Secrets separat; Instanz-Config in D1. Dann keine doppelte Pflege nötig.

#### Lokale Entwicklung (optional)

IDs in `.env` (`D1_DATABASE_ID`, `KV_NAMESPACE_ID`), dann `npm run deploy` — dasselbe Script wie auf Cloudflare.

**Instanz-Einstellungen (Admin):** GitHub owner/repo, cookie domain (z. B. `.kunde.de`), timezone — alles kundenspezifisch, nicht in `wrangler.toml`.

Die **Cookie domain** muss Parent-Domain von Dashboard **und** API sein (z. B. `.page-speed-tester.mydomain.tld` für `page-speed-tester.mydomain.tld` + `api.page-speed-tester.mydomain.tld`). Leer lassen bei `*.pages.dev`.

Commit + Push → Cloudflare baut neu.

#### Bindings (Worker → Settings)


| Binding-Typ | Name in CF                    | Variable name |
| ----------- | ----------------------------- | ------------- |
| D1          | `page-speed-tester-db`        | `DB`          |
| R2          | `page-speed-tester-reports`   | `REPORTS`     |
| KV          | `page-speed-tester-worker-kv` | `KV`          |


#### Secrets (Worker → Settings → Variables → Secrets)


| Secret              | Inhalt                                       | Nie ins Git! |
| ------------------- | -------------------------------------------- | ------------ |
| `SESSION_SECRET`    | Langer Zufallsstring für Session-Cookies     | ✅            |
| `GH_PAT`            | GitHub Personal Access Token                 | ✅            |
| `WORKER_API_SECRET` | Zufallsstring für Upload-API + GitHub intern | ✅            |


`GH_OWNER`, `GH_REPO`, `COOKIE_DOMAIN` — in **Admin → Instance settings** (D1); optional als `[vars]`-Fallback in `wrangler.toml`. PAT nie ins Git.

#### Rückfrage: GitHub PAT — welche Permissions?

**Empfohlen: Fine-grained PAT**

- Repository access: nur `page-speed-tester`
- **Contents: Read and write** (für `repository_dispatch`)
- Metadata: Read (automatisch)

**Alternative Classic PAT:** Scope `repo` (privat) oder `public_repo` (öffentlich) — breitere Rechte als nötig.

Nicht nötig: `workflow`, `actions:write`, `admin:`*

#### Rückfrage: PAT versehentlich in `wrangler.toml` / Git?

GitHub Push Protection blockiert den Push. **Sofort:**

1. Token auf GitHub **widerrufen**
2. Neuen PAT erstellen → nur als Worker-Secret `GH_PAT`
3. `GH_REPO` muss der Repo-Name sein (`page-speed-tester`), nicht der Token

#### Cron (projektbezogen)

Der Worker läuft alle **15 Minuten** (`*/15 * * * *`) und prüft pro Projekt den konfigurierten Cron-Ausdruck (z. B. `0 6 * * *` = täglich 06:00 UTC). Fällige Projekte werden per `repository_dispatch` mit `project_id` gestartet.

In [`wrangler.toml`](../wrangler.toml):

```toml
[triggers]
crons = ["*/15 * * * *"]
```

Cron pro Projekt im **Admin-Dashboard** oder via `PATCH /api/projects/:id` setzen.

#### Deploy prüfen

```
GET https://api.page-speed-tester.mydomain.tld/health
```

Erwartung: `{"status":"ok","service":"page-speed-tester"}`

---

### Schritt 6: Dashboard (Pages) — nicht Worker!

#### Rückfrage: Felder `deploy command: npx wrangler deploy`, `path: dashboard`?

**Antwort:** Das sind **Worker**-Einstellungen. Das Dashboard ist **statisches HTML** → separates **Pages**-Projekt.


|        | Worker (Schritt 5)    | Dashboard (Schritt 6)                   |
| ------ | --------------------- | --------------------------------------- |
| Typ    | Workers               | **Pages**                               |
| Ordner | Repo-Root             | `dashboard/`                            |
| Deploy | `npx wrangler deploy` | Build + statische Dateien (siehe unten) |
| Path   | `/`                   | **nicht** als Worker-Root               |


#### Pages anlegen

1. **Workers & Pages → Create → Pages → Connect to Git**
2. **Project name:** `page-speed-tester-dashboard`
3. Repo + Branch `main`
4. Einstellungen:


| Feld                   | Wert                                           |
| ---------------------- | ---------------------------------------------- |
| Project name           | `page-speed-tester-dashboard`                  |
| Framework preset       | **None**                                       |
| Build command          | `node scripts/dashboard/prepare-dashboard.mjs` |
| Build output directory | `.dashboard-dist`                              |
| Root directory         | leer                                           |


**Build environment variable** — **Pages → Settings → Environment variables → Build** (nicht Worker, nicht Pages Runtime):


| Variable      | Wann setzen?                                                                | Beispiel                                                      |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `PST_API_URL` | **Pflicht** bei `*.pages.dev` / `*.workers.dev`                             | `https://page-speed-tester-api.<account>.workers.dev`         |
| `PST_API_URL` | **Optional** bei Custom Domain (Dashboard auf `page-speed-tester.kunde.de`) | leer → Browser nutzt `https://api.page-speed-tester.kunde.de` |


1. Deploy → URL z. B. `https://page-speed-tester.mydomain.tld` (Pages) + Worker-Custom-Domain `https://api.page-speed-tester.mydomain.tld`

#### Worker-API-URL im Dashboard

`dashboard/config.js` und `dashboard/build-id.txt` werden **nicht** im Repo gepflegt (gitignored). Beim Pages-Build erzeugt `scripts/dashboard/prepare-dashboard.mjs` daraus `.dashboard-dist/` mit `window.PST_API_URL` und Cache-Busting (`?v=<commit>`) für CSS/JS.

**Variante A — Custom Domain (empfohlen für Produktion)**


| Dienst                | URL                                      |
| --------------------- | ---------------------------------------- |
| **Dashboard (Pages)** | `https://page-speed-tester.kunde.de`     |
| **Worker API**        | `https://api.page-speed-tester.kunde.de` |


Cloudflare: Custom Domain auf **Pages** = Dashboard-Host; Custom Domain auf **Worker** = `api.`-Subdomain.

`PST_API_URL` optional — Fallback: `https://api.<dashboard-host>`.  
**Cookie domain** in **Admin → Instance settings** z. B. `.page-speed-tester.kunde.de` (nicht `.kunde.de`, wenn Dashboard nur auf Subdomain liegt).

**Variante B — Cloudflare-Standarddomains (ohne Custom Domain)**


| Dienst     | URL                                               |
| ---------- | ------------------------------------------------- |
| Worker API | `https://page-speed-tester.<account>.workers.dev` |
| Dashboard  | `https://page-speed-tester-dashboard.pages.dev`   |


In Pages **Build-Env** `PST_API_URL` = volle Worker-URL (**Pflicht** — von Pages-Host nicht ableitbar).  
**Cookie domain** in Admin **leer lassen** (Cookie nur API-Domain; CORS erlaubt `*.pages.dev`).

**Lokal:** `npm run dashboard:prepare` (oder automatisch nach `npm install`). Preview: `npm run dev:dashboard`. Ohne `PST_API_URL` → Fallback `http://localhost:8787`.

---

## Teil 2 — GitHub

### Schritt 7: Repository Secrets

**GitHub → Repo → Settings → Secrets and variables → Actions → New repository secret**


| Secret                 | Wert (mydomain.tld)                                |
| ---------------------- | -------------------------------------------------- |
| `R2_ACCESS_KEY_ID`     | aus Schritt 2                                      |
| `R2_SECRET_ACCESS_KEY` | aus Schritt 2                                      |
| `R2_BUCKET`            | `page-speed-reports`                               |
| `R2_ENDPOINT`          | `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com` |
| `WORKER_API_URL`       | `https://api.page-speed-tester.mydomain.tld`       |
| `WORKER_API_SECRET`    | gleicher Wert wie Worker-Secret                    |


---

### Schritt 8: Projekte und URLs konfigurieren

URLs werden im Dashboard unter **Admin** angelegt (oder per API) — nicht im Repo.

1. Dashboard öffnen → **Login** (beim ersten Start: Admin-Account anlegen)
2. **Admin** → Projekt anlegen (Name, Cron-Ausdruck)
3. URLs pro Projekt hinzufügen
4. Pro Projekt zwei Schlüssel in der Spalte **Keys & links**:
  - **Trigger** — startet Lighthouse-Läufe (API-URL, kein Login)
  - **Share** — schreibgeschützte Dashboard-Ansicht für Gäste (`share.html`)

Alternativ per API (`POST /api/projects`, `POST /api/projects/:id/urls`) — nur als **admin** eingeloggt.

GitHub Actions holt URLs zur Laufzeit von `GET /api/internal/projects/{id}/urls` (Bearer `WORKER_API_SECRET`).

---

### Schritt 9: Erster Test

**Option A — Dashboard (empfohlen)**

1. [https://page-speed-tester.mydomain.tld](https://page-speed-tester.mydomain.tld) → Login / Bootstrap
2. Projekt und URL wählen → **Run now**

**Option B — GitHub manuell**

Actions → **Lighthouse Page Speed Tests** → **Run workflow** → `project_id` eingeben (z. B. `default`)

**Option C — API (mit Login)**

```bash
curl -X POST -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"…"}' \
  https://api.page-speed-tester.mydomain.tld/api/auth/login

curl -X POST -b cookies.txt \
  https://api.page-speed-tester.mydomain.tld/api/projects/default/trigger
```

**Option D — öffentlicher Trigger (ohne Login)**

Access-Key steht in der Admin-UI pro Projekt (oder wurde beim Anlegen auto-generiert):

```bash
curl "https://api.page-speed-tester.mydomain.tld/api/public/trigger/default?key=DEIN_ACCESS_KEY"
```

Nur eine URL: `…&url_id=homepage`

Rate-Limit beim manuellen Trigger: max. 1 Lauf alle 5 Minuten pro Projekt (KV).

**Option E — Share-URL (schreibgeschützt, ohne Login)**

Share-Key steht in der Admin-UI neben dem Trigger-Key. Link öffnet das Dashboard im Lesemodus:

```
https://page-speed-tester.mydomain.tld/share.html?project=default&key=DEIN_SHARE_KEY
```

Gäste sehen Metriken, Charts und Berichte **nur für dieses Projekt**. Tests starten, Admin und Löschen sind nicht möglich. Der Share-Key ist vom Trigger-Key getrennt — wer den Share-Link hat, kann keine Tests auslösen.

Share-Key rotieren: Admin → Projekt → ↻ neben Share-Key (alte Links werden ungültig).

Bestehende Datenbanken: einmalig `ALTER TABLE projects ADD COLUMN share_token TEXT UNIQUE;` — fehlende Tokens werden beim ersten Admin-Aufruf automatisch erzeugt.

---

## Berichtsdateien (R2)


| Teil     | Format                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| R2-Pfad  | `reports/{project_id}/2026-06-23T143052Z-desktop-example-com.json`                                                         |
| Muster   | `reports/{project_id}/{yyyy-mm-dd}T{HHMMSS}Z-{desktop                                                                      |
| JSON-URL | `/api/reports/{project_id}/{filename}` (Login erforderlich) oder `/api/public/share/report?key=…&report_key=…` (Share-Key) |


**Hinweis:** Device steht **vor** dem Domain-Slug. Uhrzeit im Dateinamen, damit mehrere Läufe pro Tag eindeutig sind.

---

## FAQ — weitere Rückfragen

### Brauche ich `npm install` / Wrangler lokal?

Nein für den Betrieb. Cloudflare baut aus Git. Lokal nur für Entwicklung:

```bash
npm install
npm run dev
```

### Worker und Pages — zwei Projekte?

Ja. Zwei getrennte Einträge unter **Workers & Pages**:

1. `page-speed-tester-api` (Worker)
2. `page-speed-tester-dashboard` (Pages)

### Was passiert beim Trigger?

```
Dashboard „Run now“ / Cron → Worker repository_dispatch (project_id)
  → GitHub Actions: URLs aus Worker-API laden
  → Lighthouse desktop + mobile pro URL
  → Upload JSON nach R2 (reports/{project_id}/…) + Metriken in D1 via /api/runs
  → Dashboard liest /api/metrics (Session-Cookie)
```

### Erster Admin (Bootstrap)

Wenn noch keine User in D1 existieren: Dashboard zeigt **Initial setup**. Alternativ `POST /api/auth/bootstrap` (einmalig). Danach nur noch Login.

Bootstrap, Login und Admin-User-Anlage nutzen dieselbe Hash-Logik wie das lokale CLI (`shared/password-hash.mjs`: PBKDF2, SHA-256, 100 000 Iterationen).

### Passwort vergessen (Notfall-Reset über D1)

Kein Self-Service-Reset im Dashboard — nur manuell über D1, wenn du keinen Login mehr hast.

**1. Hash lokal erzeugen** (nur Node.js, **ohne** Cloudflare, Wrangler oder Netzwerk):

```bash
npm run hash-password -- 'NeuesSicheresPasswort'
# Ausgabe z. B.: pbkdf2:100000:AbCdEf...=:xYz123...=
```

Alternativ: `node scripts/hash-password.mjs 'NeuesSicheresPasswort'`

**2. Hash in D1 setzen** (Cloudflare Dashboard → D1 → Console, oder Wrangler):

```sql
UPDATE users
SET password_hash = 'pbkdf2:100000:...'
WHERE email = 'admin@example.com';
-- oder: WHERE username = 'admin'
```

**3. Einloggen** mit dem neuen Passwort im Dashboard.

Das CLI-Script schreibt **nicht** in die Datenbank — es liefert nur den String für `users.password_hash`. Der Worker prüft Login mit derselben Funktion (`verifyPassword` aus dem Shared-Modul).

### GitHub Action schlägt fehl (Exit 1)?

Typische Ursachen:

1. **Secrets fehlen** — alle sechs GitHub Secrets gesetzt?
2. **Chrome/Lighthouse** — Workflow nutzt `browser-actions/setup-chrome@v2` + `CHROME_PATH`
3. **Worker API** — `WORKER_API_SECRET` identisch in CF und GitHub?

Logs unter **Actions → fehlgeschlagener Run**.

### Dashboard zeigt „Invalid Date“?

`run_at` in D1 war leer. Behoben im Code: Fallback auf Lighthouse `fetchTime` und Dateiname. Nach Deploy + neuem Lauf korrekt.

### Datumsformat im Dashboard?

`yyyy-mm-dd HH:mm` (UTC) in Tabelle und Charts.

### Wo Secrets **nicht** hingehören


| Wert                                   | Erlaubt                                                     | Verboten                     |
| -------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| `GH_PAT`                               | Worker Secret                                               | `wrangler.toml`, Git         |
| `SESSION_SECRET`                       | Worker Secret                                               | Git                          |
| `WORKER_API_SECRET`                    | Worker Secret + GitHub Secret                               | öffentliche Vars             |
| `GH_OWNER`, `GH_REPO`, `COOKIE_DOMAIN` | Admin (D1) oder optional `wrangler.toml` [vars]             | —                            |
| D1/KV IDs                              | **Workers Build-Env** (`D1_DATABASE_ID`, `KV_NAMESPACE_ID`) | Git, Plain-Text Runtime-Vars |


---

## Checkliste

- R2 Bucket `page-speed-reports` + API-Token
- D1 `page-speed-tester-db` + Schema aus `[schema.sql](../schema.sql)` (D1 Console oder `npm run db:migrate:remote`)
- KV Namespace `page-speed-tester-worker-kv`
- Worker `page-speed-tester-api` deployed, Bindings D1/R2/KV, Secrets (`SESSION_SECRET`, `GH_PAT`, `WORKER_API_SECRET`)
- Workers Git deploy: Build-Env `D1_DATABASE_ID`, `KV_NAMESPACE_ID`; Secrets gesetzt; Build `node scripts/generate-wrangler.mjs && npx wrangler deploy`
- Admin → Instance settings: timezone, GitHub owner/repo, cookie domain (falls Custom Domain)
- Pages `page-speed-tester-dashboard` deployed (`PST_API_URL` als **Pages Build-Env**, nicht Worker)
- GitHub Secrets (6 Stück)
- Admin-Account angelegt, mindestens ein Projekt mit URLs
- `/health` OK
- Erster Workflow-Lauf erfolgreich
- Dashboard zeigt Metriken nach Login

---

Siehe auch [`README.md`](../README.md) für API-Referenz und Architektur.