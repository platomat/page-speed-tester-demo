# Datenbank-Migrationen (D1)

Schema-Änderungen laufen über **Wranglers eingebautes D1-Migrationssystem**. Wrangler
führt nur die noch nicht angewandten Migrationen aus und merkt sich den Stand in der
Tabelle `d1_migrations` der Datenbank (das ist die „DB-Version“).

## Dateien

- Nummerierte SQL-Dateien, z. B. `0001_baseline.sql`, `0002_add_xyz.sql`.
- `0001_baseline.sql` enthält das vollständige Basisschema (idempotent: `IF NOT EXISTS` /
  `INSERT OR IGNORE`), damit es auch auf bereits bestehende Datenbanken angewendet werden
  kann (No-Op).
- **Eine angewandte Migration nie nachträglich ändern** — stattdessen eine neue Datei anlegen.

## Neue Migration anlegen

```bash
npm run db:migrate:new -- add_something   # erzeugt migrations/000X_add_something.sql
```

Anschließend die SQL-Befehle eintragen. Beispiele für „echte“ Migrationen auf
bestehenden Daten:

```sql
-- Spalte hinzufügen
ALTER TABLE runs ADD COLUMN notes TEXT;

-- Spalte umbenennen + Werte übernehmen (SQLite)
ALTER TABLE projects RENAME COLUMN cron_expression TO schedule;

-- Werte transformieren
UPDATE runs SET trigger_source = 'manual' WHERE trigger_source IS NULL;
```

> Hinweis: SQLite kann `ALTER TABLE ... ADD COLUMN` **nicht** mit `IF NOT EXISTS`.
> Das ist ok — jede Migration läuft dank `d1_migrations` genau **einmal**.

## Anwenden

```bash
npm run db:migrate          # lokal (Wrangler dev D1)
npm run db:migrate:remote   # Remote (Cloudflare D1)
npm run db:migrate:list     # Status: angewandt / offen
```

Beim `npm run deploy` werden die Remote-Migrationen **automatisch vor** dem Worker-Deploy
ausgeführt. Bei Cloudflare **Workers Git-Deploy** das Build-Kommando entsprechend setzen
(siehe `docs/INSTALLATION.md`).

## D1: Tabellen mit Foreign Keys neu aufbauen

Cloudflare D1 führt jede Migration in einer **Transaktion** aus. `PRAGMA foreign_keys=OFF`
wirkt darin **nicht** — `DROP TABLE` auf eine Parent-Tabelle löst trotzdem
`ON DELETE CASCADE` auf allen Child-Tabellen aus (z. B. `urls`, `runs` bei `projects`).

**Sicheres Muster:** Child-Zeilen zuerst in Temp-Tabellen kopieren, Tabellen in
Abhängigkeitsreihenfolge droppen, Parent neu anlegen, Children wiederherstellen.
Vorbild: `0007_drop_project_enabled_nullable_keys.sql`.

**Wenn eine fehlerhafte Migration bereits gelaufen ist:** Daten aus Temp-Backups sind
nicht wieder da. Optionen: D1 **Time Travel** (Restore auf Zeitpunkt vor der Migration,
siehe Cloudflare-Doku) oder betroffene Zeilen manuell neu anlegen (Projekte bleiben
oft erhalten, URLs/Runs ggf. weg).

**Bevorzugt:** `ALTER TABLE ADD/DROP/RENAME COLUMN` statt `DROP TABLE` + Recreate, wo
SQLite das hergibt.
