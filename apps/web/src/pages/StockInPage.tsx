import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { checkOcrStatus, matchInvoiceLines } from "../api/receiving";
import { getItems } from "../api/items";
import { getItemSuppliers, getSupplierMappings, putItemSuppliers } from "../api/item-suppliers";
import { getLocations } from "../api/locations";
import { getOpenPurchases, receivePurchase } from "../api/purchases";
import { getPriceHistory, stockIn } from "../api/stock";
import { getSuppliers } from "../api/suppliers";
import { InvoiceUploadCard } from "../components/InvoiceUploadCard";
import { SmartMatchingPanel } from "../components/SmartMatchingPanel";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { InvoiceUploadFull, Item, ItemSupplierInfo, Location, Purchase, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";
import "./StockInPage.css";

interface BatchRow {
  rowId: string;
  item: Item;
  qty: string;
  totalPrice: string;
  unitCost: string;
  expiryDate: string;
  batchNo: string;
  supplierId: string;
  note: string;
  lastPrice: number | null;
  metaLoading: boolean;
  enteredUnit: "base" | "purchase";
}

function fmtQty(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(n);
}

function formatPoLineQty(line: Purchase["purchaseItems"][number], baseQty: number) {
  const { purchaseUnit, baseUnit } = poUnitConfig(line);
  return `${fmtQty(poDisplayQuantity(line, baseQty))} ${purchaseUnit ?? baseUnit}`;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasDifferentPurchaseUnit(item: Item) {
  return Boolean(
    item.purchaseUnit &&
    item.purchaseConversionFactor &&
    item.purchaseConversionFactor > 0 &&
    item.purchaseUnit.trim().toLowerCase() !== item.unit.trim().toLowerCase(),
  );
}

function rowBaseQuantity(row: BatchRow) {
  const qty = parseFloat(row.qty);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return row.enteredUnit === "purchase" && hasDifferentPurchaseUnit(row.item)
    ? qty * row.item.purchaseConversionFactor!
    : qty;
}

function calculatedUnitCost(row: BatchRow) {
  const baseQty = rowBaseQuantity(row);
  const total = parseFloat(row.totalPrice);
  if (!baseQty || !Number.isFinite(total) || total <= 0) return null;
  return roundCurrency(total / baseQty);
}

interface RowResult {
  rowId: string;
  itemName: string;
  batchNo: string;
  status: "success" | "error";
  error?: string;
}

interface PoReceiveLineDraft {
  purchaseItemId: string;
  itemName: string;
  itemUnit: string;
  remainingQty: number;
  trackExpiry: boolean;
  receivedQuantity: string;
  locationId: string;
  expiryDate: string;
  batchNo: string;
  unitCost: string;
  notes: string;
}

let poBatchSeq = 0;

interface PoBatchDraft {
  key: number;
  quantity: string;
  locationId: string;
  expiryDate: string;
  batchNo: string;
  totalAmount: string;
  unitCostExclTax: string;
  unitTax: string;
  unitCostInclTax: string;
  notes: string;
  enteredUnit: "base" | "purchase";
}

interface PoDraftPayload {
  poId: string;
  savedAt: string;
  batches: Record<string, Omit<PoBatchDraft, "key">[]>;
}

function poUnitConfig(line: Purchase["purchaseItems"][number]) {
  const snapshot = line.unitSnapshot;
  const factor = snapshot?.conversionFactor && snapshot.conversionFactor > 0 ? snapshot.conversionFactor : 1;
  const baseUnit = snapshot?.baseUnit ?? line.baseUnitSnapshot ?? line.item.unit;
  const purchaseUnit = snapshot?.purchaseUnit && factor !== 1 ? snapshot.purchaseUnit : null;
  return { factor, baseUnit, purchaseUnit };
}

function poDisplayQuantity(line: Purchase["purchaseItems"][number], baseQty: number) {
  const { factor, purchaseUnit } = poUnitConfig(line);
  return purchaseUnit ? baseQty / factor : baseQty;
}

function poBatchBaseQuantity(line: Purchase["purchaseItems"][number], batch: PoBatchDraft) {
  const qty = parseFloat(batch.quantity) || 0;
  const { factor, purchaseUnit } = poUnitConfig(line);
  return batch.enteredUnit === "purchase" && purchaseUnit ? qty * factor : qty;
}

function generatePoBatchNo(poId: string, itemId: string, batchIndex: number) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `PO-${poId.slice(-6).toUpperCase()}-${itemId.slice(-4).toUpperCase()}-${date}-${String(batchIndex + 1).padStart(2, "0")}`;
}

function newPoBatch(defaults: { locationId: string; totalAmount: string; batchNo: string; quantity?: string; enteredUnit?: "base" | "purchase" }): PoBatchDraft {
  return {
    key: ++poBatchSeq,
    quantity: defaults.quantity ?? "",
    locationId: defaults.locationId,
    expiryDate: "",
    batchNo: defaults.batchNo,
    totalAmount: defaults.totalAmount,
    unitCostExclTax: "",
    unitTax: "",
    unitCostInclTax: "",
    notes: "",
    enteredUnit: defaults.enteredUnit ?? "base",
  };
}

const PO_DRAFT_PREFIX = "shelfsense_po_receive_draft_";

function generateBatchNo(rows: BatchRow[], itemId: string): string {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const count = rows.filter((r) => r.item.id === itemId).length + 1;
  return `B${ymd}-${String(count).padStart(3, "0")}`;
}

export function StockInPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency;

  const [allItems, setAllItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [sessionSupplierId, setSessionSupplierId] = useState("");
  const [supplierMappings, setSupplierMappings] = useState<Map<string, ItemSupplierInfo>>(new Map());
  const [showAllInventory, setShowAllInventory] = useState(false);
  const [pendingUnlinkedItem, setPendingUnlinkedItem] = useState<Item | null>(null);
  const [linkingSupplier, setLinkingSupplier] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [globalNote, setGlobalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [touched, setTouched] = useState(false);

  const { activeLocationId: defaultLocationId } = useLocation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [mode, setMode] = useState<"direct" | "po">("direct");
  const [openPOs, setOpenPOs] = useState<Purchase[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [selectedPo, setSelectedPo] = useState<Purchase | null>(null);
  const [poBatches, setPoBatches] = useState<Record<string, PoBatchDraft[]>>({});
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poResult, setPoResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [overReceiveConfirmed, setOverReceiveConfirmed] = useState(false);
  const [overReceiveWarnings, setOverReceiveWarnings] = useState<Array<{ name: string; total: number; remaining: number; unit: string }>>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PoDraftPayload | null>(null);
  const [invoiceUpload, setInvoiceUpload] = useState<InvoiceUploadFull | null>(null);
  const [ocrAvailable, setOcrAvailable] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const poBatchesRef = useRef(poBatches);
  const selectedPoRef = useRef(selectedPo);
  useEffect(() => { poBatchesRef.current = poBatches; }, [poBatches]);
  useEffect(() => { selectedPoRef.current = selectedPo; }, [selectedPo]);
  useEffect(() => {
    if (mode === "po") {
      checkOcrStatus().then((res) => setOcrAvailable(res.available)).catch(() => {});
    }
  }, [mode]);
  useEffect(() => { setInvoiceUpload(null); }, [selectedPoId]);

  useEffect(() => {
    async function load() {
      try {
        const [itemsRes, suppliersRes, locationsRes, mappingsRes] = await Promise.all([getItems(), getSuppliers(), getLocations(), getSupplierMappings()]);
        const activeItems = itemsRes.items.filter((i) => i.isActive);
        setAllItems(activeItems);
        setSuppliers(suppliersRes.suppliers);
        setLocations(locationsRes.locations);
        setSupplierMappings(new Map(mappingsRes.items.map((info) => [info.itemId, info])));

        // Deep-link from PO detail: /stock-in?mode=po&poId=<id>
        const deepMode = searchParams.get("mode");
        const deepPoId = searchParams.get("poId");
        if (deepMode === "po" && deepPoId) {
          setMode("po");
          setPoLoading(true);
          const next = new URLSearchParams(searchParams);
          next.delete("mode");
          next.delete("poId");
          setSearchParams(next, { replace: true });
          try {
            const res = await getOpenPurchases();
            setOpenPOs(res.purchases);
            const po = res.purchases.find((p) => p.id === deepPoId) ?? null;
            if (po) {
              const fallbackLoc = locationsRes.locations[0]?.id ?? "";
              setSelectedPoId(po.id);
              setSelectedPo(po);
              const init: Record<string, PoBatchDraft[]> = {};
              for (const item of po.purchaseItems.filter((i) => i.remainingQuantity > 0)) {
                const usePurchaseUnit = Boolean(poUnitConfig(item).purchaseUnit);
                init[item.id] = [newPoBatch({
                  locationId: fallbackLoc,
                  totalAmount: String(roundCurrency(item.remainingQuantity * item.unitCost)),
                  batchNo: generatePoBatchNo(po.id, item.id, 0),
                  quantity: String(poDisplayQuantity(item, item.remainingQuantity)),
                  enteredUnit: usePurchaseUnit ? "purchase" : "base",
                })];
              }
              setPoBatches(init);
            }
          } catch {
            setOpenPOs([]);
          } finally {
            setPoLoading(false);
          }
          setLoadingItems(false);
          return;
        }

        const itemId = searchParams.get("itemId");
        const query = searchParams.get("q")?.trim().toLowerCase();
        const preselected = itemId
          ? activeItems.find((item) => item.id === itemId)
          : query
            ? activeItems.find((item) =>
                item.name.toLowerCase().includes(query) ||
                (item.sku ?? "").toLowerCase().includes(query) ||
                (item.barcode ?? "").toLowerCase().includes(query)
              )
            : null;

        if (preselected) {
          const rowId = crypto.randomUUID();
          const batchNo = generateBatchNo([], preselected.id);
          setRows([{
            rowId,
            item: preselected,
            qty: "",
            totalPrice: "",
            unitCost: "",
            expiryDate: "",
            batchNo,
            supplierId: "",
            note: "",
            lastPrice: null,
            metaLoading: true,
            enteredUnit: hasDifferentPurchaseUnit(preselected) ? "purchase" : "base",
          }]);
          setSearch("");
          setShowDropdown(false);
          void fetchRowMeta(rowId, preselected.id);

          const next = new URLSearchParams(searchParams);
          next.delete("itemId");
          next.delete("q");
          setSearchParams(next, { replace: true });
        } else if (query) {
          setSearch(searchParams.get("q") ?? "");
          setShowDropdown(true);
        }
      } catch {
        setAllItems([]);
      } finally {
        setLoadingItems(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showDropdown]);

  const stagedItemIds = new Set(rows.map((r) => r.item.id));
  const itemMatchesSupplier = (itemId: string) => {
    if (!sessionSupplierId) return false;
    const mapping = supplierMappings.get(itemId);
    return mapping?.primary?.supplierId === sessionSupplierId
      || mapping?.alternates.some((alternate) => alternate.supplierId === sessionSupplierId)
      || false;
  };
  const filteredItems = allItems
    .filter((i) => !stagedItemIds.has(i.id))
    .filter((i) => showAllInventory || itemMatchesSupplier(i.id))
    .filter((i) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.sku ?? "").toLowerCase().includes(q) ||
        (i.barcode ?? "").toLowerCase().includes(q)
      );
    });

  function addItem(item: Item) {
    const rowId = crypto.randomUUID();
    const batchNo = generateBatchNo(rows, item.id);
    const newRow: BatchRow = {
      rowId,
      item,
      qty: "",
      totalPrice: "",
      unitCost: "",
      expiryDate: "",
      batchNo,
      supplierId: sessionSupplierId,
      note: "",
      lastPrice: null,
      metaLoading: true,
      enteredUnit: hasDifferentPurchaseUnit(item) ? "purchase" : "base",
    };
    setRows((prev) => [...prev, newRow]);
    setSearch("");
    setShowDropdown(false);
    setResults(null);
    setTouched(false);
    void fetchRowMeta(rowId, item.id);
  }

  async function fetchRowMeta(rowId: string, itemId: string) {
    try {
      const priceRes = await getPriceHistory(itemId, 3);
      setRows((prev) =>
        prev.map((r) =>
          r.rowId !== rowId
            ? r
            : {
                ...r,
                lastPrice: priceRes.history[0]?.unitCost ?? null,
                metaLoading: false,
              },
        ),
      );
    } catch {
      setRows((prev) => prev.map((r) => (r.rowId !== rowId ? r : { ...r, metaLoading: false })));
    }
  }

  function addBatch(sourceRowId: string) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.rowId === sourceRowId);
      if (idx === -1) return prev;
      const source = prev[idx];
      const batchNo = generateBatchNo(prev, source.item.id);
      const newRow: BatchRow = {
        rowId: crypto.randomUUID(),
        item: source.item,
        qty: "",
        totalPrice: "",
        unitCost: source.unitCost,
        expiryDate: "",
        batchNo,
        supplierId: source.supplierId,
        note: "",
        lastPrice: source.lastPrice,
        metaLoading: false,
        enteredUnit: source.enteredUnit,
      };
      const updated = [...prev];
      updated.splice(idx + 1, 0, newRow);
      return updated;
    });
  }

  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function updateRow(rowId: string, field: keyof Omit<BatchRow, "rowId" | "item" | "lastPrice" | "metaLoading">, value: string) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }

  function handleSessionSupplierChange(supplierId: string) {
    setSessionSupplierId(supplierId);
    setRows((prev) => prev.map((row) => ({ ...row, supplierId })));
    setShowAllInventory(false);
    setPendingUnlinkedItem(null);
    setSearch("");
  }

  function chooseItem(item: Item) {
    if (!itemMatchesSupplier(item.id)) {
      setPendingUnlinkedItem(item);
      setLinkError("");
      setShowDropdown(false);
      return;
    }
    addItem(item);
  }

  async function linkAndAddPendingItem() {
    if (!pendingUnlinkedItem || !sessionSupplierId) return;
    setLinkingSupplier(true);
    setLinkError("");
    try {
      const existing = await getItemSuppliers(pendingUnlinkedItem.id);
      await putItemSuppliers(pendingUnlinkedItem.id, [
        ...existing.suppliers.map((mapping) => ({
          supplierId: mapping.supplierId,
          role: mapping.role,
          supplierItemCode: mapping.supplierItemCode,
          preferredPurchaseUnit: mapping.preferredPurchaseUnit,
          minimumOrderQuantity: mapping.minimumOrderQuantity,
        })),
        { supplierId: sessionSupplierId, role: "ALTERNATE" as const },
      ]);
      const supplier = suppliers.find((entry) => entry.id === sessionSupplierId);
      setSupplierMappings((current) => {
        const next = new Map(current);
        const existingInfo = next.get(pendingUnlinkedItem.id);
        next.set(pendingUnlinkedItem.id, {
          itemId: pendingUnlinkedItem.id,
          itemName: pendingUnlinkedItem.name,
          category: pendingUnlinkedItem.category,
          primary: existingInfo?.primary ?? null,
          alternates: [...(existingInfo?.alternates ?? []), {
            id: `pending-${sessionSupplierId}`,
            supplierId: sessionSupplierId,
            supplierName: supplier?.name ?? "Supplier",
            role: "ALTERNATE",
            supplierItemCode: null,
            preferredPurchaseUnit: null,
            lastPurchasePrice: null,
            lastPurchaseDate: null,
            minimumOrderQuantity: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }],
        });
        return next;
      });
      addItem(pendingUnlinkedItem);
      setPendingUnlinkedItem(null);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Could not link this supplier. You can still receive the item once.");
    } finally {
      setLinkingSupplier(false);
    }
  }

  function clearAll() {
    setRows([]);
    setSessionSupplierId("");
    setShowAllInventory(false);
    setPendingUnlinkedItem(null);
    setLinkError("");
    setInvoiceNumber("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setGlobalNote("");
    setResults(null);
    setTouched(false);
  }

  async function switchMode(newMode: "direct" | "po") {
    setMode(newMode);
    setPoResult(null);
    if (newMode === "po" && openPOs.length === 0) {
      setPoLoading(true);
      try {
        const res = await getOpenPurchases();
        setOpenPOs(res.purchases);
      } catch {
        setOpenPOs([]);
      } finally {
        setPoLoading(false);
      }
    }
  }

  function saveDraftNow() {
    const po = selectedPoRef.current;
    const batches = poBatchesRef.current;
    if (!po) return;
    const payload: PoDraftPayload = {
      poId: po.id,
      savedAt: new Date().toISOString(),
      batches: Object.fromEntries(
        Object.entries(batches).map(([id, arr]) => [id, arr.map(({ key: _k, ...rest }) => rest)])
      ),
    };
    localStorage.setItem(PO_DRAFT_PREFIX + po.id, JSON.stringify(payload));
    setDraftSavedAt(new Date());
  }

  function loadDraftFromStorage(poId: string): PoDraftPayload | null {
    try {
      const raw = localStorage.getItem(PO_DRAFT_PREFIX + poId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PoDraftPayload;
      return parsed.poId === poId ? parsed : null;
    } catch { return null; }
  }

  function applyDraft(draft: PoDraftPayload) {
    const restored: Record<string, PoBatchDraft[]> = {};
    for (const [id, arr] of Object.entries(draft.batches)) {
      const itemLine = selectedPo?.purchaseItems.find((item) => item.id === id);
      const unitConfig = itemLine ? poUnitConfig(itemLine) : null;
      restored[id] = arr.map((b, index) => {
        const legacyBatch = b as typeof b & { unitCost?: string };
        const wasBaseUnit = (b.enteredUnit ?? "base") === "base";
        const numericQuantity = parseFloat(b.quantity);
        const originalBaseQuantity = Number.isFinite(numericQuantity)
          ? (unitConfig?.purchaseUnit && !wasBaseUnit ? numericQuantity * unitConfig.factor : numericQuantity)
          : 0;
        const quantity = unitConfig?.purchaseUnit && wasBaseUnit && Number.isFinite(numericQuantity)
          ? String(numericQuantity / unitConfig.factor)
          : b.quantity;
        return {
          ...b,
          quantity,
          totalAmount: b.totalAmount ?? (legacyBatch.unitCost && originalBaseQuantity > 0
            ? String(roundCurrency(parseFloat(legacyBatch.unitCost) * originalBaseQuantity))
            : ""),
          batchNo: b.batchNo || generatePoBatchNo(draft.poId, id, index),
          enteredUnit: unitConfig?.purchaseUnit ? "purchase" : "base",
          key: ++poBatchSeq,
        };
      });
    }
    setPoBatches(restored);
    setDraftSavedAt(new Date(draft.savedAt));
    setPendingDraft(null);
  }

  function clearDraft(poId: string) {
    localStorage.removeItem(PO_DRAFT_PREFIX + poId);
    setDraftSavedAt(null);
    setPendingDraft(null);
  }

  useEffect(() => {
    if (!selectedPo) return;
    const id = setInterval(saveDraftNow, 30_000);
    return () => clearInterval(id);
  }, [selectedPo?.id]);

  function handlePoSelect(poId: string) {
    setSelectedPoId(poId);
    setPoResult(null);
    setOverReceiveConfirmed(false);
    setOverReceiveWarnings([]);
    const po = openPOs.find((p) => p.id === poId) ?? null;
    setSelectedPo(po);
    if (!po) { setPoBatches({}); setPendingDraft(null); setDraftSavedAt(null); return; }

    const draft = loadDraftFromStorage(po.id);
    if (draft) {
      setPendingDraft(draft);
    } else {
      setPendingDraft(null);
      setDraftSavedAt(null);
    }

    const fallbackLoc = defaultLocationId || (locations[0]?.id ?? "");
    const init: Record<string, PoBatchDraft[]> = {};
    for (const item of po.purchaseItems.filter((i) => i.remainingQuantity > 0)) {
      const usePurchaseUnit = Boolean(poUnitConfig(item).purchaseUnit);
      init[item.id] = [newPoBatch({
        locationId: fallbackLoc,
        totalAmount: String(roundCurrency(item.remainingQuantity * item.unitCost)),
        batchNo: generatePoBatchNo(po.id, item.id, 0),
        quantity: String(poDisplayQuantity(item, item.remainingQuantity)),
        enteredUnit: usePurchaseUnit ? "purchase" : "base",
      })];
    }
    setPoBatches(init);
  }

  function updatePoBatch(purchaseItemId: string, key: number, patch: Partial<PoBatchDraft>) {
    setPoBatches((cur) => ({
      ...cur,
      [purchaseItemId]: cur[purchaseItemId].map((b) => b.key === key ? { ...b, ...patch } : b),
    }));
  }

  function addPoBatch(purchaseItemId: string, defaults: { locationId: string; totalAmount: string; enteredUnit?: "base" | "purchase" }) {
    setPoBatches((cur) => ({
      ...cur,
      [purchaseItemId]: [...cur[purchaseItemId], newPoBatch({
        ...defaults,
        batchNo: generatePoBatchNo(selectedPo?.id ?? "PO", purchaseItemId, cur[purchaseItemId].length),
      })],
    }));
  }

  function removePoBatch(purchaseItemId: string, key: number) {
    setPoBatches((cur) => ({
      ...cur,
      [purchaseItemId]: cur[purchaseItemId].filter((b) => b.key !== key),
    }));
  }

  async function handlePoReceiveSubmit(confirmed = false) {
    if (!selectedPo) return;
    const pendingItems = selectedPo.purchaseItems.filter((i) => i.remainingQuantity > 0);

    const lines: import("../types").ReceivePurchaseLineInput[] = [];
    const newOverWarnings: Array<{ name: string; total: number; remaining: number; unit: string }> = [];

    for (const item of pendingItems) {
      const itemBatches = poBatches[item.id] ?? [];
      let totalForItem = 0;
      for (const b of itemBatches) {
        const qty = poBatchBaseQuantity(item, b);
        if (qty <= 0) continue;
        if (!b.locationId) {
          setPoResult({ type: "error", msg: `Choose a branch for ${item.item.name}.` });
          return;
        }
        if (item.item.trackExpiry && !b.expiryDate) {
          setPoResult({ type: "error", msg: `Add the expiry date for ${item.item.name}.` });
          return;
        }
        totalForItem += qty;
        lines.push({
          purchaseItemId: item.id,
          receivedQuantity: qty,
          locationId: b.locationId || undefined,
          expiryDate: b.expiryDate || undefined,
          batchNo: b.batchNo || undefined,
          totalAmount: parseFloat(b.totalAmount) || undefined,
          unitCostExclTax: parseFloat(b.unitCostExclTax) || undefined,
          unitTax: parseFloat(b.unitTax) || undefined,
          unitCostInclTax: parseFloat(b.unitCostInclTax) || undefined,
          notes: b.notes || undefined,
        });
      }
      if (totalForItem > item.remainingQuantity) {
        newOverWarnings.push({ name: item.item.name, total: totalForItem, remaining: item.remainingQuantity, unit: item.item.unit });
      }
    }

    if (lines.length === 0) {
      setPoResult({ type: "error", msg: "Enter at least one received quantity." });
      return;
    }

    const isOverReceive = newOverWarnings.length > 0;
    if (isOverReceive && !confirmed && !overReceiveConfirmed) {
      setOverReceiveWarnings(newOverWarnings);
      return;
    }

    setPoSubmitting(true);
    setPoResult(null);
    setOverReceiveWarnings([]);
    try {
      await receivePurchase(selectedPo.id, { lines, allowOverReceive: isOverReceive });
      clearDraft(selectedPo.id);
      setPoResult({ type: "success", msg: "Receipt confirmed. Stock has been updated." });
      const res = await getOpenPurchases();
      setOpenPOs(res.purchases);
      setSelectedPoId("");
      setSelectedPo(null);
      setPoBatches({});
      setOverReceiveConfirmed(false);
    } catch (err) {
      setPoResult({ type: "error", msg: err instanceof Error ? err.message : "Failed to record receipt." });
    } finally {
      setPoSubmitting(false);
    }
  }

  function handleApplyFromInvoice(results: Array<{
    purchaseItemId: string;
    qty: number;
    unitCost: number;
    unitCostExclTax: number | null;
    unitTax: number | null;
    unitCostInclTax: number | null;
    batchNo: string;
    expiryDate: string;
  }>) {
    const newBatches: Record<string, PoBatchDraft[]> = { ...poBatches };
    for (const result of results) {
      const existing = newBatches[result.purchaseItemId] ?? [];
      const emptyIdx = existing.findIndex((b) => !parseFloat(b.quantity));
      const patch: PoBatchDraft = {
        key: emptyIdx >= 0 ? existing[emptyIdx].key : ++poBatchSeq,
        quantity: String(poDisplayQuantity(selectedPo!.purchaseItems.find((i) => i.id === result.purchaseItemId)!, result.qty)),
        locationId: existing[0]?.locationId ?? defaultLocationId ?? "",
        expiryDate: result.expiryDate ?? "",
        batchNo: result.batchNo || generatePoBatchNo(selectedPo!.id, result.purchaseItemId, emptyIdx >= 0 ? emptyIdx : existing.length),
        totalAmount: String(roundCurrency(result.unitCost * result.qty)),
        unitCostExclTax: result.unitCostExclTax != null ? String(result.unitCostExclTax) : "",
        unitTax: result.unitTax != null ? String(result.unitTax) : "",
        unitCostInclTax: result.unitCostInclTax != null ? String(result.unitCostInclTax) : "",
        notes: "",
        enteredUnit: poUnitConfig(selectedPo!.purchaseItems.find((i) => i.id === result.purchaseItemId)!).purchaseUnit ? "purchase" : "base",
      };
      if (emptyIdx >= 0) {
        newBatches[result.purchaseItemId] = [
          ...existing.slice(0, emptyIdx),
          patch,
          ...existing.slice(emptyIdx + 1),
        ];
      } else {
        newBatches[result.purchaseItemId] = [...existing, patch];
      }
    }
    setPoBatches(newBatches);
  }

  function isRowValid(row: BatchRow) {
    const qty = rowBaseQuantity(row);
    const totalPrice = parseFloat(row.totalPrice);
    if (!qty || !Number.isFinite(qty) || qty <= 0) return false;
    if (!Number.isFinite(totalPrice) || totalPrice <= 0) return false;
    if (row.item.trackExpiry && !row.expiryDate) return false;
    return true;
  }

  const validRowCount = rows.filter(isRowValid).length;
  const receiptTotal = rows.reduce((sum, row) => sum + (isRowValid(row) ? parseFloat(row.totalPrice) : 0), 0);

  async function handleSubmit() {
    setTouched(true);
    if (!sessionSupplierId || validRowCount === 0) return;

    setSubmitting(true);
    const out: RowResult[] = [];

    for (const row of rows) {
      if (!isRowValid(row)) {
        out.push({ rowId: row.rowId, itemName: row.item.name, batchNo: row.batchNo, status: "error", error: "Invalid - skipped" });
        continue;
      }
      const selectedSupplier = suppliers.find((s) => s.id === sessionSupplierId);
      const enteredQty = parseFloat(row.qty);
      const isPurchaseUnit = row.enteredUnit === "purchase" && hasDifferentPurchaseUnit(row.item);
      const baseQty = rowBaseQuantity(row) ?? enteredQty;
      const unitCost = calculatedUnitCost(row);
      try {
        await stockIn({
          itemId: row.item.id,
          quantity: baseQty,
          totalPrice: parseFloat(row.totalPrice),
          unitCost: unitCost ?? undefined,
          expiryDate: row.expiryDate || undefined,
          batchNo: row.batchNo || undefined,
          supplierId: sessionSupplierId || undefined,
          supplierName: selectedSupplier?.name,
          note: [row.note.trim(), invoiceNumber.trim() ? `Invoice ${invoiceNumber.trim()}` : null, invoiceDate ? `Invoice date ${invoiceDate}` : null, globalNote.trim()].filter(Boolean).join(" - ") || undefined,
          enteredQuantity: isPurchaseUnit ? enteredQty : undefined,
          enteredUnit: isPurchaseUnit ? row.item.purchaseUnit! : undefined,
        });
        out.push({ rowId: row.rowId, itemName: row.item.name, batchNo: row.batchNo, status: "success" });
      } catch (err) {
        out.push({
          rowId: row.rowId,
          itemName: row.item.name,
          batchNo: row.batchNo,
          status: "error",
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    setResults(out);
    setSubmitting(false);
    const failedIds = new Set(out.filter((r) => r.status === "error").map((r) => r.rowId));
    setRows((prev) => prev.filter((r) => failedIds.has(r.rowId)));
    if (failedIds.size === 0) { setGlobalNote(""); setInvoiceNumber(""); }
  }

  const successCount = results?.filter((r) => r.status === "success").length ?? 0;
  const allSucceeded = results !== null && results.length > 0 && results.every((r) => r.status === "success");

  return (
    <div className="stock-entry-page">
      <div className="stock-entry-header">
        <div>
          <h1 className="page-title">Stock receiving</h1>
        </div>
      </div>

      <div className="stock-entry-mode-toggle">
        <button
          type="button"
          className={`stock-entry-mode-btn${mode === "direct" ? " stock-entry-mode-btn--active" : ""}`}
          onClick={() => void switchMode("direct")}
        >
          Receive delivery
        </button>
        <button
          type="button"
          className={`stock-entry-mode-btn${mode === "po" ? " stock-entry-mode-btn--active" : ""}`}
          onClick={() => void switchMode("po")}
        >
          Receive purchase order
        </button>
      </div>

      {mode === "po" ? (
        <div className="po-receive-section">
          {poLoading ? (
            <div className="po-receive-loading">Loading open purchase orders...</div>
          ) : openPOs.length === 0 ? (
            <div className="po-receive-empty">
              <p>No open purchase orders found.</p>
              <p>Go to <a className="po-receive-link" href="/purchases">Purchases</a>, create a draft PO, and mark it as Ordered to receive here.</p>
            </div>
          ) : (
            <>
              <div className="form-group po-receive-selector">
                <label className="form-label">Select Purchase Order</label>
                <select className="form-input form-select" value={selectedPoId} onChange={(e) => handlePoSelect(e.target.value)}>
                  <option value="">Choose an open PO to receive against...</option>
                  {openPOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.supplier.name} - {po.remainingQuantity} unit{po.remainingQuantity !== 1 ? "s" : ""} remaining (#{po.id.slice(-6).toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
              {pendingDraft && selectedPo && (
                <div className="po-draft-banner">
                  <div className="po-draft-banner-text">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    <span>You have an unsaved draft from {new Date(pendingDraft.savedAt).toLocaleString()}. Restore it?</span>
                  </div>
                  <div className="po-draft-banner-actions">
                    <button type="button" className="po-draft-btn po-draft-btn--restore" onClick={() => applyDraft(pendingDraft)}>Restore Draft</button>
                    <button type="button" className="po-draft-btn po-draft-btn--discard" onClick={() => clearDraft(selectedPo.id)}>Discard</button>
                  </div>
                </div>
              )}
              {selectedPo && (
                <InvoiceUploadCard
                  purchaseOrderId={selectedPo.id}
                  ocrAvailable={ocrAvailable}
                  onExtracted={async (upload) => {
                    setInvoiceUpload(upload);
                    try {
                      const matched = await matchInvoiceLines(upload.id, selectedPo.id);
                      setInvoiceUpload(matched.invoiceUpload);
                    } catch {
                      setInvoiceUpload(upload);
                    }
                  }}
                  onUploaded={(upload) => setInvoiceUpload({ ...upload, invoiceLines: [] })}
                />
              )}
              {invoiceUpload && invoiceUpload.invoiceLines.length > 0 && selectedPo && (
                <SmartMatchingPanel
                  invoiceUpload={invoiceUpload}
                  purchaseItems={selectedPo.purchaseItems.filter((i) => i.remainingQuantity > 0).map((i) => ({
                    id: i.id,
                    itemId: i.itemId,
                    itemName: i.item.name,
                    unit: i.item.unit,
                    remainingQuantity: i.remainingQuantity,
                    unitCost: i.unitCost,
                  }))}
                  inventoryCostBasis={settings.inventoryCostBasis}
                  currency={currency}
                  onApply={handleApplyFromInvoice}
                  onInvoiceUpdated={setInvoiceUpload}
                />
              )}
              {selectedPo && Object.keys(poBatches).length > 0 && (
                <div className="po-receive-form">
                  <div className="po-receive-summary">
                    <span><strong>{selectedPo.supplier.name}</strong></span>
                    <span>Ordered: {selectedPo.orderedQuantity}</span>
                    <span>Received so far: {selectedPo.receivedQuantity}</span>
                    <span>Remaining: <strong>{selectedPo.remainingQuantity}</strong></span>
                  </div>
                  <div className="por-items" style={{ padding: "14px 16px", gap: 12 }}>
                    {selectedPo.purchaseItems.filter((i) => i.remainingQuantity > 0).map((itemLine) => {
                      const itemBatches = poBatches[itemLine.id] ?? [];
                      const batchTotal = itemBatches.reduce((s, b) => s + poBatchBaseQuantity(itemLine, b), 0);
                      const isOver = batchTotal > itemLine.remainingQuantity + 0.000001;
                      const lastBatch = itemBatches[itemBatches.length - 1];
                      const fallbackLoc = defaultLocationId || (locations[0]?.id ?? "");
                      const unitConfig = poUnitConfig(itemLine);
                      const allocatedDisplay = poDisplayQuantity(itemLine, batchTotal);
                      return (
                        <div key={itemLine.id} className="por-card">
                          <div className="por-card-head">
                            <div className="por-card-head-left">
                              <span className="por-card-name">{itemLine.item.name}</span>
                              <div className="por-card-progress">
                                <strong>{formatPoLineQty(itemLine, itemLine.receivedQuantity)}</strong> of {formatPoLineQty(itemLine, itemLine.orderedQuantity)} received
                                {itemLine.receivedQuantity > 0 && <span> · {formatPoLineQty(itemLine, itemLine.remainingQuantity)} remaining</span>}
                              </div>
                              {unitConfig.purchaseUnit && (
                                <div className="por-card-conversion">
                                  {fmtQty(allocatedDisplay)} {unitConfig.purchaseUnit} will add {fmtQty(batchTotal)} {unitConfig.baseUnit} to stock
                                </div>
                              )}
                            </div>
                            {isOver && <span className="por-over-warning">Over remaining quantity by {fmtQty(poDisplayQuantity(itemLine, batchTotal - itemLine.remainingQuantity))} {unitConfig.purchaseUnit ?? unitConfig.baseUnit}</span>}
                          </div>
                          <div className="por-batches">
                            {itemBatches.map((batch, idx) => (
                              <div key={batch.key} className="por-batch-row">
                                <div className="por-batch-label">
                                  <div>
                                    <span className="por-batch-num">{itemBatches.length > 1 ? `Batch ${idx + 1}` : "Receive now"}</span>
                                    <span className="por-batch-reference">Ref: {batch.batchNo}</span>
                                  </div>
                                  {itemBatches.length > 1 && (
                                    <button type="button" className="por-batch-remove" onClick={() => removePoBatch(itemLine.id, batch.key)} aria-label={`Remove batch ${idx + 1}`}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                                <div className="por-fields por-fields--primary">
                                  <label className="por-field">
                                    <span className="por-field-label">Received quantity *</span>
                                    <div className="por-quantity-input">
                                      <input className={`form-input${isOver ? " por-field--over" : ""}`} type="number" min="0" step="0.01" placeholder="0" value={batch.quantity} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { quantity: e.target.value })} />
                                      <strong>{unitConfig.purchaseUnit ?? unitConfig.baseUnit}</strong>
                                    </div>
                                  </label>
                                  {itemLine.item.trackExpiry && <label className="por-field">
                                    <span className="por-field-label">Expiry date{itemLine.item.trackExpiry ? " *" : ""}</span>
                                    <input className="form-input" type="date" value={batch.expiryDate} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { expiryDate: e.target.value })} />
                                  </label>}
                                </div>
                                <details className="por-more-details">
                                  <summary>Change branch, cost or add a note</summary>
                                  <div className="por-fields por-fields--details">
                                    <label className="por-field">
                                      <span className="por-field-label">Receiving branch</span>
                                      <select className="form-input form-select" value={batch.locationId} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { locationId: e.target.value })}>
                                        {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                                      </select>
                                    </label>
                                    <label className="por-field">
                                      <span className="por-field-label">Total invoice amount</span>
                                      <input className="form-input" type="number" min="0" step="0.01" value={batch.totalAmount} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { totalAmount: e.target.value })} />
                                      <small>{poBatchBaseQuantity(itemLine, batch) > 0 && parseFloat(batch.totalAmount) > 0 ? `${formatCurrency(parseFloat(batch.totalAmount) / poBatchBaseQuantity(itemLine, batch), currency)} per ${unitConfig.baseUnit}` : "Unit cost calculates automatically"}</small>
                                    </label>
                                    <label className="por-field">
                                      <span className="por-field-label">Note</span>
                                      <input className="form-input" value={batch.notes} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { notes: e.target.value })} placeholder="Optional" />
                                    </label>
                                    {!itemLine.item.trackExpiry && <label className="por-field">
                                      <span className="por-field-label">Expiry date</span>
                                      <input className="form-input" type="date" value={batch.expiryDate} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { expiryDate: e.target.value })} />
                                    </label>}
                                  </div>
                                </details>
                              </div>
                            ))}
                          </div>
                          <div className="por-add-batch-row">
                            <button type="button" className="por-add-batch-btn" onClick={() => addPoBatch(itemLine.id, { locationId: lastBatch?.locationId ?? fallbackLoc, totalAmount: "", enteredUnit: unitConfig.purchaseUnit ? "purchase" : "base" })}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                              Split into another batch
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="po-receive-footer">
                    {overReceiveWarnings.length > 0 && (
                      <div className="po-overreceive-confirm">
                        <div className="po-overreceive-confirm-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        </div>
                        <div className="po-overreceive-confirm-body">
                          <p className="po-overreceive-confirm-title">Over-receive detected</p>
                          <ul className="po-overreceive-confirm-list">
                            {overReceiveWarnings.map((w) => (
                              <li key={w.name}><strong>{w.name}</strong>: receiving {w.total} {w.unit} vs. {w.remaining} {w.unit} remaining (over by {+(w.total - w.remaining).toFixed(4)})</li>
                            ))}
                          </ul>
                          <p className="po-overreceive-confirm-note">This will add extra inventory beyond the ordered quantity. Do you want to proceed?</p>
                          <div className="po-overreceive-confirm-actions">
                            <button type="button" className="btn btn--primary" onClick={() => { setOverReceiveConfirmed(true); void handlePoReceiveSubmit(true); }} disabled={poSubmitting}>
                              {poSubmitting ? "Receiving..." : "Accept & Confirm Receipt"}
                            </button>
                            <button type="button" className="btn btn--ghost" onClick={() => setOverReceiveWarnings([])}>Cancel</button>
                          </div>
                        </div>
                      </div>
                    )}
                    {poResult && <div className={`po-receive-result po-receive-result--${poResult.type}`}>{poResult.msg}</div>}
                    {overReceiveWarnings.length === 0 && (
                      <div className="po-footer-row">
                        <div className="po-footer-draft">
                          <button type="button" className="po-draft-save-btn" onClick={saveDraftNow} title="Save your current progress as a draft">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            Save Draft
                          </button>
                          {draftSavedAt && (
                            <span className="po-draft-saved-at">Auto-saved {draftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          )}
                        </div>
                        <button type="button" className="btn btn--primary" onClick={() => void handlePoReceiveSubmit()} disabled={poSubmitting}>
                          {poSubmitting ? "Receiving..." : "Confirm Receipt"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
      {results && (
        <div className={`stock-entry-results ${allSucceeded ? "stock-entry-results--success" : "stock-entry-results--partial"}`}>
          <div className="stock-entry-results-icon">
            {allSucceeded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            )}
          </div>
          <div className="stock-entry-results-body">
            <div className="stock-entry-results-title">
              {allSucceeded
                ? `All ${successCount} batch${successCount !== 1 ? "es" : ""} recorded successfully`
                : `${successCount} of ${results.length} batches recorded`}
            </div>
            {results.some((r) => r.status === "error") && (
              <ul className="stock-entry-results-errors">
                {results.filter((r) => r.status === "error").map((r) => (
                  <li key={r.rowId}><strong>{r.itemName}</strong> ({r.batchNo}): {r.error}</li>
                ))}
              </ul>
            )}
          </div>
          {allSucceeded && (
            <button className="btn btn--ghost btn--sm" onClick={clearAll}>Start new entry</button>
          )}
        </div>
      )}

      <section className="receive-panel receive-panel--delivery">
        <div className="receive-panel-heading">
          <div>
            <span className="receive-step">Delivery details</span>
            <h2>Who is this delivery from?</h2>
          </div>
          <span className="receive-panel-hint">Applies to all items</span>
        </div>
        <div className="stock-entry-session">
        <div className="form-group">
          <label className="form-label">Supplier *</label>
          <select className="form-select" value={sessionSupplierId} onChange={(e) => handleSessionSupplierChange(e.target.value)}>
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Invoice number</label>
          <input className="form-input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Optional" />
        </div>
        <div className="form-group">
          <label className="form-label">Invoice date</label>
          <input className="form-input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>
        </div>
      </section>

      <section className="receive-panel receive-panel--search">
        <div className="receive-panel-heading">
          <div>
            <span className="receive-step">Add items</span>
            <h2>What was delivered?</h2>
          </div>
        </div>
        <div className="stock-entry-search-section">
        <div className="stock-entry-search-heading">
          <label className="stock-entry-search-label">
            {sessionSupplierId
              ? `Items supplied by ${suppliers.find((supplier) => supplier.id === sessionSupplierId)?.name ?? "selected supplier"}`
              : "Select a supplier first"}
          </label>
          {sessionSupplierId && (
            <button type="button" className="receive-text-button" onClick={() => { setShowAllInventory((current) => !current); setShowDropdown(true); }}>
              {showAllInventory ? "Show supplier items only" : "Can't find it? Show all inventory"}
            </button>
          )}
        </div>
        <div className="stock-entry-search-wrap" ref={dropdownRef}>
          <div className="stock-entry-search-box">
            <svg className="stock-entry-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              className="stock-entry-search-input"
              placeholder={loadingItems ? "Loading items..." : sessionSupplierId ? "Search by name, SKU, or barcode..." : "Choose the delivery supplier above"}
              value={search}
              disabled={loadingItems || !sessionSupplierId}
              onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
            />
            {loadingItems && <div className="spinner stock-entry-search-spinner" />}
          </div>
          {showDropdown && !loadingItems && (
            <div className="stock-entry-dropdown">
              {filteredItems.length === 0 ? (
                <div className="stock-entry-dropdown-empty">
                  {search
                    ? "No items match your search"
                    : stagedItemIds.size === allItems.length
                      ? "All items already added - use + Add batch on a row to add another batch"
                      : "Start typing to search"}
                </div>
              ) : (
                filteredItems.slice(0, 10).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="stock-entry-dropdown-item"
                    onClick={() => chooseItem(item)}
                  >
                    <div className="stock-entry-dropdown-main">
                      <div className="stock-entry-dropdown-name">{item.name}</div>
                      <div className="stock-entry-dropdown-meta">
                        {item.category || "Uncategorised"}{item.sku ? ` · ${item.sku}` : ""}
                      </div>
                    </div>
                    <div className="stock-entry-dropdown-details">
                      <span className="stock-entry-dropdown-unit">
                        Receive in <strong>{hasDifferentPurchaseUnit(item) ? item.purchaseUnit : item.unit}</strong>
                      </span>
                      {hasDifferentPurchaseUnit(item) && (
                        <span className="stock-entry-dropdown-conversion">
                          1 {item.purchaseUnit} = {fmtQty(item.purchaseConversionFactor!)} {item.unit}
                        </span>
                      )}
                      {item.trackExpiry && <span className="stock-entry-dropdown-expiry">Expiry tracked</span>}
                      {showAllInventory && !itemMatchesSupplier(item.id) && <span className="stock-entry-dropdown-unlinked">Not linked to supplier</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        </div>
        {pendingUnlinkedItem && (
          <div className="receive-unlinked-prompt" role="alert">
            <div>
              <strong>{pendingUnlinkedItem.name} is not linked to this supplier.</strong>
              <span>Receive it once, or save this supplier as an alternate for future deliveries.</span>
              {linkError && <em>{linkError}</em>}
            </div>
            <div className="receive-unlinked-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { addItem(pendingUnlinkedItem); setPendingUnlinkedItem(null); }}>Receive once</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={linkingSupplier} onClick={() => void linkAndAddPendingItem()}>{linkingSupplier ? "Linking..." : "Add as alternate"}</button>
              <button type="button" className="receive-text-button" onClick={() => setPendingUnlinkedItem(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {rows.length > 0 ? (
        <>
          <div className="receive-items-list">
                {rows.map((row, idx) => {
                  const qty = parseFloat(row.qty);
                  const qtyInvalid = touched && (row.qty !== "" ? (isNaN(qty) || qty <= 0) : true);
                  const priceInvalid = touched && (!Number.isFinite(parseFloat(row.totalPrice)) || parseFloat(row.totalPrice) <= 0);
                  const expiryMissing = touched && row.item.trackExpiry && !row.expiryDate;
                  const batchNum = rows.slice(0, idx + 1).filter((r) => r.item.id === row.item.id).length;
                  const itemBatchCount = rows.filter((r) => r.item.id === row.item.id).length;
                  const displayUnit = row.enteredUnit === "purchase" && hasDifferentPurchaseUnit(row.item) ? row.item.purchaseUnit! : row.item.unit;
                  const baseQty = rowBaseQuantity(row);
                  const unitCost = calculatedUnitCost(row);

                  return (
                    <article key={row.rowId} className={`receive-item-card${qtyInvalid || priceInvalid || expiryMissing ? " receive-item-card--invalid" : ""}`}>
                      <header className="receive-item-head">
                        <div className="receive-item-identity">
                          <div className="receive-item-icon">{row.item.name.slice(0, 1).toUpperCase()}</div>
                          <div>
                            <div className="receive-item-title-row">
                              <h3>{row.item.name}</h3>
                              {itemBatchCount > 1 && <span className="receive-batch-pill">Batch {batchNum}</span>}
                              {row.item.trackExpiry && <span className="receive-expiry-pill">Expiry tracked</span>}
                            </div>
                            <p>{row.item.category || "Inventory item"}{row.item.sku ? ` · ${row.item.sku}` : ""}</p>
                          </div>
                        </div>
                        <button type="button" className="stock-entry-remove-btn" onClick={() => removeRow(row.rowId)} aria-label={`Remove ${row.item.name}`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </header>

                      <div className="receive-item-primary">
                        <label className="receive-field receive-field--quantity">
                          <span>Quantity received *</span>
                          <div className={`receive-input-unit${qtyInvalid ? " receive-input-unit--error" : ""}`}>
                        <input
                          className="stock-entry-input"
                          type="number"
                          min={0.01}
                          step="any"
                          placeholder="0"
                          value={row.qty}
                          onChange={(e) => updateRow(row.rowId, "qty", e.target.value)}
                        />
                            <strong>{displayUnit}</strong>
                          </div>
                          {hasDifferentPurchaseUnit(row.item) && row.enteredUnit === "purchase" && <small>1 {row.item.purchaseUnit} = {fmtQty(row.item.purchaseConversionFactor!)} {row.item.unit}{baseQty ? ` · Adds ${fmtQty(baseQty)} ${row.item.unit}` : ""}</small>}
                          {qtyInvalid && <em>Enter a quantity greater than zero.</em>}
                        </label>
                        <label className="receive-field receive-field--price">
                          <span>Total purchase price *</span>
                          <div className={`receive-input-currency${priceInvalid ? " receive-input-currency--error" : ""}`}>
                            <b>{currency}</b>
                        <input
                          className="stock-entry-input"
                          type="number"
                          min={0.01}
                          step="any"
                          placeholder="0.00"
                          value={row.totalPrice}
                          onChange={(e) => updateRow(row.rowId, "totalPrice", e.target.value)}
                        />
                          </div>
                          <small>{unitCost !== null ? `${formatCurrency(unitCost, currency)} per ${row.item.unit}` : "Unit cost calculates automatically"}{row.lastPrice !== null ? ` · Last ${formatCurrency(row.lastPrice, currency)}` : ""}</small>
                          {priceInvalid && <em>Enter the total price paid.</em>}
                        </label>
                        {row.item.trackExpiry && <label className="receive-field receive-field--expiry">
                          <span>Expiry date *</span>
                          <input
                            className={`stock-entry-input ${expiryMissing ? "stock-entry-input--error" : ""}`}
                            type="date"
                            value={row.expiryDate}
                            onChange={(e) => updateRow(row.rowId, "expiryDate", e.target.value)}
                          />
                          {expiryMissing && <em>Add an expiry date to continue.</em>}
                        </label>}
                      </div>

                      <details className="receive-item-details">
                        <summary>More details and options</summary>
                        <div className="receive-item-details-grid">
                          {hasDifferentPurchaseUnit(row.item) && <div className="receive-detail-option">
                            <span>Quantity unit</span>
                            <button type="button" className="receive-text-button" onClick={() => setRows((prev) => prev.map((r) => r.rowId === row.rowId ? { ...r, enteredUnit: r.enteredUnit === "purchase" ? "base" : "purchase", qty: "" } : r))}>
                              {row.enteredUnit === "purchase" ? `Enter loose ${row.item.unit} instead` : `Enter ${row.item.purchaseUnit} instead`}
                            </button>
                          </div>}
                          <label className="receive-field">
                            <span>Batch / lot number</span>
                            <input
                              className="stock-entry-input"
                              type="text"
                              value={row.batchNo}
                              onChange={(e) => updateRow(row.rowId, "batchNo", e.target.value)}
                              placeholder="Auto"
                            />
                          </label>
                          <label className="receive-field">
                            <span>Item note</span>
                            <input
                              className="stock-entry-input"
                              type="text"
                              placeholder="Optional..."
                              value={row.note}
                              onChange={(e) => updateRow(row.rowId, "note", e.target.value)}
                            />
                          </label>
                        </div>
                      </details>
                      <button type="button" className="receive-add-batch" onClick={() => addBatch(row.rowId)}>+ Split into another batch</button>
                    </article>
                  );
                })}
          </div>

          <div className="stock-entry-global-note stock-entry-global-note--inline">
            <label className="form-label">Receipt note <span className="form-label-hint">(optional)</span></label>
            <input
              className="form-input"
              type="text"
              placeholder="Add one note for this receipt..."
              value={globalNote}
              onChange={(e) => setGlobalNote(e.target.value)}
            />
          </div>

          <div className="stock-entry-footer">
            <div className="stock-entry-receipt-summary">
              <strong>{validRowCount} item{validRowCount !== 1 ? "s" : ""}</strong>
              <span>{formatCurrency(receiptTotal, currency)}</span>
            </div>
            <div className="stock-entry-footer-actions">
              <button type="button" className="btn btn--ghost" onClick={clearAll} disabled={submitting}>
                Clear all
              </button>
              <button
                type="button"
                className="btn btn--stock-in"
                onClick={() => void handleSubmit()}
                disabled={submitting || !sessionSupplierId || rows.length === 0 || validRowCount !== rows.length}
              >
                {submitting ? <span className="btn-spinner" /> : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:15,height:15}}>
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                )}
                {submitting ? "Recording..." : `Record Receipt (${validRowCount} item${validRowCount !== 1 ? "s" : ""})`}
              </button>
            </div>
          </div>
        </>
      ) : (
        !results && (
          <div className="stock-entry-empty">
            <div className="stock-entry-empty-icon stock-entry-empty-icon--in">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <h3>No items added yet</h3>
            <p>Use the search above to find items and add them to this receiving entry.</p>
          </div>
        )
      )}
      </>
      )}
    </div>
  );
}
