import * as XLSX from "xlsx";
import { getItems, updateItem } from "../api/items";
import { getStockMovements, getStockSummary } from "../api/stock";
import type { Item, StockMovement, StockSummaryItem } from "../types";

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 60;
const MIN_OBSERVATION_DAYS = 7;
const MODAL_ID = "inventory-planning-manager-modal";
const ITEMS_BUTTON_ID = "inventory-planning-manager-button";
const REORDER_BUTTON_ID = "inventory-monthly-plan-button";

type PlanningRow = {
  item: Item;
  summary: StockSummaryItem | null;
  factor: number;
  displayUnit: string;
  currentBuyingQty: number;
  incomingBuyingQty: number;
  usage60BaseQty: number;
  observedDays: number;
  monthlyUsageBuyingQty: number | null;
  originalLowAlertBuyingQty: number;
  lowAlertBuyingQty: number;
  originalTargetBuyingQty: number;
  targetBuyingQty: number;
  suggestedTargetBuyingQty: number | null;
  suggestedOrderBuyingQty: number;
  suggestionConfirmed: boolean;
  importTouched: boolean;
};

type ImportRecord = Record<string, unknown>;

let installed = false;
let injectionScheduled = false;

export function installInventoryPlanningManager() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  injectStyles();

  const schedule = () => {
    if (injectionScheduled) return;
    injectionScheduled = true;
    queueMicrotask(() => {
      injectionScheduled = false;
      injectPlanningButtons();
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", schedule);
  schedule();
}

function injectPlanningButtons() {
  const path = window.location.pathname;
  if (path.endsWith("/items")) injectItemsButton();
  if (path.endsWith("/reorder-suggestions")) injectReorderButton();
}

function injectItemsButton() {
  if (document.getElementById(ITEMS_BUTTON_ID)) return;
  const importButton = findButtonByText("Import Items");
  const addButton = findButtonByText("Add Item");
  const anchor = importButton ?? addButton;
  if (!anchor?.parentElement) return;

  const button = buildLauncherButton(ITEMS_BUTTON_ID, "Excel Setup");
  anchor.parentElement.insertBefore(button, anchor);
}

function injectReorderButton() {
  if (document.getElementById(REORDER_BUTTON_ID)) return;
  const exportButton = findButtonByText("Export Excel");
  const createButton = findButtonByText("Create Draft");
  const anchor = exportButton ?? createButton;
  if (!anchor?.parentElement) return;

  const button = buildLauncherButton(REORDER_BUTTON_ID, "Monthly Plan");
  anchor.parentElement.insertBefore(button, anchor);
}

function buildLauncherButton(id: string, label: string) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = "btn btn--ghost inventory-plan-launcher";
  button.innerHTML = `${excelIcon()}<span>${label}</span>`;
  button.addEventListener("click", () => { void openPlanningManager(); });
  return button;
}

function findButtonByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim().toLowerCase() === text.toLowerCase(),
  ) ?? null;
}

async function openPlanningManager() {
  if (document.getElementById(MODAL_ID)) return;
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "inventory-plan-overlay";
  overlay.innerHTML = `
    <section class="inventory-plan-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-plan-title">
      <header class="inventory-plan-header">
        <div>
          <p class="inventory-plan-eyebrow">PURCHASING SETUP</p>
          <h2 id="inventory-plan-title">Low Stock & Monthly Planning</h2>
          <p>Review 60-day usage, confirm suggested restock targets, and update many items together.</p>
        </div>
        <button type="button" class="inventory-plan-close" aria-label="Close">×</button>
      </header>
      <div class="inventory-plan-loading">
        <span class="inventory-plan-spinner"></span>
        <strong>Preparing your inventory plan…</strong>
        <small>Loading items, stock and 60-day usage history.</small>
      </div>
    </section>`;

  document.body.appendChild(overlay);
  document.body.classList.add("inventory-plan-body-locked");
  const close = () => closePlanningManager(overlay);
  overlay.querySelector(".inventory-plan-close")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", function escapeHandler(event) {
    if (event.key !== "Escape" || !overlay.isConnected) return;
    document.removeEventListener("keydown", escapeHandler);
    close();
  });

  try {
    const rows = await loadPlanningRows();
    renderPlanningManager(overlay, rows);
  } catch (error) {
    renderLoadError(overlay, error instanceof Error ? error.message : "Unable to load inventory planning data.");
  }
}

function closePlanningManager(overlay: HTMLElement) {
  overlay.remove();
  document.body.classList.remove("inventory-plan-body-locked");
}

