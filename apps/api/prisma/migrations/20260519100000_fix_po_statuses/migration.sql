-- Fix PO statuses: mark as RECEIVED where all lines have been fully or over-received
-- This corrects cases where receivedQty >= orderedQty for all lines but PO is still PARTIALLY_RECEIVED

UPDATE "Purchase"
SET
  status = 'RECEIVED'::"PurchaseStatus",
  "receivedAt" = COALESCE("receivedAt", NOW())
WHERE
  status = 'PARTIALLY_RECEIVED'
  AND id IN (
    SELECT pi."purchaseId"
    FROM "PurchaseItem" pi
    GROUP BY pi."purchaseId"
    HAVING
      COUNT(*) > 0
      AND SUM(CASE WHEN pi."receivedQuantity" < pi.quantity THEN 1 ELSE 0 END) = 0
  );
