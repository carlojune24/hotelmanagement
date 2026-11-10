-- Custom SQL migration file, put your code below! ---- Stay-change lines from modifyBookingStay predate the `source` tag; tag them so they can't be voided on their own.
UPDATE "folio_charges" SET "source" = 'stay_change'
WHERE "source" IS NULL AND "is_base_charge" = false
  AND ("description" LIKE 'Stay extended —%' OR "description" LIKE 'Stay shortened —%'
    OR "description" LIKE 'Room type changed to %' OR "description" LIKE 'Extra beds % → %');
