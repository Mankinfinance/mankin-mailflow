-- Backfill the deal tracker's new "Date added" column (data.systemAddedAt).
--
-- systemAddedAt is a jsonb field inside deals.data (not a table column), so
-- drizzle-kit doesn't generate this — it's a one-time data backfill for
-- deals that existed before the field. For each deal missing the field we
-- derive a fixed yyyy-mm-dd:
--   1. Prefer the origination month/year already stored on the deal
--      (data.originatedLabel, e.g. "March 2026") -> the first of that month,
--      matching what the importer now stamps on new rows. Stable across
--      re-imports because it comes from the sheet, not the clock.
--   2. Fall back to the row's created_at (the day it first landed in
--      LoanFlow), in Australia/Sydney, when there is no usable month label.
--
-- to_date with 'FMMonth YYYY' parses full month names ("March 2026"). Any
-- label it can't parse raises inside the CASE, so we guard with a regex that
-- only attempts the parse on "<Month> <Year>" shaped values and otherwise
-- uses created_at.
UPDATE "deals"
SET "data" = jsonb_set(
  "data",
  '{systemAddedAt}',
  to_jsonb(
    to_char(
      CASE
        WHEN COALESCE("data"->>'originatedLabel', '') ~ '^[A-Za-z]+\s+[0-9]{4}$'
          THEN to_date("data"->>'originatedLabel', 'FMMonth YYYY')
        ELSE ("created_at" AT TIME ZONE 'Australia/Sydney')::date
      END,
      'YYYY-MM-DD'
    )
  ),
  true
)
WHERE NOT ("data" ? 'systemAddedAt')
   OR "data"->>'systemAddedAt' IS NULL;