async function loadPlanningRows(): Promise<PlanningRow[]> {
  const now = new Date();
  const from = new Date(now.getTime() - (HISTORY_DAYS - 1) * DAY_MS);
  const [itemsResponse, summaryResponse, movementsResponse] = await Promise.all([
    getItems(false),
    getStockSummary(),
    getStockMovements({
      type: "STOCK_OUT",
      fromDate: formatApiDate(from),
      toDate: formatApiDate(now),
    }),
  ]);

  const summaryMap = new Map(summaryResponse.summary.map((summary) => [summary.itemId, summary]));
  const usageMap = buildUsageMap(movementsResponse.movements, now);

  return itemsResponse.items
    .filter((item) => item.isActive)
    .map((item) => buildPlanningRow(item, summaryMap.get(item.id) ?? null, usageMap.get(item.id)))
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

function buildUsageMap(movements: StockMovement[], now: Date) {
  const map = new Map<string, { total: number; earliest: number }>();
  for (const movement of movements) {
    const itemId = movement.item.id;
    const created = new Date(movement.createdAt).getTime();
    const current = map.get(itemId);
    map.set(itemId, {
      total: (current?.total ?? 0) + Math.abs(movement.quantity),
      earliest: Math.min(current?.earliest ?? created, created),
    });
  }

  const result = new Map<string, { total: number; observedDays: number }>();
  for (const [itemId, usage] of map) {
    const elapsed = Math.floor((now.getTime() - usage.earliest) / DAY_MS) + 1;
    result.set(itemId, {
      total: roundQty(usage.total),
      observedDays: Math.max(MIN_OBSERVATION_DAYS, Math.min(HISTORY_DAYS, elapsed)),
    });
  }
  return result;
}

function buildPlanningRow(
  item: Item,
  summary: StockSummaryItem | null,
  usage: { total: number; observedDays: number } | undefined,
): PlanningRow {
  const usesPurchaseUnit = Boolean(
    item.purchaseUnit?.trim() &&
    item.purchaseUnit.trim().toLowerCase() !== item.unit.trim().toLowerCase() &&
    item.purchaseConversionFactor &&
    item.purchaseConversionFactor > 0,
  );
  const factor = usesPurchaseUnit ? item.purchaseConversionFactor! : 1;
  const displayUnit = usesPurchaseUnit ? item.purchaseUnit!.trim() : item.unit.trim();
  const currentBase = summary?.totalQuantity ?? 0;
  const incomingBase = summary?.replenishment?.incomingBaseQty ?? 0;
  const usage60BaseQty = usage?.total ?? 0;
  const observedDays = usage?.observedDays ?? 0;
  const monthlyUsageBuyingQty = observedDays > 0
    ? roundQty((usage60BaseQty / observedDays) * 30 / factor)
    : null;
  const lowAlertBuyingQty = roundQty(item.minStockLevel / factor);
  const targetBase = item.manualTargetStockBaseQty ?? item.minStockLevel;
  const targetBuyingQty = roundQty(targetBase / factor);
  const suggestedTargetBuyingQty = monthlyUsageBuyingQty === null
    ? null
    : roundSuggestedTarget(item, lowAlertBuyingQty + monthlyUsageBuyingQty, usesPurchaseUnit);
  const effectiveTarget = targetBuyingQty;
  const stockPosition = (currentBase + incomingBase) / factor;
  const suggestedOrderBuyingQty = stockPosition <= lowAlertBuyingQty
    ? roundOrderQty(item, Math.max(0, effectiveTarget - stockPosition), usesPurchaseUnit)
    : 0;

  return {
    item,
    summary,
    factor,
    displayUnit,
    currentBuyingQty: roundQty(currentBase / factor),
    incomingBuyingQty: roundQty(incomingBase / factor),
    usage60BaseQty,
    observedDays,
    monthlyUsageBuyingQty,
    originalLowAlertBuyingQty: lowAlertBuyingQty,
    lowAlertBuyingQty,
    originalTargetBuyingQty: targetBuyingQty,
    targetBuyingQty,
    suggestedTargetBuyingQty,
    suggestedOrderBuyingQty,
    suggestionConfirmed: false,
    importTouched: false,
  };
}

function roundSuggestedTarget(item: Item, value: number, usesPurchaseUnit: boolean) {
  if (usesPurchaseUnit && !item.allowFractionalPurchaseUnit) return Math.ceil(value);
  return roundQty(value);
}

function roundOrderQty(item: Item, value: number, usesPurchaseUnit: boolean) {
  if (usesPurchaseUnit && !item.allowFractionalPurchaseUnit) return Math.ceil(value);
  return roundQty(value);
}

function renderPlanningManager(overlay: HTMLElement, rows: PlanningRow[]) {
  const modal = overlay.querySelector<HTMLElement>(".inventory-plan-modal");
  if (!modal) return;

  modal.innerHTML = `
    <header class="inventory-plan-header">
      <div>
        <p class="inventory-plan-eyebrow">PURCHASING SETUP</p>
        <h2 id="inventory-plan-title">Low Stock & Monthly Planning</h2>
        <p>The low-stock alert is the reorder trigger. The restock target is the level ShelfSense refills toward.</p>
      </div>
      <button type="button" class="inventory-plan-close" aria-label="Close">×</button>
    </header>
    <div class="inventory-plan-toolbar">
      <div class="inventory-plan-toolbar-main">
        <button type="button" class="btn btn--ghost" data-action="export">${excelIcon()} Export Excel</button>
        <button type="button" class="btn btn--ghost" data-action="import">${uploadIcon()} Import Excel</button>
        <input type="file" accept=".xlsx,.xls,.csv" data-role="file-input" hidden />
        <button type="button" class="btn btn--ghost" data-action="confirm-all">Confirm all suggestions</button>
      </div>
      <div class="inventory-plan-search-wrap">
        <input type="search" class="form-input inventory-plan-search" placeholder="Search items…" aria-label="Search planning items" />
      </div>
    </div>
    <div class="inventory-plan-explainer">
      <div><strong>Low Stock Alert</strong><span>When available stock reaches this quantity, the item becomes eligible for reorder.</span></div>
      <div><strong>Suggested Restock Target</strong><span>Low-stock buffer + estimated 30-day usage. It is not saved until you confirm it.</span></div>
      <div><strong>Order Suggestion</strong><span>Target minus current stock minus incoming purchase orders.</span></div>
    </div>
    <div class="inventory-plan-status" aria-live="polite"></div>
    <div class="inventory-plan-table-wrap">
      <table class="inventory-plan-table">
        <thead><tr>
          <th>Item</th>
          <th>Current</th>
          <th>60-day usage</th>
          <th>Monthly usage</th>
          <th>Low-stock alert</th>
          <th>Suggested target</th>
          <th>Restock target</th>
          <th>Order now</th>
        </tr></thead>
        <tbody>${rows.map(renderRow).join("")}</tbody>
      </table>
    </div>
    <footer class="inventory-plan-footer">
      <div>
        <strong data-role="change-count">No changes yet</strong>
        <span>Suggestions remain optional until confirmed.</span>
      </div>
      <div class="inventory-plan-footer-actions">
        <button type="button" class="btn btn--ghost" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn--primary" data-action="apply" disabled>Apply changes</button>
      </div>
    </footer>`;

  const close = () => closePlanningManager(overlay);
  modal.querySelector(".inventory-plan-close")?.addEventListener("click", close);
  modal.querySelector('[data-action="cancel"]')?.addEventListener("click", close);

  const search = modal.querySelector<HTMLInputElement>(".inventory-plan-search");
  search?.addEventListener("input", () => filterRows(modal, search.value));

  modal.querySelector('[data-action="export"]')?.addEventListener("click", () => exportPlanningWorkbook(rows));
  const fileInput = modal.querySelector<HTMLInputElement>('[data-role="file-input"]');
  modal.querySelector('[data-action="import"]')?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void importPlanningWorkbook(file, rows, modal);
    fileInput.value = "";
  });

  modal.querySelector('[data-action="confirm-all"]')?.addEventListener("click", () => {
    let confirmed = 0;
    for (const row of rows) {
      if (row.suggestedTargetBuyingQty === null) continue;
      row.targetBuyingQty = row.suggestedTargetBuyingQty;
      row.suggestionConfirmed = true;
      confirmed += 1;
      syncRowControls(modal, row);
    }
    updateChangeState(modal, rows);
    setStatus(modal, `Confirmed ${confirmed} monthly target suggestion${confirmed === 1 ? "" : "s"}. Review and apply when ready.`, "success");
  });

  modal.querySelectorAll<HTMLInputElement>('input[data-role="low-alert"]').forEach((input) => {
    input.addEventListener("input", () => {
      const row = rows.find((candidate) => candidate.item.id === input.dataset.itemId);
      if (!row) return;
      row.lowAlertBuyingQty = parseNonNegative(input.value, row.lowAlertBuyingQty);
      row.suggestedTargetBuyingQty = row.monthlyUsageBuyingQty === null
        ? null
        : roundSuggestedTarget(row.item, row.lowAlertBuyingQty + row.monthlyUsageBuyingQty, row.factor !== 1);
      row.suggestionConfirmed = false;
      recalculateOrderSuggestion(row);
      syncRowControls(modal, row);
      updateChangeState(modal, rows);
    });
  });

  modal.querySelectorAll<HTMLInputElement>('input[data-role="target"]').forEach((input) => {
    input.addEventListener("input", () => {
      const row = rows.find((candidate) => candidate.item.id === input.dataset.itemId);
      if (!row) return;
      row.targetBuyingQty = parseNonNegative(input.value, row.targetBuyingQty);
      row.suggestionConfirmed = row.suggestedTargetBuyingQty !== null && approximatelyEqual(row.targetBuyingQty, row.suggestedTargetBuyingQty);
      recalculateOrderSuggestion(row);
      syncRowControls(modal, row);
      updateChangeState(modal, rows);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>('button[data-action="confirm-row"]').forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows.find((candidate) => candidate.item.id === button.dataset.itemId);
      if (!row || row.suggestedTargetBuyingQty === null) return;
      row.targetBuyingQty = row.suggestedTargetBuyingQty;
      row.suggestionConfirmed = true;
      recalculateOrderSuggestion(row);
      syncRowControls(modal, row);
      updateChangeState(modal, rows);
    });
  });

  modal.querySelector<HTMLButtonElement>('[data-action="apply"]')?.addEventListener("click", () => {
    void applyPlanningChanges(modal, rows, overlay);
  });

  updateChangeState(modal, rows);
}

