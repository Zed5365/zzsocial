-- ZZSocial database schema

CREATE TABLE IF NOT EXISTS persons (
  id         TEXT PRIMARY KEY,
  name       TEXT        NOT NULL DEFAULT 'Person',
  profile    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  messages   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  summary    TEXT        NOT NULL DEFAULT '',
  position   INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row table for shared app state (the "You" profile + global settings).
CREATE TABLE IF NOT EXISTS app_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  own_profile      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  style            TEXT    NOT NULL DEFAULT 'natural',
  emojis           BOOLEAN NOT NULL DEFAULT false,
  model            TEXT    NOT NULL DEFAULT 'openai/gpt-oss-20b:free',
  active_person_id TEXT,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
