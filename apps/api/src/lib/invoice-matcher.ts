export interface MatchCandidate {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit?: string | null;
  supplierItemCode?: string | null;
}

export interface AliasEntry {
  invoiceItemName: string;
  normalizedInvoiceItemName: string;
  inventoryItemId: string;
  confidenceBoost: number;
}

export interface MatchResult {
  itemId: string;
  confidenceScore: number;
  matchStatus: "MATCHED" | "NEEDS_REVIEW" | "EXTRA_INVOICE_ITEM" | "UNMATCHED";
  matchReason: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((t) => t.length > 1));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function tokenOverlapScore(invoiceName: string, itemName: string): number {
  const a = tokenSet(invoiceName);
  const b = tokenSet(itemName);
  const jaccard = jaccardSimilarity(a, b);
  const invTokens = [...a];
  const matchCount = invTokens.filter((t) => b.has(t)).length;
  const coverage = a.size > 0 ? matchCount / a.size : 0;
  return Math.max(jaccard, coverage * 0.85);
}

export function findBestMatch(
  invoiceDescription: string,
  candidates: MatchCandidate[],
  aliases: AliasEntry[],
  poItemIds?: Set<string>,
): MatchResult | null {
  if (candidates.length === 0) return null;

  const normDesc = normalize(invoiceDescription);

  let bestId = "";
  let bestScore = 0;
  let bestReason = "no_match";

  for (const candidate of candidates) {
    let score = 0;
    let reason = "";

    const alias = aliases.find(
      (a) => a.inventoryItemId === candidate.id && normalize(a.normalizedInvoiceItemName) === normDesc,
    );
    if (alias) {
      score = Math.min(1.0, 0.85 + alias.confidenceBoost);
      reason = "supplier_alias";
    }

    if (!alias) {
      if (candidate.sku && normalize(candidate.sku) === normDesc) {
        score = 1.0; reason = "exact_sku";
      } else if (candidate.barcode && normalize(candidate.barcode) === normDesc) {
        score = 1.0; reason = "exact_barcode";
      } else if (candidate.supplierItemCode && normalize(candidate.supplierItemCode) === normDesc) {
        score = 0.95; reason = "supplier_item_code";
      } else {
        const nameSim = tokenOverlapScore(invoiceDescription, candidate.name);
        score = nameSim;
        reason = nameSim > 0.8 ? "high_name_match" : nameSim > 0.6 ? "medium_name_match" : "low_name_match";

        if (candidate.sku && invoiceDescription.toLowerCase().includes(normalize(candidate.sku))) {
          score = Math.min(1.0, score + 0.15);
          reason = "sku_in_description";
        }
        if (candidate.barcode && invoiceDescription.toLowerCase().includes(normalize(candidate.barcode))) {
          score = Math.min(1.0, score + 0.15);
          reason = "barcode_in_description";
        }
        if (poItemIds && poItemIds.has(candidate.id)) {
          score = Math.min(1.0, score + 0.1);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
      bestReason = reason;
    }
  }

  if (!bestId || bestScore < 0.25) return null;

  const matchStatus: MatchResult["matchStatus"] =
    bestScore >= 0.9 ? "MATCHED"
    : bestScore >= 0.7 ? "NEEDS_REVIEW"
    : "UNMATCHED";

  return {
    itemId: bestId,
    confidenceScore: Math.round(bestScore * 100) / 100,
    matchStatus,
    matchReason: bestReason,
  };
}