function renderRow(row: PlanningRow) {
  const noUsage = row.monthlyUsageBuyingQty === null;
  const suggestion = row.suggestedTargetBuyingQty === null ? "—" : formatQty(row.suggestedTargetBuyingQty);
  const orderNow = row.suggestedOrderBuyingQty > 0
    ? `<strong class="inventory-plan-order-positive">${formatQty(row.suggestedOrderBuyingQty)} ${escapeHtml(row.displayUnit)}</strong>`
    : `<span class="inventory-plan-order-zero">0 ${escapeHtml(row.displayUnit)}</span>`;
  const incoming = row.incomingBuyingQty > 0
    ? `<small>${formatQty(row.incomingBuyingQty)} incoming</small>`
    : "";
  return `
    <tr data-row-id="${escapeHtml(row.item.id)}" data-search="${escapeHtml(`${row.item.name} ${row.item.category ?? ""} ${row.item.sku ?? ""}`.toLowerCase())}">
      <td class="inventory-plan-item-cell">
        <strong>${escapeHtml(row.item.name)}</strong>
        <span>${escapeHtml(row.item.category ?? "Uncategorized")}</span>
        <small>1 ${escapeHtml(row.displayUnit)}${row.factor !== 1 ? ` = ${formatQty(row.factor)} ${escapeHtml(row.item.unit)}` : ""}</small>
      </td>
      <td><strong>${formatQty(row.currentBuyingQty)} ${escapeHtml(row.displayUnit)}</strong>${incoming}</td>
      <td>${row.observedDays > 0 ? `${formatQty(row.usage60BaseQty / row.factor)} ${escapeHtml(row.displayUnit)}<small>${row.observedDays} observed days</small>` : "—<small>No usage recorded</small>"}</td>
      <td>${noUsage ? "—<small>Needs stock-out history</small>" : `<strong>${formatQty(row.monthlyUsageBuyingQty!)} ${escapeHtml(row.displayUnit)}</strong><small>30-day estimate</small>`}</td>
      <td><div class="inventory-plan-input-unit"><input class="form-input" type="number" min="0" step="any" data-role="low-alert" data-item-id="${escapeHtml(row.item.id)}" value="${formatInput(row.lowAlertBuyingQty)}"/><span>${escapeHtml(row.displayUnit)}</span></div></td>
      <td><div class="inventory-plan-suggestion"><strong data-role="suggestion-value">${suggestion} ${row.suggestedTargetBuyingQty === null ? "" : escapeHtml(row.displayUnit)}</strong><button type="button" class="inventory-plan-confirm" data-action="confirm-row" data-item-id="${escapeHtml(row.item.id)}" ${row.suggestedTargetBuyingQty === null ? "disabled" : ""}>Confirm</button></div></td>
      <td><div class="inventory-plan-input-unit"><input class="form-input" type="number" min="0" step="any" data-role="target" data-item-id="${escapeHtml(row.item.id)}" value="${formatInput(row.targetBuyingQty)}"/><span>${escapeHtml(row.displayUnit)}</span></div><small data-role="confirmed-label"></small></td>
      <td data-role="order-value">${orderNow}</td>
    </tr>`;
}

