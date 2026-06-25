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
