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
| `GET` | `/api/settings` | Session | Timezone, Cron-Schalter, GitHub owner/repo, upstream owner/repo/branch, cookie domain, `store_screenshots`, `upstream_sync_enabled` |
| `PATCH` | `/api/settings` | Admin | Instance settings aktualisieren |

`store_screenshots` (boolean, Default `false`): Wenn `true`, speichert der Lighthouse-Upload Viewport- und Full-Page-Screenshots im JSON (R2). Größere Dateien und höherer Speicherverbrauch; Screenshots erscheinen in der Report-Detailansicht. Gilt für Läufe nach dem Speichern der Einstellung.

Upstream-Felder (optional, Defaults `platomat` / `page-speed-tester-demo` / `main`): Quelle für **Upstream sync** im Admin.

`upstream_sync_enabled` (boolean): `false`, wenn `PST_INSTANCE_ROLE=upstream` (Demo — per Build-Env in `wrangler.toml` `[vars]`, nicht manuell zur Laufzeit).

---

## GitHub / Upstream sync

Nur wenn `upstream_sync_enabled === true` (Kunden-Instanz; nicht die Demo-Quelle mit `PST_INSTANCE_ROLE=upstream`).

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/github/upstream-status` | Admin | Vergleich deines Repos mit dem Upstream (ahead/behind/diverged) inkl. `last_sync` (letztes Workflow-Ergebnis) |
| `POST` | `/api/github/sync-upstream` | Admin | Upstream in dein Repo mergen. Fork: GitHub `merge-upstream` (synchron). Template-Kopie: löst den Workflow `upstream-sync.yml` aus (`git merge` + push) und antwortet mit `{ ok: true, started: true, method: "workflow-dispatch" }`. Rate-Limit 1×/Minute. Erfordert `GH_PAT` mit **Contents** und **Actions: Read and write**. |
| `POST` | `/api/internal/upstream-sync/result` | Worker-Secret (`WORKER_API_SECRET`) | Der Sync-Workflow meldet hier sein Ergebnis (`status` = `success`/`conflict`/`error`, `sha`, `message`). |

---

## Projekte

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/projects` | Session | Projektliste (User: nur zugewiesene) |
| `POST` | `/api/projects` | Admin | Projekt anlegen |
| `PATCH` | `/api/projects/:id` | Admin | Projekt bearbeiten (Name, Cron, enabled, Keys, …) |
| `DELETE` | `/api/projects/:id` | Admin | Projekt löschen |
| `GET` | `/api/projects/:id/run-status` | Session + Zugriff | Laufstatus (KV) für Dashboard-Polling |
| `DELETE` | `/api/projects/:id/run-status` | Session + Zugriff | Laufstatus zurücksetzen (z. B. nach abgebrochenem GH-Lauf); bricht GitHub **nicht** ab |
| `POST` | `/api/projects/:id/trigger` | Session + Zugriff | Lighthouse-Lauf für gesamtes Projekt starten |
| `POST` | `/api/projects/:id/urls/:url_id/trigger` | Session + Zugriff | Lighthouse-Lauf für eine URL |

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
| `GET` | `/api/metrics?project_id=&url_id=&strategy=` | Session + Zugriff | Metriken-Zeitreihe (`strategy`: `desktop` \| `mobile`) |
| `GET` | `/api/reports?project_id=&url_id=` | Session + Zugriff | Berichtsliste |
| `GET` | `/api/reports?key=` | Session + Zugriff | Lighthouse-JSON zu `report_key` |
| `GET` | `/api/reports/:project_id/:filename` | Session + Zugriff | Lighthouse-JSON (Pfad aus R2-Key) |
| `DELETE` | `/api/reports` | Session + Zugriff | Ausgewählte Berichte löschen (Body mit Keys) |

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

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| `GET` | `/api/public/share/:project_id?share_key=` | Share key | Projekt-Metadaten für `/share` |
| `GET` | `/api/public/share/:project_id/metrics?share_key=` | Share key | Metriken (Query wie `/api/metrics`) |
| `GET` | `/api/public/share/:project_id/reports?share_key=` | Share key | Berichtsliste |
| `GET` | `/api/public/share/:project_id/annotations?share_key=` | Share key | Annotations (schreibgeschützt, ohne `created_by`) |
| `GET` | `/api/public/share/report?share_key=&report_key=` | Share key | Lighthouse-JSON |

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
