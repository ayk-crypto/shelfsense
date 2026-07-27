type ItemPayloadWithLowStock = {
  name?: string;
  minStockLevel?: number;
};

let activeLowStockInput: HTMLInputElement | null = null;
let enhancementInstalled = false;
let enhancementScheduled = false;

/**
 * Installs usability improvements for the Add/Edit Item forms.
 *
 * The API stores minStockLevel in the stock/base unit. The form presents
 * that threshold in the purchase unit whenever a valid purchase conversion
 * exists, then transformItemLowStockForSave converts it back before saving.
 */
export function installItemFormUsabilityEnhancements() {
  if (enhancementInstalled || typeof document === "undefined") return;
  enhancementInstalled = true;

  injectStyles();

  const scheduleEnhancement = () => {
    if (enhancementScheduled) return;
    enhancementScheduled = true;
    queueMicrotask(() => {
      enhancementScheduled = false;
      enhanceOpenItemForm();
    });
  };

  // Observe only structural changes. Watching text mutations caused a feedback
  // loop because the enhancement itself updates labels and helper text.
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  document.addEventListener("change", scheduleEnhancement, true);
  scheduleEnhancement();
}

/**
 * Converts the low-stock value shown in the purchase unit back to the
 * stock/base unit expected by the API. Calls made outside an Add/Edit Item
 * modal (bulk update, import, etc.) remain unchanged.
 */
export function transformItemLowStockForSave<T extends ItemPayloadWithLowStock>(payload: T): T {
  if (
    !activeLowStockInput ||
    !activeLowStockInput.isConnected ||
    typeof payload.minStockLevel !== "number" ||
    !Number.isFinite(payload.minStockLevel)
  ) {
    return payload;
  }

  const form = activeLowStockInput.closest("form");
  const modal = form?.closest<HTMLElement>(".modal, [role='dialog']") ?? null;
  const itemName = readFieldValue(modal, "Item Name");
  if (!modal || (payload.name && itemName && payload.name.trim() !== itemName.trim())) {
    return payload;
  }

  const factor = readPositiveNumber(activeLowStockInput.dataset.lowStockDisplayFactor) ?? 1;
  return {
    ...payload,
    minStockLevel: roundQuantity(payload.minStockLevel * factor),
  };
}

function enhanceOpenItemForm() {
  const modal = findOpenItemModal();
  if (!modal) {
    activeLowStockInput = null;
    return;
  }

  const title = modal.querySelector<HTMLElement>(".modal-title")?.textContent?.trim() ?? "";
  const isEdit = title === "Edit Item";
  const isAdd = title === "Add Item";
  if (!isEdit && !isAdd) {
    activeLowStockInput = null;
    return;
  }

  modal.classList.add("item-form--simplified");

  if (isEdit) hideUnusedReorderSections(modal);
  updateMoreSettingsDescription(modal);
  enhanceLowStockField(modal);
}

function enhanceLowStockField(modal: HTMLElement) {
  const lowStockLabel = findLabel(modal, "Low Stock Alert");
  const group = lowStockLabel?.closest<HTMLElement>(".form-group");
  const input = group?.querySelector<HTMLInputElement>("input[type='number']");
  if (!lowStockLabel || !group || !input) return;

  const stockUnit = readFieldValue(modal, "Stock Unit") || "stock unit";
  const purchaseUnit = readFieldValue(modal, "Purchase Unit");
  const conversionFactor = readNumberField(modal, "How many stock units in one purchase unit");
  const usesPurchaseUnit = Boolean(purchaseUnit && conversionFactor && conversionFactor > 0);
  const nextFactor = usesPurchaseUnit ? conversionFactor! : 1;
  const displayUnit = usesPurchaseUnit ? purchaseUnit : stockUnit;
  const previousFactor = readPositiveNumber(input.dataset.lowStockDisplayFactor);

  if (previousFactor === null) {
    const currentBaseValue = readFiniteNumber(input.value) ?? 0;
    setControlledInputValue(input, formatEditableNumber(currentBaseValue / nextFactor));
  } else if (Math.abs(previousFactor - nextFactor) > 0.0000001) {
    const currentDisplayValue = readFiniteNumber(input.value) ?? 0;
    const baseValue = currentDisplayValue * previousFactor;
    setControlledInputValue(input, formatEditableNumber(baseValue / nextFactor));
  }

  input.dataset.lowStockDisplayFactor = String(nextFactor);
  input.dataset.lowStockDisplayUnit = displayUnit;
  activeLowStockInput = input;

  const labelText = `Low Stock Alert (${displayUnit})`;
  if (lowStockLabel.textContent !== labelText) {
    lowStockLabel.textContent = labelText;
  }
  input.setAttribute("aria-describedby", "item-low-stock-helper");

  let helper = group.querySelector<HTMLParagraphElement>(".item-low-stock-helper");
  if (!helper) {
    helper = document.createElement("p");
    helper.className = "form-helper item-low-stock-helper";
    helper.id = "item-low-stock-helper";
    group.appendChild(helper);
  }

  const helperText = usesPurchaseUnit
    ? `Alert when stock reaches this purchase quantity. 1 ${purchaseUnit} = ${formatEditableNumber(nextFactor)} ${stockUnit}.`
    : `Alert when stock reaches this quantity. This item is purchased and tracked in ${stockUnit}.`;
  if (helper.textContent !== helperText) {
    helper.textContent = helperText;
  }
}

