-- Stellar settlement migration.

-- 1. Add host_wallet and settlement rate snapshot to bill_tables
ALTER TABLE bill_tables
  ADD COLUMN IF NOT EXISTS host_wallet TEXT CHECK (host_wallet IS NULL OR (char_length(host_wallet) = 56 AND host_wallet ~ '^G[A-Z2-7]{55}$')),
  ADD COLUMN IF NOT EXISTS settlement_rate_ngn_per_xlm NUMERIC(18, 4) CHECK (settlement_rate_ngn_per_xlm IS NULL OR settlement_rate_ngn_per_xlm > 0);

-- 2. Add deterministic payment_reference to participants
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS payment_reference TEXT DEFAULT ('TAB:' || substr(md5(random()::text), 1, 16));

UPDATE participants
  SET payment_reference = 'TAB:' || table_id || ':' || substr(encode(sha256((table_id || ':' || id)::bytea), 'hex'), 1, 12)
  WHERE payment_reference IS NULL;

ALTER TABLE participants
  ALTER COLUMN payment_reference SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS participants_payment_reference_idx
  ON participants (payment_reference);

-- 3. Settlement payments table
CREATE TABLE IF NOT EXISTS settlement_payments (
  id                  BIGSERIAL PRIMARY KEY,
  table_id            TEXT NOT NULL REFERENCES bill_tables(id) ON DELETE CASCADE,
  participant_id      BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  tx_hash             TEXT NOT NULL UNIQUE CHECK (char_length(tx_hash) = 64 AND tx_hash ~ '^[0-9a-fA-F]{64}$'),
  from_address        TEXT NOT NULL CHECK (char_length(from_address) = 56 AND from_address ~ '^G[A-Z2-7]{55}$'),
  to_address          TEXT NOT NULL CHECK (char_length(to_address) = 56 AND to_address ~ '^G[A-Z2-7]{55}$'),
  amount_stroops      BIGINT NOT NULL CHECK (amount_stroops > 0),
  amount_xlm          TEXT NOT NULL,
  amount_kobo         BIGINT NOT NULL CHECK (amount_kobo >= 0),
  asset_code          TEXT NOT NULL DEFAULT 'XLM' CHECK (char_length(asset_code) BETWEEN 1 AND 12),
  asset_issuer        TEXT CHECK (asset_issuer IS NULL OR (char_length(asset_issuer) = 56 AND asset_issuer ~ '^G[A-Z2-7]{55}$')),
  network_passphrase  TEXT NOT NULL DEFAULT 'Test SDF Network ; September 2015',
  memo                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('submitted', 'confirmed', 'failed')),
  ledger_sequence     BIGINT CHECK (ledger_sequence IS NULL OR ledger_sequence > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS settlement_payments_table_participant_idx
  ON settlement_payments (table_id, participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS settlement_payments_participant_confirmed_idx
  ON settlement_payments (table_id, participant_id)
  WHERE status = 'confirmed';
