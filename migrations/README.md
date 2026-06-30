# Datenbank-Migrationen (D1)

Schema-Änderungen laufen über **Wranglers eingebautes D1-Migrationssystem**. Wrangler
führt nur die noch nicht angewandten Migrationen aus und merkt sich den Stand in der
Tabelle `d1_migrations` der Datenbank (das ist die „DB-Version“).

---

## ⚠️ Wichtig: `PRAGMA foreign_keys` auf D1

**Jede Migration läuft auf D1 in einer impliziten Transaktion.** In SQLite (und damit D1)
kann `PRAGMA foreign_keys` **innerhalb einer Transaktion nicht umgeschaltet** werden —
der Aufruf wird **still ignoriert** (kein Fehler, einfach wirkungslos).

Das gilt auch für das verbreitete SQLite-Migrationsmuster:

```sql
-- ❌ Auf D1 UNSICHER — foreign_keys=OFF wirkt hier NICHT
PRAGMA foreign_keys = OFF;
CREATE TABLE parent_new (...);
INSERT INTO parent_new SELECT * FROM parent;
DROP TABLE parent;              -- löst ON DELETE CASCADE aus!
ALTER TABLE parent_new RENAME TO parent;
PRAGMA foreign_keys = ON;
```

**Folge:** `DROP TABLE` auf eine Parent-Tabelle (z. B. `projects`) führt trotzdem
`ON DELETE CASCADE` auf allen Child-Tabellen aus — z. B. werden **urls**, **runs**,
**annotations** und **project_users** mitgelöscht, auch wenn die Parent-Zeilen vorher
kopiert wurden. Das ist kein D1-Bug, sondern SQLite-Verhalten in Transaktionen; D1
erzwingt FK-Checks dauerhaft (`foreign_keys = ON`).

**Auch `PRAGMA defer_foreign_keys = ON` hilft nicht:** Es verschiebt nur Constraint-Checks
ans Transaktionsende — **`ON DELETE CASCADE` feuert weiterhin sofort** bei `DROP TABLE`.

### Was stattdessen tun

1. **Bevorzugt:** `ALTER TABLE ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN` — kein
   `DROP TABLE` auf referenzierte Tabellen.
2. **Wenn Rebuild nötig ist:** Child-Zeilen in Temp-Tabellen **sichern**, Tabellen in
   Abhängigkeitsreihenfolge droppen, Parent neu anlegen, Children **wiederherstellen**.
   Vorbild: [`0007_drop_project_enabled_nullable_keys.sql`](0007_drop_project_enabled_nullable_keys.sql).
3. **Niemals** allein auf `PRAGMA foreign_keys=OFF` oder `defer_foreign_keys` vertrauen.

**Bereits fehlerhaft gelaufene Migration:** Kein erneutes Anwenden derselben Datei.
Wiederherstellung nur per D1 **Time Travel** (Restore vor der Migration) oder manuelles
Nachpflegen der betroffenen Zeilen.

Cloudflare-Doku: [Foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
[SQL statements (PRAGMA)](https://developers.cloudflare.com/d1/sql-api/sql-statements/).

---

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
