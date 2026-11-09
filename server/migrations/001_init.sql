-- Tab schema. Money is integer kobo (BIGINT); percentages are basis points.

CREATE TABLE bill_tables (
  id            TEXT PRIMARY KEY,                       -- short share code, e.g. "k7x2qm"
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  host_key_hash TEXT NOT NULL,                          -- SHA-256 of the secret host key
  tax_bp        INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 5000),
  tip_bp        INTEGER NOT NULL DEFAULT 0 CHECK (tip_bp BETWEEN 0 AND 10000),
  finalized     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id          BIGSERIAL PRIMARY KEY,
  table_id    TEXT NOT NULL REFERENCES bill_tables(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  price_kobo  BIGINT NOT NULL CHECK (price_kobo > 0 AND price_kobo <= 10000000000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX items_table_idx ON items (table_id, id);

CREATE TABLE participants (
  id          BIGSERIAL PRIMARY KEY,
  table_id    TEXT NOT NULL REFERENCES bill_tables(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  name_key    TEXT NOT NULL,                            -- lower(trimmed name) for case-insensitive uniqueness
  token_hash  TEXT NOT NULL UNIQUE,                     -- SHA-256 of the participant's browser token
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_id, name_key)
);
CREATE INDEX participants_table_idx ON participants (table_id, id);

CREATE TABLE claims (
  item_id         BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  participant_id  BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, participant_id)                 -- one claim per person per item: no duplicates
);
CREATE INDEX claims_participant_idx ON claims (participant_id);
