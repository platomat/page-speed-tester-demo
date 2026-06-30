-- Per-run LH warmup flag (set from project lh_warmup at audit time).
ALTER TABLE runs ADD COLUMN lh_warmup INTEGER NOT NULL DEFAULT 0;
