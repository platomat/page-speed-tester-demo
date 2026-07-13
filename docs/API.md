# API-Referenz

Alle Endpunkte laufen auf der **Worker-API** (z. B. `https://api.page-speed-tester.mydomain.tld`).  
Das Dashboard (Pages) ruft dieselben Pfade per `fetch` auf — Basis-URL siehe [`INSTALLATION.md`](INSTALLATION.md) (`PST_API_URL` / Fallback `api.<dashboard-host>`).

## Authentifizierung

| Methode | Header / Cookie | Verwendung |
| ------- | ----------------- | ---------- |
| **Session** | Cookie `pst_session` (HttpOnly) oder `Authorization: Bearer <session_token>` | Dashboard-Login; Token kommt in der Login-Antwort (`session_token`) und wird im Browser in `sessionStorage` gehalten (nötig bei `*.pages.dev` ↔ `*.workers.dev`) |
| **Admin** | Session + Rolle `admin` | User-Verwaltung, Instance settings, Upstream-Sync, Projekt anlegen |
| **Bearer** | `Authorization: Bearer <WORKER_API_SECRET>` | GitHub Actions, interne Upload-/URL-Endpunkte |
| **Access key** | Query `?key=` | Öffentlicher Trigger ohne Login |
| **Share key** | Query `?share_key=` oder `?key=` (Share-Routen) | Schreibgeschütztes Dashboard / Berichte für Gäste |

CORS erlaubt Dashboard-Origins (`api.<host>`-Konvention, `*.pages.dev`, optional `DASHBOARD_ORIGIN`).

---

## Health

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/health` | — | Status-Check (`{"status":"ok","service":"page-speed-tester"}`) |
| `GET` | `/` | — | Wie `/health` |

---

## Auth

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/auth/setup` | — | `{ needs_bootstrap: true/false }` — ob Initial setup nötig ist |
| `POST` | `/api/auth/bootstrap` | — | Ersten Admin anlegen (nur wenn noch keine User in D1) |
| `POST` | `/api/auth/login` | — | Login → `{ user, session_token }` + Session-Cookie. Bei wiederholten Fehlversuchen **429** mit `{ error, retry_after_seconds }` (progressives Backoff in KV, pro IP und Login-Identifier). Falsche Zugangsdaten: **401** `{ error: "Invalid credentials" }` (gleiche Antwort unabhängig davon, ob User existiert). |
| `POST` | `/api/auth/logout` | Session | Session beenden |
| `GET` | `/api/auth/me` | Session | Aktueller User `{ user }` |

---

## Instance settings

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/settings` | Session | Timezone, Cron-Schalter, Report-Retention (Tage), GitHub owner/repo, upstream owner/repo/branch, cookie domain, `upstream_sync_enabled` |
| `PATCH` | `/api/settings` | Admin | Instance settings aktualisieren |

`report_retention_days` (integer, Default `0`): Lighthouse-JSON in R2 löschen, wenn `run_at` älter als X Tage. `0` = aus. D1-`runs` bleiben; `report_bytes` wird auf `NULL` gesetzt. Läuft beim Worker-Cron (unabhängig von Projekt-Cron).

Upstream-Felder (optional, Defaults `platomat` / `page-speed-tester-demo` / `main`): Quelle für **Upstream sync** im Admin.

`upstream_sync_enabled` (boolean): `false`, wenn `PST_INSTANCE_ROLE=upstream` (Demo — per Build-Env in `wrangler.toml` `[vars]`, nicht manuell zur Laufzeit).

---

## GitHub / Upstream sync

Nur wenn `upstream_sync_enabled === true` (Kunden-Instanz; nicht die Demo-Quelle mit `PST_INSTANCE_ROLE=upstream`).

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/github/upstream-status` | Admin | Vergleich deines Repos mit dem Upstream (ahead/behind/diverged) inkl. `last_sync` (letztes Workflow-Ergebnis) |
| `POST` | `/api/github/sync-upstream` | Admin | Upstream in dein Repo mergen. Fork: GitHub `merge-upstream` (synchron). Template-Kopie: löst den Workflow `upstream-sync.yml` aus (`git merge` + push) und antwortet mit `{ ok: true, started: true, method: "workflow-dispatch" }`. Rate-Limit 1×/Minute. Erfordert `GH_PAT` mit **Contents** und **Actions: Read and write**. |
| `POST` | `/api/internal/upstream-sync/result` | Worker-Secret (`WORKER_API_SECRET`) | Der Sync-Workflow meldet hier sein Ergebnis (`status` = `success`/`conflict`/`error`, `sha`, `message`, optional `upstream_commits`: `[{ sha, subject }, …]`). |

`GET /api/github/upstream-status` liefert bei `behind_by > 0` zusätzlich `incoming_commits` (Vorschau der noch nicht gemergten Upstream-Commits). `last_sync.upstream_commits` listet die beim letzten Sync gemergten Commits.

---