function hideUnusedReorderSections(modal: HTMLElement) {
  const hiddenTitles = new Set(["reorder settings", "replenishment"]);
  const titleCandidates = modal.querySelectorAll<HTMLElement>(
    ".item-units-section__title, .settings-section-title, .section-title, h3, h4, strong",
  );

  for (const title of titleCandidates) {
    const normalized = title.textContent?.trim().toLowerCase() ?? "";
    if (!hiddenTitles.has(normalized)) continue;
    const section = findSectionContainer(title);
    if (section && !section.hidden) {
      section.hidden = true;
      section.setAttribute("aria-hidden", "true");
    }
  }
}

function findSectionContainer(title: HTMLElement) {
  const direct = title.closest<HTMLElement>(
    ".item-units-section, .replenishment-settings, .settings-section, .form-section",
  );
  if (direct) return direct;

  const details = title.closest("details");
  let current = title.parentElement;
  while (current && current !== details) {
    const hasControls = current.querySelectorAll(".form-group, select, input").length > 0;
    if (hasControls) return current;
    current = current.parentElement;
  }

  return title.parentElement;
}

function updateMoreSettingsDescription(modal: HTMLElement) {
  for (const helper of modal.querySelectorAll<HTMLElement>("details.more-settings > .form-helper")) {
    if (helper.textContent?.toLowerCase().includes("reorder planning")) {
      helper.textContent = "Optional settings for purchase units, SKU, and barcode.";
    }
  }
}

function findOpenItemModal() {
  for (const title of document.querySelectorAll<HTMLElement>(".modal-title")) {
    const text = title.textContent?.trim();
    if (text !== "Add Item" && text !== "Edit Item") continue;
    return title.closest<HTMLElement>(".modal, [role='dialog']");
  }
  return null;
}

function findLabel(root: ParentNode, labelText: string) {
  const normalizedTarget = labelText.trim().toLowerCase();
  return Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((label) => {
    const normalized = label.textContent?.replace(/\*/g, "").trim().toLowerCase() ?? "";
    return normalized === normalizedTarget || normalized.startsWith(`${normalizedTarget} `) || normalized.startsWith(`${normalizedTarget} (`);
  }) ?? null;
}

function readFieldValue(root: ParentNode | null, labelText: string) {
  if (!root) return "";
  const label = findLabel(root, labelText);
  const group = label?.closest<HTMLElement>(".form-group");
  const field = group?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  return field?.value?.trim() ?? "";
}

function readNumberField(root: ParentNode, labelText: string) {
  return readPositiveNumber(readFieldValue(root, labelText));
}

function readFiniteNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveNumber(value: string | undefined) {
  const parsed = readFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  if (input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function formatEditableNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return String(roundQuantity(value));
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function injectStyles() {
  if (document.getElementById("item-form-usability-styles")) return;
  const style = document.createElement("style");
  style.id = "item-form-usability-styles";
  style.textContent = `
    .item-form--simplified .item-low-stock-helper {
      margin-top: 7px;
      color: #64748b;
      line-height: 1.45;
    }

    .item-form--simplified [hidden] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}