function recalculateOrderSuggestion(row: PlanningRow) {
  const stockPosition = row.currentBuyingQty + row.incomingBuyingQty;
  row.suggestedOrderBuyingQty = stockPosition <= row.lowAlertBuyingQty
    ? roundOrderQty(row.item, Math.max(0, row.targetBuyingQty - stockPosition), row.factor !== 1)
    : 0;
}

function syncRowControls(modal: HTMLElement, row: PlanningRow) {
  const tableRow = modal.querySelector<HTMLElement>(`tr[data-row-id="${cssEscape(row.item.id)}"]`);
  if (!tableRow) return;
  const lowInput = tableRow.querySelector<HTMLInputElement>('input[data-role="low-alert"]');
  const targetInput = tableRow.querySelector<HTMLInputElement>('input[data-role="target"]');
  if (lowInput && document.activeElement !== lowInput) lowInput.value = formatInput(row.lowAlertBuyingQty);
  if (targetInput && document.activeElement !== targetInput) targetInput.value = formatInput(row.targetBuyingQty);
  tableRow.classList.toggle("inventory-plan-row-changed", rowChanged(row));
  tableRow.classList.toggle("inventory-plan-row-imported", row.importTouched);

  const suggestionValue = tableRow.querySelector<HTMLElement>('[data-role="suggestion-value"]');
  if (suggestionValue) suggestionValue.textContent = row.suggestedTargetBuyingQty === null
    ? "—"
    : `${formatQty(row.suggestedTargetBuyingQty)} ${row.displayUnit}`;
  const confirmed = tableRow.querySelector<HTMLElement>('[data-role="confirmed-label"]');
  if (confirmed) confirmed.textContent = row.suggestionConfirmed ? "✓ Monthly suggestion confirmed" : "";
  const order = tableRow.querySelector<HTMLElement>('[data-role="order-value"]');
  if (order) order.innerHTML = row.suggestedOrderBuyingQty > 0
    ? `<strong class="inventory-plan-order-positive">${formatQty(row.suggestedOrderBuyingQty)} ${escapeHtml(row.displayUnit)}</strong>`
    : `<span class="inventory-plan-order-zero">0 ${escapeHtml(row.displayUnit)}</span>`;
}

