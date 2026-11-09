-- Stellar-native XLM migration.
-- Transforms Tab from a fiat-denominated app with conversion rates to an XLM-native platform.
-- All monetary calculations are performed in stroops (1 XLM = 10,000,000 stroops).

-- 1. Table currency and legacy preservation
ALTER TABLE bill_tables
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'XLM' CHECK (currency IN ('XLM', 'NGN'));

-- Mark any historical tables created before this migration as legacy NGN
UPDATE bill_tables
  SET currency = 'NGN'
  WHERE created_at < now() AND settlement_rate_ngn_per_xlm IS NOT NULL;

-- 2. Native stroop pricing on items
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS price_stroops BIGINT CHECK (price_stroops IS NULL OR (price_stroops > 0 AND price_stroops <= 10000000000000000));

-- Allow price_kobo to be NULL for new XLM items
ALTER TABLE items
  ALTER COLUMN price_kobo DROP NOT NULL;

-- 3. Settlement payments: native XLM, exact stroops, no kobo required
ALTER TABLE settlement_payments
  ALTER COLUMN amount_kobo DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'native' CHECK (asset_type = 'native'),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

UPDATE settlement_payments
  SET confirmed_at = COALESCE(verified_at, created_at)
  WHERE confirmed_at IS NULL AND status = 'confirmed';

