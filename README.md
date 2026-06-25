<img src="dashboard/assets/img/favicon.svg" alt="Page Speed Tester" width="96">

# Page Speed Tester

Self-hosted **Lighthouse**-Monitoring: Du betreibst eine eigene Instanz auf **Cloudflare** (API, Speicher, Dashboard) und startest die eigentlichen Tests per **GitHub Actions** in **deinem** Repository. Kein zentraler SaaS-Dienst — jede Installation gehört dir.

Typischer Einsatz: mehrere Websites oder Kundenprojekte überwachen, Metriken in Charts vergleichen, Berichte als JSON ablegen, Läufe per Cron oder per Klick auslösen.

---

## Was das Projekt kann

- **Lighthouse** desktop + mobile pro URL (Performance, LCP, CLS, FCP, TBT, Speed Index)
- **Mehrere Projekte** pro Instanz, jeweils mit eigenen URLs und Cron-Zeitplan
- **Dashboard** mit Login, Charts, Berichtsliste und Detailansicht einzelner Lighthouse-JSONs
- **Manueller Start** („Run test“) und **Cron** pro Projekt
- **Benutzer & Rechte:** Admins verwalten alles; normale User sehen nur zugewiesene Projekte
- **Login Rate-Limit:** Schutz vor Brute-Force — fehlgeschlagene Anmeldungen lösen progressives Backoff aus (1s → 2s → 4s …, Deckel 15 Min.), getrackt pro IP und Login in KV; nach erfolgreichem Login wird der Zähler zurückgesetzt
- **[Share-Link](https://page-speed-tester-demo.storyofai.net/share/?project=example-com&key=7c31b74295847e63e0dbffc01e3a416a5ebdb18b9323a1c4b4b858d95d3d37e9):** Schreibgeschützte Dashboard-Ansicht für Gäste — Metriken, Charts und Berichte eines Projekts ohne Login (eigener Share-Key, rotierbar in der Admin-UI)
- **Trigger-URL:** Lighthouse-Lauf per Link oder curl auslösen — ohne Login, mit Access-Key pro Projekt (getrennt vom Share-Key; Rate-Limit: max. 1 Lauf alle 5 Minuten)
- **Speicher:** Metriken in **D1**, vollständige Berichte in **R2** — nichts Kritisches im Git-Repo

Lighthouse läuft **nicht** im Cloudflare Worker (dort kein Chrome). Der Worker steuert nur Auth, API, Cron und den Start des GitHub-Workflows.

---

## Drei Teile — ein System

Alles steckt in **einem GitHub-Repository** (dieses hier), wird aber an **drei Stellen** betrieben:


| Teil           | Wo                    | Ordner / Artefakt                   | Aufgabe                                                                       |
| -------------- | --------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| **API**        | Cloudflare **Worker** | `worker/`                           | REST-API, Login, Projekte/URLs, Cron → `repository_dispatch`, Metriken aus D1 |
| **Dashboard**  | Cloudflare **Pages**  | `dashboard/`                        | Statische UI; spricht die API an                                              |
| **Tests (CI)** | **GitHub Actions**    | `.github/workflows/`, `scripts/ci/` | Lighthouse + Upload nach R2/D1                                                |


```
Dashboard / Cron / Trigger-URL
        │
        ▼
   Worker (API)  ──repository_dispatch──►  GitHub Actions
        │                                        │
        │                                        ▼
        │                                 Lighthouse (Chrome)
        ▼                                        │
   D1 (Metriken) ◄──────────────────────── R2 (JSON-Berichte)
        │
        ▼
   Dashboard (Charts & Berichte)
```

**Wichtig:** Worker und Pages deployen aus **demselben Repo**, aber als **zwei getrennte Cloudflare-Projekte** (`page-speed-tester-api` und `page-speed-tester-dashboard`). Der Workflow läuft im **GitHub-Tab Actions** dieses Repos — nicht auf Cloudflare.

---

## Für wen ist das?

- Du willst **Page Speed selbst hosten** (eigener Account, eigene Domains, eigene Daten).
- Du brauchst **kein leeres GitHub-Repo**: Der Worker triggert ein Repo, in dem **dieser komplette Code** inkl. Workflow liegt.
- Du forkest oder nutzt das Repo als **Template** → du bekommst eine **eigenständige Instanz**. Deine Daten liegen in deinem Cloudflare-Account; niemand anderes sieht deine URLs, Berichte oder Secrets.

---

## Schnellstart (wo es lang geht)

1. Repo anlegen (**Use this template** oder Fork/Kopie) → z. B. `deine-org/page-speed-tester`
2. Cloudflare: D1, R2, KV, Worker, Pages — alles in **deinem** Account
3. GitHub: **Actions Secrets** für R2 und Worker-API
4. Dashboard: **Admin → Instance settings** — GitHub owner/repo auf **dein** Repo setzen
5. Projekte und URLs im Admin anlegen → **Run test**

Schritt-für-Schritt (nur Dashboard + GitHub, ohne Pflicht-CLI): **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

Lokal entwickeln: `npm install` → `npm run dev` (Worker `http://localhost:8787`). Details in der Installationsanleitung.

---

## Live-Demo (Share-Ansicht)

Öffentliche **schreibgeschützte** Dashboard-Vorschau der Demo-Instanz (Projekt `example-com`, nur Lesen — kein Login):

**[page-speed-tester-demo.storyofai.net/share/?project=example-com&key=…](https://page-speed-tester-demo.storyofai.net/share/?project=example-com&key=7c31b74295847e63e0dbffc01e3a416a5ebdb18b9323a1c4b4b858d95d3d37e9)**

So siehst du Charts und Berichte, bevor du eine eigene Instanz aufsetzt.

---

## Dokumentation


| Datei                                        | Inhalt                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Einrichtung Cloudflare + GitHub, Env-Variablen, FAQ, Checkliste            |
| [docs/API.md](docs/API.md)                   | Worker-REST-Endpunkte (Auth, Projekte, Trigger, Share, intern für Actions) |
| [migrations/](migrations/)                   | D1-Schema & Migrationen (Wrangler D1 migrations); siehe `migrations/README.md` |
| [docs/TODOs.md](docs/TODOs.md)               | Geplante Verbesserungen im Repo                                            |


---

## ❗❗❗Öffentlicher Fork oder Template — was du wissen musst❗❗❗

Wenn du dieses **öffentliche** Repo forkest oder als Template nutzt, betreibst du **deine** Installation. Der Upstream sieht deine Läufe, URLs und Cloudflare-Daten **nicht** — aber ein paar Konsequenzen sind wichtig:

### GitHub Actions

- Der Workflow [.github/workflows/lighthouse.yml](.github/workflows/lighthouse.yml) liegt in **deinem** Repo. Läufe erscheinen unter **deinem** Tab **Actions** (bei öffentlichem Repo für alle mit Lesezugriff sichtbar).
- **Welche URLs getestet werden**, steht in **deiner** D1-Datenbank — du legst Projekte und URLs im Dashboard (Admin) an. Ein Fork übernimmt **keine** Test-URLs aus einer fremden Installation; solange du nichts einträgst, gibt es nichts zu testen.
- Unter **Settings → Secrets and variables → Actions** hinterlegst **du** die Zugangsdaten (`R2_`*, `WORKER_API_URL`, `WORKER_API_SECRET`). Damit schreibt der Workflow nur in **deinen** R2-Bucket und spricht nur **deine** Worker-API an — völlig getrennt von anderen Forks oder vom Original-Repo.
- Der Worker braucht ein **GitHub PAT** (`GH_PAT`) mit Zugriff auf **dein** Repo sowie in den Instance settings **deinen** `gh_owner` / `gh_repo`.

### URLs in Logs und Artefakten

- In Action-Logs und Report-Dateinamen erscheinen die **von dir konfigurierten Seiten-URLs** (z. B. `https://kunde.example/…`). Bei einem **öffentlichen** Fork können Mitleser mit Repo-Zugriff die Actions-Historie sehen — also keine geheimen Ziel-URLs in ein öffentliches Repo legen, wenn das für dich problematisch ist. **Privates Repo** + private Instanz ist der übliche Weg für Kundenprojekte.
- Lighthouse-JSON landet in **deinem** R2-Bucket; Metriken in **deiner** D1 — nicht im Git-Commit.

### Cloudflare & Domains

- Worker- und Pages-URLs (`*.workers.dev`, `*.pages.dev` oder eigene Domains) sind **deine**. Das Dashboard braucht beim Pages-Build ggf. `PST_API_URL` auf **deine** Worker-URL (siehe Installation).
- Rate-Limit manueller Trigger: max. **1 Lauf alle 5 Minuten** pro Projekt (KV im Worker).

### Empfehlung


| Ziel               | Vorgehen                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| Produktion / Kunde | **Template** oder Kopie → **privates** Repo, eigener CF-Account           |
| Demo / Lernen      | Öffentlicher Fork OK — mit Test-URLs, keine Produktions-Secrets           |


---

## Technik in einem Satz

**Node.js 24+**, TypeScript-Worker (Wrangler), statisches Dashboard, GitHub Actions mit Lighthouse 12 — Deploy über Cloudflare Git-Integration; `wrangler.toml` wird beim Build aus `[wrangler.toml.template](wrangler.toml.template)` generiert (nicht committen).

---

## Lizenz & Mitwirken

Quellcode steht unter der **[MIT-Lizenz](LICENSE)** (üblich für Open-Source-Software auf GitHub). Du darfst das Projekt nutzen, ändern und weitergeben — siehe [LICENSE](LICENSE) für die vollständigen Bedingungen.

Beiträge willkommen — Issues und PRs gegen dieses Repo.