function updateChangeState(modal: HTMLElement, rows: PlanningRow[]) {
  const changes = rows.filter(rowChanged);
  const count = modal.querySelector<HTMLElement>('[data-role="change-count"]');
  if (count) count.textContent = changes.length === 0
    ? "No changes yet"
    : `${changes.length} item${changes.length === 1 ? "" : "s"} ready to update`;
  const apply = modal.querySelector<HTMLButtonElement>('[data-action="apply"]');
  if (apply) apply.disabled = changes.length === 0;
  for (const row of rows) syncRowControls(modal, row);
}

function rowChanged(row: PlanningRow) {
  return !approximatelyEqual(row.lowAlertBuyingQty, row.originalLowAlertBuyingQty) ||
    !approximatelyEqual(row.targetBuyingQty, row.originalTargetBuyingQty);
}

async function applyPlanningChanges(modal: HTMLElement, rows: PlanningRow[], overlay: HTMLElement) {
  const changed = rows.filter(rowChanged);
  if (changed.length === 0) return;
  const invalid = changed.find((row) => row.targetBuyingQty < row.lowAlertBuyingQty);
  if (invalid) {
    setStatus(modal, `${invalid.item.name}: restock target cannot be below its low-stock alert.`, "error");
    return;
  }

  const confirmedSuggestions = changed.filter((row) => row.suggestionConfirmed).length;
  const confirmation = window.confirm(
    `Apply planning settings to ${changed.length} item${changed.length === 1 ? "" : "s"}?\n\n` +
    `${confirmedSuggestions} monthly suggestion${confirmedSuggestions === 1 ? "" : "s"} confirmed.\n` +
    "This changes reorder triggers and restock targets, but it does not change current stock.",
  );
  if (!confirmation) return;

  const button = modal.querySelector<HTMLButtonElement>('[data-action="apply"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Applying…";
  }
  setStatus(modal, `Updating 0 of ${changed.length} items…`, "neutral");

  let updated = 0;
  const failures: string[] = [];
  for (const row of changed) {
    try {
      await updateItem(row.item.id, {
        minStockLevel: roundQty(row.lowAlertBuyingQty * row.factor),
        manualReorderPointBaseQty: null,
        manualTargetStockBaseQty: roundQty(row.targetBuyingQty * row.factor),
        replenishmentMode: "MANUAL_THRESHOLD",
      });
      updated += 1;
      setStatus(modal, `Updating ${updated} of ${changed.length} items…`, "neutral");
    } catch (error) {
      failures.push(`${row.item.name}: ${error instanceof Error ? error.message : "Update failed"}`);
    }
  }

  if (failures.length > 0) {
    setStatus(modal, `${updated} updated; ${failures.length} failed. ${failures.slice(0, 2).join(" | ")}`, "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Retry changes";
    }
    return;
  }

  setStatus(modal, `${updated} item${updated === 1 ? "" : "s"} updated successfully. Reorder Suggestions will now use the confirmed targets.`, "success");
  if (button) button.textContent = "Applied";
  window.setTimeout(() => {
    closePlanningManager(overlay);
    window.location.reload();
  }, 1100);
}