## Projekte

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/projects` | Session | Projektliste (User: nur zugewiesene) |
| `POST` | `/api/projects` | Admin | Projekt anlegen |
| `PATCH` | `/api/projects/:id` | Admin | Projekt bearbeiten (Name, Cron, Keys, Screenshot-Flags, …) |
| `DELETE` | `/api/projects/:id` | Admin | Projekt löschen |
| `GET` | `/api/projects/:id/run-status` | Session + Zugriff | Laufstatus (KV) für Dashboard-Polling |
| `DELETE` | `/api/projects/:id/run-status` | Session + Zugriff | Laufstatus zurücksetzen (z. B. nach abgebrochenem GH-Lauf); bricht GitHub **nicht** ab |
| `POST` | `/api/projects/:id/trigger` | Session + Zugriff | Lighthouse-Lauf für gesamtes Projekt starten |
| `POST` | `/api/projects/:id/urls/:url_id/trigger` | Session + Zugriff | Lighthouse-Lauf für eine URL |

**Screenshot-Flags (pro Projekt, Admin):**

`store_fullpage_screenshots` (boolean, Default `false`): Viewport- und Full-Page-Screenshots im Lighthouse-JSON (R2) behalten. Größere Reports; gilt für Läufe nach dem Speichern.

`store_timing_screenshots` (boolean, Default `false`): Filmstrip-Timing-Screenshots (`screenshot-thumbnails`) im JSON behalten. Off by default.

`lh_warmup` (boolean, Default `false`): Vor jedem Lighthouse-Audit ein `curl`-Warmup auf die Ziel-URL (mit kurzer Pause ± Jitter). Simuliert eher Repeat-Visit; erzeugt zusätzliche Last auf dem Zielserver.

**Keys & Cron (leer = deaktiviert):**

- **`access_key` leer** (beim PATCH leeres Feld senden): kein Public-Trigger. `"generate"` erzeugt einen neuen Key.
- **`share_token` leer:** kein Share-Dashboard. `"generate"` erzeugt einen neuen Token.
- **`cron_expression` leer:** kein automatischer Schedule (nur manuelle Läufe im Dashboard).

Neue Projekte starten ohne Trigger- und Share-Key. Instance-`cron_enabled` muss zusätzlich an sein, damit der Scheduler läuft.

Dispatch/CI: `store_fullpage_screenshots` → `STORE_FULLPAGE_SCREENSHOTS`, `store_timing_screenshots` → `STORE_TIMING_SCREENSHOTS`, `lh_warmup` → `LH_WARMUP`.

---

## URLs (pro Projekt)

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/projects/:id/urls` | Session + Zugriff | URLs eines Projekts |
| `POST` | `/api/projects/:id/urls` | Admin | URL anlegen |
| `PATCH` | `/api/projects/:id/urls/:url_id` | Admin | URL bearbeiten |
| `DELETE` | `/api/projects/:id/urls/:url_id` | Admin | URL löschen |

---

## Metriken & Berichte

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/metrics?project_id=&url_id=&strategy=` | Session + Zugriff | Metriken-Zeitreihe |
| `GET` | `/api/reports?project_id=&url_id=` | Session + Zugriff | Berichtsliste |
| `GET` | `/api/reports?key=` | Session + Zugriff | Lighthouse-JSON zu `report_key`. Session auch per Query `session_token` (GET, z. B. neuer Tab für Raw JSON). |
| `GET` | `/api/reports/:project_id/:filename` | Session + Zugriff | Lighthouse-JSON (Pfad aus R2-Key) |
| `DELETE` | `/api/reports` | Session + Zugriff | Ausgewählte Berichte löschen (Body mit Keys) |

**Query-Parameter (Metriken & Berichtsliste):**

| Parameter | Pflicht | Beschreibung |
| --------- | ------- | ------------ |
| `project_id` | ✅ | Projekt-ID |
| `url_id` | ✅ | URL-ID innerhalb des Projekts |
| `strategy` | Metriken | `desktop` (Default), `mobile`, oder `both` — bei `both` zwei getrennte `runs`-Arrays (siehe Share-Beispiel) |
| `from` | optional | ISO-8601 — untere Grenze für `run_at` (inklusive) |
| `to` | optional | ISO-8601 — obere Grenze für `run_at` (inklusive) |
| `last_days` | optional | Rollierendes Fenster (Integer 1–366), z. B. `7` = letzte 7 Tage. **Nicht** zusammen mit `from`/`to` |

Ohne Datumsfilter werden alle Runs zurückgegeben (Metriken aufsteigend, Berichte absteigend, max. 100).

---

## Annotations (Deploys / Änderungen)

Projektweite Marker auf der Zeitachse der Charts (z. B. „Deploy v2.1“). Gelten für **alle** URLs des Projekts.

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/projects/:id/annotations` | Session + Zugriff | Annotations des Projekts (aufsteigend nach `annotated_at`) |
| `POST` | `/api/projects/:id/annotations` | Session + Zugriff | Anlegen. Body: `{ annotated_at (ISO), label, link? }` |
| `PATCH` | `/api/projects/:id/annotations/:annotation_id` | Session + Zugriff | Bearbeiten. Body: `{ annotated_at (ISO), label, link? }` |
| `DELETE` | `/api/projects/:id/annotations/:annotation_id` | Session + Zugriff | Löschen |

