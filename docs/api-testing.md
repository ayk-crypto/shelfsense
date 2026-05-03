# API Testing

Set a base URL:

```bash
API_URL="http://localhost:4000"
TOKEN="replace-with-login-token"
ITEM_ID="replace-with-item-id"
```

## Register

```bash
curl -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo User",
    "email": "demo@example.com",
    "password": "demo123456",
    "workspaceName": "Demo Workspace"
  }'
```

## Login

```bash
curl -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "demo123456"
  }'
```

## Create Workspace

```bash
curl -X POST "$API_URL/workspace/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo Workspace"
  }'
```

## Create Item

```bash
curl -X POST "$API_URL/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Chicken",
    "unit": "kg",
    "minStockLevel": 10,
    "trackExpiry": true
  }'
```

## Stock In

```bash
curl -X POST "$API_URL/stock/in" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemId": "'"$ITEM_ID"'",
    "quantity": 10,
    "unitCost": 500,
    "expiryDate": "2026-05-30",
    "batchNo": "BATCH-001",
    "supplierName": "Supplier Name",
    "note": "Purchase entry"
  }'
```

## Stock Out

```bash
curl -X POST "$API_URL/stock/out" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemId": "'"$ITEM_ID"'",
    "quantity": 3,
    "reason": "Kitchen usage",
    "note": "Used for daily preparation"
  }'
```

## Stock Summary

```bash
curl "$API_URL/stock/summary" \
  -H "Authorization: Bearer $TOKEN"
```

## Expiring Soon

```bash
curl "$API_URL/stock/expiring-soon" \
  -H "Authorization: Bearer $TOKEN"
```