function exportPlanningWorkbook(rows: PlanningRow[]) {
  const data = rows.map((row) => ({
    "Item ID": row.item.id,
    "Item Name": row.item.name,
    Category: row.item.category ?? "",
    SKU: row.item.sku ?? "",
    Barcode: row.item.barcode ?? "",
    "Stock Unit": row.item.unit,
    "Purchase Unit": row.displayUnit,
    "Units per Purchase Unit": row.factor,
    "Current Stock (Purchase Unit)": row.currentBuyingQty,
    "Incoming PO (Purchase Unit)": row.incomingBuyingQty,
    "Usage Last 60 Days (Purchase Unit)": roundQty(row.usage60BaseQty / row.factor),
    "Observed Usage Days": row.observedDays || "",
    "Estimated Monthly Usage (Purchase Unit)": row.monthlyUsageBuyingQty ?? "",
    "Low Stock Alert (Purchase Unit)": row.lowAlertBuyingQty,
    "Suggested Restock Target (Purchase Unit)": row.suggestedTargetBuyingQty ?? "",
    "Restock Target (Purchase Unit)": row.targetBuyingQty,
    "Apply Suggested Target (YES/NO)": "NO",
    "Track Expiry (YES/NO)": row.item.trackExpiry ? "YES" : "NO",
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet["!cols"] = [
    { wch: 38 }, { wch: 28 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
    { wch: 16 }, { wch: 23 }, { wch: 29 }, { wch: 27 }, { wch: 36 }, { wch: 21 },
    { wch: 43 }, { wch: 37 }, { wch: 45 }, { wch: 38 }, { wch: 35 }, { wch: 24 },
  ];
  if (worksheet["!ref"]) worksheet["!autofilter"] = { ref: worksheet["!ref"] };

  const instructions = XLSX.utils.aoa_to_sheet([
    ["ShelfSense Low Stock & Monthly Planning"],
    ["Purpose", "Update low-stock alerts and restock targets in bulk."],
    ["Important", "Import this workbook using Excel Setup > Import Excel, not the standard Import Items button."],
    ["Low Stock Alert", "The trigger quantity. Reorder becomes eligible when current stock plus incoming PO reaches or falls below it."],
    ["Restock Target", "The level ShelfSense refills toward after the trigger is reached."],
    ["Suggested Restock Target", "Low-stock alert plus estimated 30-day usage from up to 60 days of history."],
    ["Apply Suggested Target", "Change NO to YES to copy the suggested target during import. You will still see a preview and final confirmation."],
    ["Blank cells", "Blank editable cells are treated as no change."],
    ["Current stock", "Read-only reference. Importing this workbook never changes stock quantities."],
  ]);
  instructions["!cols"] = [{ wch: 28 }, { wch: 110 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Items Planning");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  XLSX.writeFile(workbook, `shelfsense-items-planning-${formatApiDate(new Date())}.xlsx`);
}

async function importPlanningWorkbook(file: File, rows: PlanningRow[], modal: HTMLElement) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("planning")) ?? workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook does not contain a worksheet.");
    const records = XLSX.utils.sheet_to_json<ImportRecord>(workbook.Sheets[sheetName], { defval: "" });
    const rowById = new Map(rows.map((row) => [row.item.id, row]));
    const rowByName = new Map(rows.map((row) => [row.item.name.trim().toLowerCase(), row]));
    let matched = 0;
    let changed = 0;
    const skipped: string[] = [];

    for (const record of records) {
      const normalized = normalizeRecord(record);
      const id = textValue(normalized.get("itemid"));
      const name = textValue(normalized.get("itemname"));
      const row = (id ? rowById.get(id) : undefined) ?? (name ? rowByName.get(name.toLowerCase()) : undefined);
      if (!row) {
        if (name || id) skipped.push(name || id);
        continue;
      }
      matched += 1;
      let touched = false;
      const low = optionalNumber(normalized.get("lowstockalertpurchaseunit"));
      if (low !== null) {
        row.lowAlertBuyingQty = low;
        touched = true;
      }
      const target = optionalNumber(normalized.get("restocktargetpurchaseunit"));
      if (target !== null) {
        row.targetBuyingQty = target;
        row.suggestionConfirmed = row.suggestedTargetBuyingQty !== null && approximatelyEqual(target, row.suggestedTargetBuyingQty);
        touched = true;
      }
      const applySuggested = yesValue(normalized.get("applysuggestedtargetyesno"));
      if (applySuggested && row.suggestedTargetBuyingQty !== null) {
        row.targetBuyingQty = row.suggestedTargetBuyingQty;
        row.suggestionConfirmed = true;
        touched = true;
      }
      if (touched) {
        row.importTouched = true;
        recalculateOrderSuggestion(row);
        changed += rowChanged(row) ? 1 : 0;
        syncRowControls(modal, row);
      }
    }

    updateChangeState(modal, rows);
    const skippedText = skipped.length > 0 ? ` ${skipped.length} unmatched row${skipped.length === 1 ? " was" : "s were"} skipped.` : "";
    setStatus(modal, `Imported ${matched} matching item${matched === 1 ? "" : "s"}; ${changed} change${changed === 1 ? " is" : "s are"} ready for review.${skippedText}`, skipped.length > 0 ? "neutral" : "success");
  } catch (error) {
    setStatus(modal, error instanceof Error ? error.message : "Unable to read the Excel file.", "error");
  }
}

function normalizeRecord(record: ImportRecord) {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) map.set(normalizeHeader(key), value);
  return map;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function optionalNumber(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function yesValue(value: unknown) {
  return ["yes", "y", "true", "1", "confirm", "confirmed"].includes(textValue(value).toLowerCase());
}

function filterRows(modal: HTMLElement, query: string) {
  const normalized = query.trim().toLowerCase();
  modal.querySelectorAll<HTMLElement>("tr[data-search]").forEach((row) => {
    row.hidden = Boolean(normalized && !row.dataset.search?.includes(normalized));
  });
}

function setStatus(modal: HTMLElement, message: string, tone: "success" | "error" | "neutral") {
  const status = modal.querySelector<HTMLElement>(".inventory-plan-status");
  if (!status) return;
  status.textContent = message;
  status.className = `inventory-plan-status inventory-plan-status--${tone}`;
}

function renderLoadError(overlay: HTMLElement, message: string) {
  const modal = overlay.querySelector<HTMLElement>(".inventory-plan-modal");
  if (!modal) return;
  modal.innerHTML = `
    <header class="inventory-plan-header"><div><h2>Unable to open planning setup</h2></div><button type="button" class="inventory-plan-close" aria-label="Close">×</button></header>
    <div class="inventory-plan-load-error"><strong>Something went wrong</strong><p>${escapeHtml(message)}</p><button type="button" class="btn btn--primary">Close</button></div>`;
  modal.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => closePlanningManager(overlay)));
}

function parseNonNegative(value: string, fallback: number) {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function approximatelyEqual(a: number, b: number) {
  return Math.abs(a - b) < 0.000001;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("en-SA", { maximumFractionDigits: 2 }).format(value);
}

function formatInput(value: number) {
  return String(roundQty(value));
}

function formatApiDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, "\\$1");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function excelIcon() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 2.75h8l4 4V17.25H4z"/><path d="M12 2.75v4h4M7 10l4 4m0-4-4 4"/></svg>`;
}

function uploadIcon() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M3.5 12.5v3.75h13v-3.75"/></svg>`;
}