`label` max. 200 Zeichen; `link` optional, muss `http(s)`-URL sein.

---

## Öffentlicher Trigger (ohne Login)

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/public/trigger/:project_id?key=` | Access key | Lighthouse-Lauf starten |
| | | | Optional: `&url_id=` nur eine URL |

Rate-Limit: max. 1 manueller Lauf alle 5 Minuten pro Projekt (KV).

---

## Share (Gast, schreibgeschützt)

Read-only API für externe Clients (Monitoring, Skripte, eingebettete Views). **Gleicher Share-Key** wie das Share-Dashboard — kein separates API-Token, kein Login.

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/public/share/:project_id?share_key=` | Share key | Projekt-Metadaten + aktive URLs |
| `GET` | `/api/public/share/:project_id/metrics?share_key=` | Share key | Metriken-Zeitreihe |
| `GET` | `/api/public/share/:project_id/reports?share_key=` | Share key | Berichtsliste |
| `GET` | `/api/public/share/:project_id/annotations?share_key=` | Share key | Annotations (ohne `created_by`) |
| `GET` | `/api/public/share/report?share_key=&report_key=` | Share key | Lighthouse-JSON |

**Auth-Parameter** (Query, alle gleichwertig):

| Parameter | Verwendung |
| --------- | ---------- |
| `share_key` | Bevorzugt für API-Clients |
| `key` | Wie im Share-Link `/share/?project=…&key=…` |
| `share` | Alternative (z. B. Report-Detail-Links) |

**Query-Parameter (Metriken & Berichte):**

| Parameter | Pflicht | Beschreibung |
| --------- | ------- | ------------ |
| `url_id` | ✅ | URL-ID innerhalb des Projekts |
| `strategy` | Metriken | `desktop` (Default), `mobile`, oder `both` |
| `from` / `to` | optional | ISO-8601 Datumsfilter auf `run_at` |
| `last_days` | optional | Rollierendes Fenster, z. B. `7` — entspricht UI-Presets; nicht kombinierbar mit `from`/`to` |
| `report_key` | Report-JSON | R2-Key des Berichts (z. B. `reports/my-project/…`) |

**Antwort `strategy=both` (Metriken):**

```json
{
  "project_id": "my-project",
  "url_id": "homepage",
  "strategy": "both",
  "desktop": { "runs": [ … ] },
  "mobile": { "runs": [ … ] }
}
```

Bei `strategy=desktop` oder `strategy=mobile` bleibt die Antwort `{ project_id, url_id, strategy, runs: [ … ] }`.

### Beispiele

Projekt + URLs:

```bash
curl "https://api.example.com/api/public/share/my-project?share_key=TOKEN"
```

Metriken (Desktop, letzte 7 Tage):

```bash
curl "https://api.example.com/api/public/share/my-project/metrics\
?share_key=TOKEN&url_id=homepage&strategy=desktop&last_days=7"
```

Metriken (beide Devices, expliziter Zeitraum):

```bash
curl "https://api.example.com/api/public/share/my-project/metrics\
?share_key=TOKEN&url_id=homepage&strategy=both\
&from=2026-07-01T00:00:00.000Z&to=2026-07-13T23:59:59.999Z"
```

Berichtsliste:

```bash
curl "https://api.example.com/api/public/share/my-project/reports\
?share_key=TOKEN&url_id=homepage&last_days=30"
```

Einzelner Bericht (Lighthouse-JSON) — `report_key` aus der Berichtsliste (`reports[].report_key`):

```bash
curl "https://api.example.com/api/public/share/report\
?share_key=TOKEN&report_key=reports/my-project/2026-06-23T143052Z-desktop-homepage.json"
```

Antwort: `{ lighthouse, run, timezone }` — `lighthouse` ist das vollständige Lighthouse-JSON aus R2.

Share-Key leer oder ungültig → `403 Invalid project or share key` (kein Leak, ob das Projekt existiert).

---

## Intern (GitHub Actions)

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/internal/projects/:id/urls` | Bearer `WORKER_API_SECRET` | Aktive URLs für Lighthouse-Workflow |
| `POST` | `/api/internal/runs/started` | Bearer `WORKER_API_SECRET` | Lauf gestartet (Run-Status) |
| `POST` | `/api/internal/runs/completed` | Bearer `WORKER_API_SECRET` | Lauf beendet (Run-Status) |
| `POST` | `/api/runs` | Bearer `WORKER_API_SECRET` | Metrik + Report-Key nach Upload eintragen |

---

## Benutzer (Admin)

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/users` | Admin | User-Liste |
| `POST` | `/api/users` | Admin | User anlegen |
| `GET` | `/api/users/:id/projects` | Admin | Projekte eines Users |
| `POST` | `/api/users/:id/projects` | Admin | Projekt zuweisen |
| `DELETE` | `/api/users/:id/projects/:project_id` | Admin | Zuweisung entfernen |

---

## Siehe auch

- Einrichtung: [`INSTALLATION.md`](INSTALLATION.md)
- Architektur & Kurzüberblick: [`README.md`](../README.md)
