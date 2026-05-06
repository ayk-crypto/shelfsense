-- Fix any Payment rows where currency was stored as 'PKR' or other non-USD values
-- Billing is USD-only; this corrects legacy data created before the USD enforcement.
UPDATE "Payment" SET currency = 'USD' WHERE currency <> 'USD';
