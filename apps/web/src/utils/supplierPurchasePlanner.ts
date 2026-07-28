import { getItems } from "../api/items";
import { getSupplierMappings } from "../api/item-suppliers";
import { createReorderPurchases } from "../api/reorderSuggestions";
import { getStockMovements, getStockSummary } from "../api/stock";
import { getSuppliers } from "../api/suppliers";
import type { Item, StockMovement, StockSummaryItem, Supplier } from "../types";

const HISTORY_DAYS = 60;
const DEFAULT_PLAN_DAYS = 30;
const MIN_OBSERVATION_DAYS = 7;
const DAY_MS = 86_400_000;
const MODAL_ID = "supplier-purchase-plan-modal";
const REORDER_BUTTON_ID = "supplier-purchase-plan-button";
const DASHBOARD_LINK_ID = "supplier-purchase-plan-dashboard-link";

type PlanDays = 15 | 30 | 60;
type PlanStatus = "BUY" | "REVIEW" | "ENOUGH";
type ViewFilter = "BUY" | "REVIEW" | "ALL";

type SupplierPlanRow = {
  item: Item;
  factor: number;
  displayUnit: string;
  currentQty: number;
  incomingQty: number;
  forecastUsageQty: number | null;
  lowStockQty: number;
  projectedQty: number | null;
  suggestedQty: number;
  status: PlanStatus;
};

type PlannerData = {
  suppliers: Supplier[];
  items: Item[];
  summaries: StockSummaryItem[];
  movements: StockMovement[];
  mappings: Awaited<ReturnType<typeof getSupplierMappings>>["items"];
};

type PlannerState = {
  data: PlannerData;
  supplierId: string;
  planDays: PlanDays;
  rows: SupplierPlanRow[];
  filter: ViewFilter;
  selected: Set<string>;
  quantities: Map<string, number>;
  creating: boolean;
};

let installed = false;
let scheduled = false;

export function installSupplierPurchasePlanner() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  injectStyles();

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      injectLaunchers();
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", schedule);
  schedule();
}

function injectLaunchers() {
  const path = window.location.pathname;

  if (path.endsWith("/reorder-suggestions")) {
    const oldMonthlyButton = document.getElementById("inventory-monthly-plan-button");
    if (oldMonthlyButton && oldMonthlyButton.textContent?.trim() !== "Stock Settings") {
      const label = oldMonthlyButton.querySelector("span");
      if (label) label.textContent = "Stock Settings";
      else oldMonthlyButton.textContent = "Stock Settings";
      oldMonthlyButton.setAttribute("title", "Edit low-stock alerts and restock targets");
    }

    if (!document.getElementById(REORDER_BUTTON_ID)) {
      const toolbar = document.querySelector<HTMLElement>(".ro-toolbar");
      const exportButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Export Excel",
      );
      const parent = exportButton?.parentElement ?? toolbar;
      if (parent) {
        const button = document.createElement("button");
        button.id = REORDER_BUTTON_ID;
        button.type = "button";
        button.className = "btn btn--secondary supplier-plan-launcher";
        button.innerHTML = `${calendarIcon()}<span>Supplier Plan</span>`;
        button.title = "Plan a supplier purchase for the next 15, 30 or 60 days";
        button.addEventListener("click", () => { void openPlanner(); });
        if (exportButton?.parentElement === parent) parent.insertBefore(button, exportButton);
        else parent.appendChild(button);
      }
    }
  }

  if (path.endsWith("/dashboard") && !document.getElementById(DASHBOARD_LINK_ID)) {
    const reorderCard = document.querySelector<HTMLElement>(".db-card--reorder");
    if (reorderCard) {
      const link = document.createElement("button");
      link.id = DASHBOARD_LINK_ID;
      link.type = "button";
      link.className = "db-card-link supplier-plan-dashboard-link";
      link.textContent = "Plan supplier purchase →";
      link.addEventListener("click", () => { void openPlanner(); });
      reorderCard.appendChild(link);
    }
  }
}

