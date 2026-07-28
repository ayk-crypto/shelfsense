import {
  allowsFractionalQuantity,
  quantityInputStep,
  quantityRuleText,
  roundUpToAllowedQuantity,
  validateQuantityForUnit,
} from "./quantityRules";

let installed = false;
let scheduled = false;

export function installQuantityInputRules() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceQuantityInputs();
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("change", handleQuantityChange, true);
  document.addEventListener("focusin", rememberValidValue, true);
  schedule();
}

function enhanceQuantityInputs() {
  enhanceSupplierPlannerInputs();
  enhanceItemUnitHints();
}

function enhanceSupplierPlannerInputs() {
  for (const wrapper of document.querySelectorAll<HTMLElement>(".supplier-plan-qty")) {
    const input = wrapper.querySelector<HTMLInputElement>('input[type="number"]');
    const unit = wrapper.querySelector<HTMLElement>("span")?.textContent?.trim() ?? "";
    if (!input || !unit) continue;

    const allowCustom = readPlannerCustomFractionFlag(input);
    input.dataset.quantityRuleUnit = unit;
    input.dataset.quantityRuleAllowCustom = String(allowCustom);
    input.step = quantityInputStep(unit, allowCustom);
    input.inputMode = allowsFractionalQuantity(unit, allowCustom) ? "decimal" : "numeric";

    const value = Number(input.value);
    if (!Number.isFinite(value)) continue;

    if (!input.dataset.quantityRuleInitialized) {
      input.dataset.quantityRuleInitialized = "1";
      if (!allowsFractionalQuantity(unit, allowCustom) && validateQuantityForUnit(value, unit, allowCustom)) {
        const rounded = roundUpToAllowedQuantity(value, unit, allowCustom);
        setNativeInputValue(input, String(rounded));
        input.dataset.lastValidQuantity = String(rounded);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        input.dataset.lastValidQuantity = input.value;
      }
    }
  }
}

function enhanceItemUnitHints() {
  const modal = findItemModal();
  if (!modal) return;

  const stockUnit = readFieldValue(modal, "Stock Unit");
  const purchaseUnit = readFieldValue(modal, "Purchase Unit");
  const conversionInput = findFieldInput(modal, "How many stock units in one purchase unit");

  if (conversionInput && stockUnit) {
    conversionInput.step = quantityInputStep(stockUnit, true);
    conversionInput.inputMode = allowsFractionalQuantity(stockUnit, true) ? "decimal" : "numeric";
    conversionInput.dataset.quantityRuleUnit = stockUnit;
    conversionInput.dataset.quantityRuleAllowCustom = "true";
  }

  const purchaseGroup = findLabel(modal, "Purchase Unit")?.closest<HTMLElement>(".form-group");
  if (purchaseGroup && purchaseUnit) {
    let helper = purchaseGroup.querySelector<HTMLElement>(".quantity-rule-helper");
    if (!helper) {
      helper = document.createElement("p");
      helper.className = "form-helper quantity-rule-helper";
      purchaseGroup.appendChild(helper);
    }
    helper.textContent = quantityRuleText(purchaseUnit, true);
  }
}

function rememberValidValue(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input || input.type !== "number" || !input.dataset.quantityRuleUnit) return;
  input.dataset.lastValidQuantity = input.value;
}

function handleQuantityChange(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input || input.type !== "number") return;

  const unit = input.dataset.quantityRuleUnit;
  if (!unit || input.value.trim() === "") return;
  const value = Number(input.value);
  const allowCustom = input.dataset.quantityRuleAllowCustom !== "false";
  const error = validateQuantityForUnit(value, unit, allowCustom);
  if (!error) {
    input.dataset.lastValidQuantity = input.value;
    return;
  }

  event.stopImmediatePropagation();
  event.preventDefault();
  const previous = input.dataset.lastValidQuantity ?? "0";
  setNativeInputValue(input, previous);
  window.alert(error);
}

function readPlannerCustomFractionFlag(input: HTMLInputElement) {
  const row = input.closest<HTMLTableRowElement>("tr");
  const status = row?.querySelector<HTMLElement>(".status")?.textContent ?? "";
  // Known continuous and whole units are handled automatically. Unknown units
  // retain the item's existing configuration, represented by the input step.
  return input.step !== "1" || status.length >= 0;
}

function findItemModal() {
  for (const title of document.querySelectorAll<HTMLElement>(".modal-title")) {
    if (title.textContent?.trim() !== "Add Item" && title.textContent?.trim() !== "Edit Item") continue;
    return title.closest<HTMLElement>(".modal, [role='dialog']");
  }
  return null;
}

function normalizeLabelText(value: string) {
  return value.replace(/\*/g, "").replace(/[?:]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findLabel(root: ParentNode, labelText: string) {
  const target = normalizeLabelText(labelText);
  return Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((label) => {
    const normalized = normalizeLabelText(label.textContent ?? "");
    return normalized === target || normalized.startsWith(`${target} `) || normalized.startsWith(`${target} (`);
  }) ?? null;
}

function findFieldInput(root: ParentNode, labelText: string) {
  return findLabel(root, labelText)
    ?.closest<HTMLElement>(".form-group")
    ?.querySelector<HTMLInputElement>('input[type="number"]') ?? null;
}

function readFieldValue(root: ParentNode, labelText: string) {
  const field = findLabel(root, labelText)
    ?.closest<HTMLElement>(".form-group")
    ?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  return field?.value?.trim() ?? "";
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
