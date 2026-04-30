const CURRENCY = "PKR";

const CURRENCY_FORMAT = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return CURRENCY_FORMAT.format(value);
}