async function openPlanner() {
  if (document.getElementById(MODAL_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "supplier-plan-overlay";
  overlay.innerHTML = `
    <section class="supplier-plan-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-plan-title">
      <header class="supplier-plan-modal-header">
        <div>
          <p>SUPPLIER PURCHASING</p>
          <h2 id="supplier-plan-title">Supplier Purchase Plan</h2>
          <span>Choose a supplier and how long the stock should last.</span>
        </div>
        <button type="button" class="supplier-plan-close" aria-label="Close">×</button>
      </header>
      <div class="supplier-plan-loading"><i></i><strong>Preparing supplier plan…</strong><small>Loading linked items, stock and 60-day usage.</small></div>
    </section>`;

  document.body.appendChild(overlay);
  document.body.classList.add("supplier-plan-body-locked");
  bindClose(overlay);

  try {
    const data = await loadPlannerData();
    const state: PlannerState = {
      data,
      supplierId: data.suppliers[0]?.id ?? "",
      planDays: DEFAULT_PLAN_DAYS,
      rows: [],
      filter: "BUY",
      selected: new Set(),
      quantities: new Map(),
      creating: false,
    };
    rebuildRows(state);
    renderPlanner(overlay, state);
  } catch (error) {
    renderError(overlay, error instanceof Error ? error.message : "Unable to prepare the supplier plan.");
  }
}

async function loadPlannerData(): Promise<PlannerData> {
  const now = new Date();
  const from = new Date(now.getTime() - (HISTORY_DAYS - 1) * DAY_MS);
  const [supplierRes, itemRes, summaryRes, movementRes, mappingRes] = await Promise.all([
    getSuppliers(),
    getItems(false),
    getStockSummary(),
    getStockMovements({ type: "STOCK_OUT", fromDate: toApiDate(from), toDate: toApiDate(now) }),
    getSupplierMappings(),
  ]);

  return {
    suppliers: [...supplierRes.suppliers].sort((a, b) => a.name.localeCompare(b.name)),
    items: itemRes.items.filter((item) => item.isActive),
    summaries: summaryRes.summary,
    movements: movementRes.movements,
    mappings: mappingRes.items,
  };
}

function rebuildRows(state: PlannerState) {
  const linkedIds = new Set(
    state.data.mappings
      .filter((mapping) =>
        mapping.primary?.supplierId === state.supplierId
        || mapping.alternates.some((alternate) => alternate.supplierId === state.supplierId),
      )
      .map((mapping) => mapping.itemId),
  );
  const summaryMap = new Map(state.data.summaries.map((summary) => [summary.itemId, summary]));
  const usageMap = buildUsageMap(state.data.movements, new Date());
  const rank = { BUY: 0, REVIEW: 1, ENOUGH: 2 } as const;

  state.rows = state.data.items
    .filter((item) => linkedIds.has(item.id))
    .map((item) => buildPlanRow(item, summaryMap.get(item.id) ?? null, usageMap.get(item.id), state.planDays))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.item.name.localeCompare(b.item.name));

  state.selected = new Set();
  state.quantities = new Map();
  for (const row of state.rows) {
    state.quantities.set(row.item.id, row.suggestedQty);
    if (row.status === "BUY" && row.suggestedQty > 0) state.selected.add(row.item.id);
  }
  state.filter = "BUY";
}

function renderPlanner(overlay: HTMLElement, state: PlannerState) {
  const modal = overlay.querySelector<HTMLElement>(".supplier-plan-modal");
  if (!modal) return;

  modal.innerHTML = `
    <header class="supplier-plan-modal-header">
      <div>
        <p>SUPPLIER PURCHASING</p>
        <h2 id="supplier-plan-title">Supplier Purchase Plan</h2>
        <span>One supplier, one coverage period, one draft purchase order.</span>
      </div>
      <button type="button" class="supplier-plan-close" aria-label="Close">×</button>
    </header>
    <div class="supplier-plan-controls">
      <label>
        <span>Supplier</span>
        <select data-role="supplier-select" class="form-select">
          ${state.data.suppliers.length === 0
            ? '<option value="">No suppliers available</option>'
            : state.data.suppliers.map((supplier) => `<option value="${escapeHtml(supplier.id)}"${supplier.id === state.supplierId ? " selected" : ""}>${escapeHtml(supplier.name)}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>Buy stock for</span>
        <select data-role="coverage-select" class="form-select">
          ${coverageOptions(state.planDays)}
        </select>
      </label>
      <p>Suggestions use current stock, incoming purchase orders and recent usage.</p>
    </div>
    <div class="supplier-plan-content" data-role="planner-content"></div>`;

  bindClose(overlay);
  modal.querySelector<HTMLSelectElement>('[data-role="supplier-select"]')?.addEventListener("change", (event) => {
    state.supplierId = (event.currentTarget as HTMLSelectElement).value;
    rebuildRows(state);
    renderContent(overlay, state);
  });
  modal.querySelector<HTMLSelectElement>('[data-role="coverage-select"]')?.addEventListener("change", (event) => {
    state.planDays = parsePlanDays((event.currentTarget as HTMLSelectElement).value);
    rebuildRows(state);
    renderContent(overlay, state);
  });
  renderContent(overlay, state);
}

function renderContent(overlay: HTMLElement, state: PlannerState) {
  const content = overlay.querySelector<HTMLElement>('[data-role="planner-content"]');
  if (!content) return;
  const supplier = state.data.suppliers.find((entry) => entry.id === state.supplierId) ?? null;

  if (!supplier) {
    content.innerHTML = '<div class="supplier-plan-empty"><h3>Add a supplier first</h3><p>Supplier purchase planning needs at least one supplier.</p></div>';
    return;
  }

  if (state.rows.length === 0) {
    content.innerHTML = `<div class="supplier-plan-empty"><h3>No items linked to ${escapeHtml(supplier.name)}</h3><p>Assign this supplier to items from Inventory, then return here.</p></div>`;
    return;
  }

  const buyCount = state.rows.filter((row) => row.status === "BUY").length;
  const reviewCount = state.rows.filter((row) => row.status === "REVIEW").length;
  const enoughCount = state.rows.filter((row) => row.status === "ENOUGH").length;
  const visible = state.rows.filter((row) => state.filter === "ALL" || row.status === state.filter);
  const selectedRows = state.rows.filter((row) => state.selected.has(row.item.id) && (state.quantities.get(row.item.id) ?? 0) > 0);
  const selectableVisible = visible.filter((row) => row.status !== "REVIEW" && (state.quantities.get(row.item.id) ?? 0) > 0);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((row) => state.selected.has(row.item.id));

  content.innerHTML = `
    <div class="supplier-plan-summary">
      <div><span>Linked items</span><strong>${state.rows.length}</strong></div>
      <div class="action"><span>Buy this visit</span><strong>${buyCount}</strong></div>
      <div class="review"><span>Review manually</span><strong>${reviewCount}</strong></div>
      <div><span>Enough stock</span><strong>${enoughCount}</strong></div>
    </div>
    <div class="supplier-plan-toolbar">
      <div class="supplier-plan-tabs">
        ${tabButton("BUY", "To buy", buyCount, state.filter)}
        ${tabButton("REVIEW", "Review", reviewCount, state.filter)}
        ${tabButton("ALL", "All linked", state.rows.length, state.filter)}
      </div>
      <label><input type="checkbox" data-action="select-visible"${allVisibleSelected ? " checked" : ""}/> Select visible</label>
    </div>
    ${state.filter === "REVIEW" ? '<div class="supplier-plan-note">No usable usage history exists for these items. Enter a quantity only after reviewing it.</div>' : ""}
    <div class="supplier-plan-table-wrap">
      <table class="supplier-plan-table">
        <thead><tr><th></th><th>Item</th><th>Current</th><th>${state.planDays}-day use</th><th>Low alert</th><th>After ${state.planDays} days</th><th>Buy now</th></tr></thead>
        <tbody>${visible.map((row) => renderRow(row, state)).join("")}</tbody>
      </table>
    </div>
    <footer class="supplier-plan-footer">
      <div><strong>${selectedRows.length}</strong> item${selectedRows.length === 1 ? "" : "s"} selected for ${escapeHtml(supplier.name)} · ${planPeriodLabel(state.planDays)}</div>
      <button type="button" class="btn btn--primary" data-action="create-draft"${state.creating || selectedRows.length === 0 ? " disabled" : ""}>
        ${state.creating ? "Creating draft…" : `Create ${escapeHtml(supplier.name)} Draft`}
      </button>
    </footer>`;

  content.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter as ViewFilter;
      renderContent(overlay, state);
    });
  });

  content.querySelector<HTMLInputElement>('[data-action="select-visible"]')?.addEventListener("change", (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    for (const row of selectableVisible) {
      if (checked) state.selected.add(row.item.id); else state.selected.delete(row.item.id);
    }
    renderContent(overlay, state);
  });

  content.querySelectorAll<HTMLInputElement>("[data-select-item]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemId = input.dataset.selectItem!;
      if (input.checked) state.selected.add(itemId); else state.selected.delete(itemId);
      renderContent(overlay, state);
    });
  });

  content.querySelectorAll<HTMLInputElement>("[data-qty-item]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemId = input.dataset.qtyItem!;
      const qty = positiveNumber(input.value);
      state.quantities.set(itemId, qty);
      if (qty > 0) state.selected.add(itemId); else state.selected.delete(itemId);
      renderContent(overlay, state);
    });
  });

  content.querySelector<HTMLButtonElement>('[data-action="create-draft"]')?.addEventListener("click", () => {
    void createDraft(overlay, state, supplier);
  });
}

function renderRow(row: SupplierPlanRow, state: PlannerState) {
  const quantity = state.quantities.get(row.item.id) ?? 0;
  const selected = state.selected.has(row.item.id);
  const statusLabel = row.status === "BUY" ? "Recommended" : row.status === "REVIEW" ? "Review" : "No purchase";
  return `<tr class="${selected ? "selected" : ""}">
    <td><input type="checkbox" data-select-item="${escapeHtml(row.item.id)}"${selected ? " checked" : ""}${quantity <= 0 ? " disabled" : ""}/></td>
    <td><strong>${escapeHtml(row.item.name)}</strong><span>${escapeHtml(row.item.category || "Uncategorized")}</span></td>
    <td>${formatQty(row.currentQty)} <small>${escapeHtml(row.displayUnit)}</small>${row.incomingQty > 0 ? `<em>+ ${formatQty(row.incomingQty)} incoming</em>` : ""}</td>
    <td>${row.forecastUsageQty === null ? '<span class="muted">No history</span>' : `${formatQty(row.forecastUsageQty)} <small>${escapeHtml(row.displayUnit)}</small>`}</td>
    <td>${formatQty(row.lowStockQty)} <small>${escapeHtml(row.displayUnit)}</small></td>
    <td class="${row.projectedQty !== null && row.projectedQty <= row.lowStockQty ? "projected-low" : ""}">${row.projectedQty === null ? "—" : `${formatQty(row.projectedQty)} <small>${escapeHtml(row.displayUnit)}</small>`}</td>
    <td><div class="supplier-plan-qty"><input type="number" min="0" step="${row.factor > 1 && !row.item.allowFractionalPurchaseUnit ? "1" : "0.01"}" value="${formatEditable(quantity)}" data-qty-item="${escapeHtml(row.item.id)}"/><span>${escapeHtml(row.displayUnit)}</span></div><em class="status ${row.status.toLowerCase()}">${statusLabel}</em></td>
  </tr>`;
}

async function createDraft(overlay: HTMLElement, state: PlannerState, supplier: Supplier) {
  const rows = state.rows.filter((row) => state.selected.has(row.item.id) && (state.quantities.get(row.item.id) ?? 0) > 0);
  if (rows.length === 0) return;
  if (!window.confirm(`Create one draft purchase order for ${supplier.name} with ${rows.length} item${rows.length === 1 ? "" : "s"}, based on a ${planPeriodLabel(state.planDays)} plan?`)) return;

  state.creating = true;
  renderContent(overlay, state);
  try {
    const response = await createReorderPurchases({
      items: rows.map((row) => ({
        itemId: row.item.id,
        supplierId: supplier.id,
        quantity: roundQty((state.quantities.get(row.item.id) ?? 0) * row.factor),
        unitCost: 0,
      })),
    });
    const purchase = response.purchases[0];
    if (purchase) window.location.assign(`/purchases?purchaseId=${encodeURIComponent(purchase.id)}&fromSupplierPlan=1&coverageDays=${state.planDays}`);
  } catch (error) {
    state.creating = false;
    renderContent(overlay, state);
    window.alert(error instanceof Error ? error.message : "Could not create the supplier purchase draft.");
  }
}

function buildUsageMap(movements: StockMovement[], now: Date) {
  const usage = new Map<string, { total: number; earliest: number }>();
  for (const movement of movements) {
    const itemId = movement.item.id;
    const createdAt = new Date(movement.createdAt).getTime();
    const current = usage.get(itemId);
    usage.set(itemId, {
      total: (current?.total ?? 0) + Math.abs(movement.quantity),
      earliest: Math.min(current?.earliest ?? createdAt, createdAt),
    });
  }

  const result = new Map<string, { total: number; observedDays: number }>();
  for (const [itemId, entry] of usage) {
    const elapsedDays = Math.floor((now.getTime() - entry.earliest) / DAY_MS) + 1;
    result.set(itemId, {
      total: entry.total,
      observedDays: Math.max(MIN_OBSERVATION_DAYS, Math.min(HISTORY_DAYS, elapsedDays)),
    });
  }
  return result;
}

function buildPlanRow(
  item: Item,
  summary: StockSummaryItem | null,
  usage: { total: number; observedDays: number } | undefined,
  planDays: PlanDays,
): SupplierPlanRow {
  const usesPurchaseUnit = Boolean(
    item.purchaseUnit?.trim()
    && item.purchaseConversionFactor
    && item.purchaseConversionFactor > 0
    && item.purchaseUnit.trim().toLowerCase() !== item.unit.trim().toLowerCase(),
  );
  const factor = usesPurchaseUnit ? item.purchaseConversionFactor! : 1;
  const displayUnit = usesPurchaseUnit ? item.purchaseUnit!.trim() : item.unit.trim();
  const currentQty = (summary?.totalQuantity ?? 0) / factor;
  const incomingQty = (summary?.replenishment?.incomingBaseQty ?? 0) / factor;
  const forecastUsageQty = usage ? (usage.total / usage.observedDays) * planDays / factor : null;
  const lowStockQty = item.minStockLevel / factor;
  const projectedQty = forecastUsageQty === null ? null : currentQty + incomingQty - forecastUsageQty;
  const rawSuggestion = forecastUsageQty === null ? 0 : Math.max(0, lowStockQty + forecastUsageQty - currentQty - incomingQty);
  const suggestedQty = usesPurchaseUnit && !item.allowFractionalPurchaseUnit ? Math.ceil(rawSuggestion) : roundQty(rawSuggestion);
  const status: PlanStatus = forecastUsageQty === null ? "REVIEW" : suggestedQty > 0 ? "BUY" : "ENOUGH";

  return {
    item,
    factor,
    displayUnit,
    currentQty: roundQty(currentQty),
    incomingQty: roundQty(incomingQty),
    forecastUsageQty: forecastUsageQty === null ? null : roundQty(forecastUsageQty),
    lowStockQty: roundQty(lowStockQty),
    projectedQty: projectedQty === null ? null : roundQty(projectedQty),
    suggestedQty,
    status,
  };
}

function bindClose(overlay: HTMLElement) {
  const close = () => {
    overlay.remove();
    document.body.classList.remove("supplier-plan-body-locked");
  };
  overlay.querySelector(".supplier-plan-close")?.addEventListener("click", close);
  if (overlay.dataset.closeBound === "1") return;
  overlay.dataset.closeBound = "1";
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", function escapeHandler(event) {
    if (event.key !== "Escape" || !overlay.isConnected) return;
    document.removeEventListener("keydown", escapeHandler);
    close();
  });
}

function renderError(overlay: HTMLElement, message: string) {
  const modal = overlay.querySelector<HTMLElement>(".supplier-plan-modal");
  if (!modal) return;
  modal.innerHTML = `<header class="supplier-plan-modal-header"><div><p>SUPPLIER PURCHASING</p><h2>Supplier Purchase Plan</h2></div><button type="button" class="supplier-plan-close" aria-label="Close">×</button></header><div class="supplier-plan-error">${escapeHtml(message)}</div>`;
  bindClose(overlay);
}

function coverageOptions(selected: PlanDays) {
  const options: Array<{ value: PlanDays; label: string }> = [
    { value: 15, label: "15 days" },
    { value: 30, label: "1 month (30 days)" },
    { value: 60, label: "2 months (60 days)" },
  ];
  return options.map((option) => `<option value="${option.value}"${option.value === selected ? " selected" : ""}>${option.label}</option>`).join("");
}

function parsePlanDays(value: string): PlanDays {
  if (value === "15") return 15;
  if (value === "60") return 60;
  return 30;
}

function planPeriodLabel(days: PlanDays) {
  if (days === 15) return "15-day";
  if (days === 60) return "60-day";
  return "30-day";
}

function tabButton(value: ViewFilter, label: string, count: number, active: ViewFilter) {
  return `<button type="button" data-filter="${value}" class="${value === active ? "active" : ""}">${label} <span>${count}</span></button>`;
}

function toApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatQty(value: number) {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value);
}

function formatEditable(value: number) {
  return String(roundQty(value));
}

function positiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

function calendarIcon() {
  return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M6 2.5v4M14 2.5v4M3 8h14M6.5 11h2M11.5 11h2M6.5 14h2"/></svg>';
}

function injectStyles() {
  if (document.getElementById("supplier-purchase-plan-styles")) return;
  const style = document.createElement("style");
  style.id = "supplier-purchase-plan-styles";
  style.textContent = `
    .supplier-plan-body-locked{overflow:hidden}
    .supplier-plan-launcher{display:inline-flex;align-items:center;gap:7px}
    .supplier-plan-launcher svg{width:16px;height:16px}
    .supplier-plan-dashboard-link{display:block;width:100%;border:0;background:none;text-align:left;cursor:pointer;font:inherit}
    .supplier-plan-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
    .supplier-plan-modal{display:flex;flex-direction:column;width:min(1180px,100%);max-height:92vh;overflow:hidden;border-radius:18px;background:#f5f7fb;box-shadow:0 28px 80px rgba(15,23,42,.28)}
    .supplier-plan-modal-header{display:flex;flex:0 0 auto;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 24px;border-bottom:1px solid #e2e8f0;background:#fff}
    .supplier-plan-modal-header p{margin:0 0 5px;color:#4f46e5;font-size:11px;font-weight:800;letter-spacing:.09em}
    .supplier-plan-modal-header h2{margin:0;color:#172033;font-size:23px}
    .supplier-plan-modal-header span{display:block;margin-top:6px;color:#64748b;font-size:13px}
    .supplier-plan-close{flex:0 0 auto;width:36px;height:36px;border:0;border-radius:9px;background:#f1f5f9;color:#64748b;cursor:pointer;font-size:24px;line-height:1}
    .supplier-plan-controls{display:grid;flex:0 0 auto;grid-template-columns:minmax(0,1fr) minmax(220px,320px);gap:14px 18px;padding:16px 24px;border-bottom:1px solid #e2e8f0;background:#fff}
    .supplier-plan-controls label>span{display:block;margin-bottom:6px;color:#64748b;font-size:12px;font-weight:700}
    .supplier-plan-controls p{grid-column:1/-1;margin:0;color:#64748b;font-size:11px}
    .supplier-plan-content{display:flex;flex:1 1 auto;min-height:0;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .supplier-plan-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:16px 24px 0;overflow:hidden;border:1px solid #dbe3ef;border-radius:12px;background:#fff}
    .supplier-plan-summary>div{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 17px;border-right:1px solid #e2e8f0}
    .supplier-plan-summary>div:last-child{border-right:0}
    .supplier-plan-summary span{color:#64748b;font-size:12px}
    .supplier-plan-summary strong{color:#172033;font-size:22px}
    .supplier-plan-summary .action strong{color:#b45309}
    .supplier-plan-summary .review strong{color:#7c3aed}
    .supplier-plan-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 24px 0;padding:8px 10px;border:1px solid #dbe3ef;border-radius:11px;background:#fff}
    .supplier-plan-tabs{display:flex;gap:4px}
    .supplier-plan-tabs button{border:0;border-radius:8px;background:transparent;color:#64748b;cursor:pointer;padding:8px 11px;font:inherit;font-size:12px;font-weight:700}
    .supplier-plan-tabs button.active{background:#eef2ff;color:#4338ca}
    .supplier-plan-tabs span{margin-left:4px;opacity:.7}
    .supplier-plan-toolbar>label{display:flex;align-items:center;gap:7px;color:#64748b;font-size:12px}
    .supplier-plan-note{margin:12px 24px 0;padding:10px 12px;border:1px solid #ddd6fe;border-radius:9px;background:#f5f3ff;color:#5b21b6;font-size:12px}
    .supplier-plan-table-wrap{flex:0 0 auto;margin:12px 24px;overflow:auto;border:1px solid #dbe3ef;border-radius:12px;background:#fff;-webkit-overflow-scrolling:touch}
    .supplier-plan-table{width:100%;min-width:930px;border-collapse:collapse}
    .supplier-plan-table th{position:sticky;top:0;z-index:1;padding:11px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:10px;letter-spacing:.05em;text-align:left;text-transform:uppercase}
    .supplier-plan-table td{padding:12px;border-bottom:1px solid #edf1f6;color:#172033;font-size:12px;vertical-align:middle}
    .supplier-plan-table tr:last-child td{border-bottom:0}
    .supplier-plan-table tr.selected td{background:#fafaff}
    .supplier-plan-table td:nth-child(2) strong{display:block;margin-bottom:3px;font-size:13px}
    .supplier-plan-table td:nth-child(2)>span,.supplier-plan-table small,.supplier-plan-table .muted{color:#64748b;font-size:11px}
    .supplier-plan-table td>em{display:block;margin-top:4px;color:#2563eb;font-size:10px;font-style:normal}
    .supplier-plan-table .projected-low{color:#b45309;font-weight:700}
    .supplier-plan-qty{display:flex;align-items:center;width:125px;overflow:hidden;border:1px solid #cbd5e1;border-radius:8px;background:#fff}
    .supplier-plan-qty input{width:72px;border:0;outline:0;padding:7px 8px;font:inherit;font-size:12px}
    .supplier-plan-qty span{min-width:45px;padding-right:7px;color:#64748b;font-size:10px;text-align:right}
    .supplier-plan-table .status{display:inline-block;margin-top:5px;padding:3px 6px;border-radius:999px;font-size:9px;font-weight:800;font-style:normal}
    .supplier-plan-table .status.buy{background:#fff7ed;color:#c2410c}
    .supplier-plan-table .status.review{background:#f5f3ff;color:#6d28d9}
    .supplier-plan-table .status.enough{background:#ecfdf5;color:#047857}
    .supplier-plan-footer{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:auto;padding:14px 24px;border-top:1px solid #e2e8f0;background:#fff;color:#64748b;font-size:12px;box-shadow:0 -8px 18px rgba(15,23,42,.04)}
    .supplier-plan-footer strong{color:#172033}
    .supplier-plan-loading,.supplier-plan-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:310px;padding:35px;text-align:center}
    .supplier-plan-loading i{width:30px;height:30px;margin-bottom:14px;border:3px solid #dbe3ef;border-top-color:#4f46e5;border-radius:50%;animation:supplierPlanSpin .8s linear infinite}
    .supplier-plan-loading strong,.supplier-plan-empty h3{margin:0 0 6px;color:#172033}
    .supplier-plan-loading small,.supplier-plan-empty p{color:#64748b}
    .supplier-plan-error{margin:24px;padding:16px;border:1px solid #fecaca;border-radius:10px;background:#fef2f2;color:#b91c1c}
    @keyframes supplierPlanSpin{to{transform:rotate(360deg)}}
    @media(max-width:760px){
      .supplier-plan-overlay{align-items:flex-start;padding:8px;overflow:hidden}
      .supplier-plan-modal{width:100%;height:calc(100dvh - 16px);max-height:none;border-radius:16px}
      .supplier-plan-modal-header{padding:18px 20px}
      .supplier-plan-modal-header h2{font-size:22px}
      .supplier-plan-modal-header span{font-size:12px;line-height:1.45}
      .supplier-plan-controls{grid-template-columns:1fr;padding:14px 20px}
      .supplier-plan-controls p{grid-column:auto}
      .supplier-plan-summary{grid-template-columns:repeat(2,minmax(0,1fr));margin:14px 20px 0}
      .supplier-plan-summary>div:nth-child(2){border-right:0}
      .supplier-plan-summary>div:nth-child(-n+2){border-bottom:1px solid #e2e8f0}
      .supplier-plan-toolbar{align-items:stretch;flex-direction:column;margin:12px 20px 0}
      .supplier-plan-tabs{overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}
      .supplier-plan-note{margin:12px 20px 0}
      .supplier-plan-table-wrap{margin:12px 20px}
      .supplier-plan-footer{align-items:stretch;flex-direction:column;padding:12px 20px calc(12px + env(safe-area-inset-bottom))}
      .supplier-plan-footer .btn{width:100%}
    }
  `;
  document.head.appendChild(style);
}