function injectStyles() {
  if (document.getElementById("inventory-planning-manager-styles")) return;
  const style = document.createElement("style");
  style.id = "inventory-planning-manager-styles";
  style.textContent = `
    .inventory-plan-launcher { display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
    .inventory-plan-launcher svg, .inventory-plan-toolbar button svg { width:17px; height:17px; }
    .inventory-plan-body-locked { overflow:hidden !important; }
    .inventory-plan-overlay { position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,.58); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:22px; }
    .inventory-plan-modal { width:min(1500px, 97vw); height:min(880px, 94vh); background:#fff; border-radius:18px; box-shadow:0 28px 80px rgba(15,23,42,.28); display:flex; flex-direction:column; overflow:hidden; color:#172033; }
    .inventory-plan-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:22px 26px 18px; border-bottom:1px solid #e7ecf4; }
    .inventory-plan-header h2 { margin:2px 0 5px; font-size:23px; line-height:1.2; }
    .inventory-plan-header p { margin:0; color:#64748b; font-size:13px; }
    .inventory-plan-eyebrow { color:#5b5cf6 !important; font-size:11px !important; font-weight:800; letter-spacing:.08em; }
    .inventory-plan-close { border:0; background:#f1f5f9; color:#64748b; width:34px; height:34px; border-radius:9px; font-size:24px; line-height:30px; cursor:pointer; }
    .inventory-plan-toolbar { padding:13px 20px; border-bottom:1px solid #e7ecf4; display:flex; align-items:center; justify-content:space-between; gap:12px; background:#fbfcff; }
    .inventory-plan-toolbar-main { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .inventory-plan-toolbar button { display:inline-flex; align-items:center; gap:7px; }
    .inventory-plan-search-wrap { width:min(300px, 100%); }
    .inventory-plan-search { height:38px !important; }
    .inventory-plan-explainer { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; padding:12px 20px; background:#f7f8ff; border-bottom:1px solid #e7ecf4; }
    .inventory-plan-explainer div { background:#fff; border:1px solid #e2e7f1; border-radius:10px; padding:10px 12px; }
    .inventory-plan-explainer strong { display:block; font-size:12px; margin-bottom:3px; }
    .inventory-plan-explainer span { display:block; color:#64748b; font-size:11.5px; line-height:1.4; }
    .inventory-plan-status { min-height:0; padding:0 20px; font-size:12px; transition:.2s; }
    .inventory-plan-status:not(:empty) { padding-top:9px; padding-bottom:9px; border-bottom:1px solid #e7ecf4; }
    .inventory-plan-status--success { background:#ecfdf5; color:#047857; }
    .inventory-plan-status--error { background:#fff1f2; color:#be123c; }
    .inventory-plan-status--neutral { background:#eff6ff; color:#1d4ed8; }
    .inventory-plan-table-wrap { flex:1; overflow:auto; }
    .inventory-plan-table { width:100%; border-collapse:separate; border-spacing:0; min-width:1260px; font-size:12.5px; }
    .inventory-plan-table th { position:sticky; top:0; z-index:2; background:#f5f7fb; color:#64748b; text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.055em; padding:11px 12px; border-bottom:1px solid #dfe5ef; }
    .inventory-plan-table td { padding:12px; border-bottom:1px solid #edf0f5; vertical-align:middle; }
    .inventory-plan-table tr:hover td { background:#fafbff; }
    .inventory-plan-table tr.inventory-plan-row-changed td { background:#fffbeb; }
    .inventory-plan-table tr.inventory-plan-row-imported td:first-child { box-shadow:inset 3px 0 #6366f1; }
    .inventory-plan-item-cell { min-width:220px; }
    .inventory-plan-item-cell strong, .inventory-plan-table td > strong { display:block; font-size:13px; }
    .inventory-plan-item-cell span, .inventory-plan-table small { display:block; color:#7b879d; margin-top:3px; font-size:10.5px; }
    .inventory-plan-input-unit { display:flex; align-items:center; min-width:145px; }
    .inventory-plan-input-unit input { min-width:82px; height:37px; border-radius:8px 0 0 8px !important; }
    .inventory-plan-input-unit span { height:37px; display:flex; align-items:center; padding:0 9px; background:#f1f5f9; border:1px solid #d8e0eb; border-left:0; border-radius:0 8px 8px 0; color:#64748b; max-width:80px; overflow:hidden; text-overflow:ellipsis; }
    .inventory-plan-suggestion { display:flex; align-items:center; gap:8px; min-width:160px; }
    .inventory-plan-confirm { border:1px solid #c7d2fe; color:#4f46e5; background:#eef2ff; border-radius:7px; padding:5px 8px; font-size:11px; font-weight:700; cursor:pointer; }
    .inventory-plan-confirm:disabled { opacity:.45; cursor:not-allowed; }
    .inventory-plan-order-positive { color:#b45309; }
    .inventory-plan-order-zero { color:#64748b; }
    .inventory-plan-footer { padding:14px 20px; border-top:1px solid #e1e7f0; display:flex; justify-content:space-between; align-items:center; gap:20px; background:#fff; }
    .inventory-plan-footer > div:first-child strong { display:block; font-size:13px; }
    .inventory-plan-footer > div:first-child span { display:block; color:#7b879d; font-size:11px; margin-top:2px; }
    .inventory-plan-footer-actions { display:flex; gap:9px; }
    .inventory-plan-loading, .inventory-plan-load-error { flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; color:#64748b; padding:40px; }
    .inventory-plan-loading strong, .inventory-plan-load-error strong { color:#172033; margin-top:14px; }
    .inventory-plan-loading small { margin-top:5px; }
    .inventory-plan-spinner { width:34px; height:34px; border:3px solid #e0e7ff; border-top-color:#5b5cf6; border-radius:50%; animation:inventoryPlanSpin .75s linear infinite; }
    @keyframes inventoryPlanSpin { to { transform:rotate(360deg); } }
    @media (max-width:900px) {
      .inventory-plan-overlay { padding:0; }
      .inventory-plan-modal { width:100vw; height:100vh; max-height:none; border-radius:0; }
      .inventory-plan-toolbar { align-items:stretch; flex-direction:column; }
      .inventory-plan-search-wrap { width:100%; }
      .inventory-plan-explainer { grid-template-columns:1fr; }
      .inventory-plan-footer { align-items:stretch; flex-direction:column; }
      .inventory-plan-footer-actions { justify-content:flex-end; }
    }
  `;
  document.head.appendChild(style);
}
