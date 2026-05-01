import { Html5Qrcode } from "html5-qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { stockIn, stockOut } from "../api/stock";
import type { Item, StockSummaryItem } from "../types";
import { formatCurrency } from "../utils/currency";

type Phase = "scanning" | "found" | "notFound" | "error";

interface Props {
  items: Item[];
  summaryMap: Map<string, StockSummaryItem>;
  canManageStock: boolean;
  onClose: () => void;
  onCreateNew: (barcode: string) => void;
}

const VIEWPORT_ID = "bs-camera-viewport";

function formatQty(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

export function BarcodeScanner({ items, summaryMap, canManageStock, onClose, onCreateNew }: Props) {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [foundItem, setFoundItem] = useState<Item | null>(null);
  const [scannedCode, setScannedCode] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showFeedback(msg: string, ok: boolean) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ msg, ok });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2800);
  }

  const startCamera = useCallback(async () => {
    if (!scannerRef.current) return;
    setPhase("scanning");
    setCameraError(null);

    try {
      await scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: 260, height: 200 }, aspectRatio: 1.5 },
        (decodedText) => {
          void scannerRef.current?.stop().catch(() => {});
          const match = itemsRef.current.find((i) => i.barcode === decodedText) ?? null;
          setScannedCode(decodedText);
          if (match) {
            setFoundItem(match);
            setPhase("found");
          } else {
            setPhase("notFound");
          }
        },
        () => { /* per-frame decode misses — intentionally ignored */ },
      );

      try {
        await scannerRef.current.applyVideoConstraints({
          advanced: [{ torch: false } as MediaTrackConstraintSet],
        });
        setTorchSupported(true);
      } catch {
        setTorchSupported(false);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.includes("Permission")
            ? "Camera permission denied. Please allow camera access and try again."
            : err.message
          : "Unable to start camera.";
      setCameraError(msg);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const scanner = new Html5Qrcode(VIEWPORT_ID, { verbose: false });
    scannerRef.current = scanner;

    void startCamera();

    return () => {
      void scanner.stop().catch(() => {});
    };
  }, [startCamera]);

  async function toggleTorch() {
    if (!scannerRef.current || !torchSupported) return;
    const next = !torchOn;
    try {
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  async function rescan() {
    setFoundItem(null);
    setScannedCode("");
    setFeedback(null);
    setTorchOn(false);
    await startCamera();
  }

  async function handleAdjust(delta: number) {
    if (!foundItem || adjustBusy) return;
    setAdjustBusy(true);
    try {
      if (delta > 0) {
        if (!canManageStock) {
          showFeedback("You do not have permission to perform this action.", false);
          return;
        }
        await stockIn({ itemId: foundItem.id, quantity: delta, note: "Scanner quick adjust" });
      } else {
        await stockOut({
          itemId: foundItem.id,
          quantity: -delta,
          reason: "manual_adjustment",
          note: "Scanner quick adjust",
        });
      }
      const sign = delta > 0 ? "+" : "";
      showFeedback(`${sign}${delta} ${foundItem.unit} recorded`, true);
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "Action failed", false);
    } finally {
      setAdjustBusy(false);
    }
  }

  const summary = foundItem ? summaryMap.get(foundItem.id) : undefined;

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Barcode Scanner">
      <div className="scanner-shell">
        <div className="scanner-topbar">
          <span className="scanner-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="scanner-title-icon">
              <rect x="3" y="3" width="5" height="5" rx="1" />
              <rect x="16" y="3" width="5" height="5" rx="1" />
              <rect x="3" y="16" width="5" height="5" rx="1" />
              <path d="M16 16h5v5" /><path d="M16 21h5" />
              <path d="M3 12h4" /><path d="M9 3v4" /><path d="M9 9h4" /><path d="M9 12v4" />
              <path d="M12 9h4" /><path d="M12 16h4" />
            </svg>
            Scan Barcode
          </span>
          <div className="scanner-topbar-btns">
            {torchSupported && phase === "scanning" && (
              <button
                className={`scanner-icon-btn ${torchOn ? "scanner-icon-btn--active" : ""}`}
                onClick={() => { void toggleTorch(); }}
                title={torchOn ? "Torch on" : "Torch off"}
                aria-label="Toggle flashlight"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </button>
            )}
            <button
              className="scanner-icon-btn scanner-close-btn"
              onClick={onClose}
              aria-label="Close scanner"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="scanner-viewport-wrap">
          <div
            id={VIEWPORT_ID}
            className={`scanner-viewport ${phase !== "scanning" ? "scanner-viewport--hidden" : ""}`}
          />

          {phase === "scanning" && (
            <div className="scanner-overlay-ui" aria-hidden="true">
              <div className="scanner-frame">
                <span className="scanner-corner scanner-corner--tl" />
                <span className="scanner-corner scanner-corner--tr" />
                <span className="scanner-corner scanner-corner--bl" />
                <span className="scanner-corner scanner-corner--br" />
                <span className="scanner-laser" />
              </div>
              <p className="scanner-hint">Point camera at a barcode</p>
            </div>
          )}

          {phase === "error" && (
            <div className="scanner-result scanner-result--error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="scanner-result-icon">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="scanner-result-title">Camera unavailable</p>
              <p className="scanner-result-body">{cameraError}</p>
              <button className="btn btn--ghost scanner-result-action" onClick={onClose}>
                Close
              </button>
            </div>
          )}

          {phase === "found" && foundItem && (
            <div className="scanner-result scanner-result--found">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="scanner-result-icon scanner-result-icon--ok">
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
              <p className="scanner-found-name">{foundItem.name}</p>
              {summary && (
                <p className="scanner-found-stock">
                  {formatQty(summary.totalQuantity)} {foundItem.unit} in stock
                  {summary.totalValue > 0 && ` · ${formatCurrency(summary.totalValue)}`}
                </p>
              )}
              <p className="scanner-found-code">{scannedCode}</p>

              {feedback && (
                <div className={`scanner-feedback ${feedback.ok ? "scanner-feedback--ok" : "scanner-feedback--err"}`}>
                  {feedback.msg}
                </div>
              )}

              <div className="scanner-quick-actions">
                {canManageStock && (
                  <div className="scanner-quick-group">
                    <span className="scanner-quick-label">Add stock</span>
                    <div className="scanner-quick-row">
                      {[1, 5].map((n) => (
                        <button
                          key={`+${n}`}
                          className="btn btn--quick-in scanner-quick-btn"
                          disabled={adjustBusy}
                          onClick={() => { void handleAdjust(n); }}
                        >+{n}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="scanner-quick-group">
                  <span className="scanner-quick-label">Deduct stock</span>
                  <div className="scanner-quick-row">
                    {[1, 5].map((n) => (
                      <button
                        key={`-${n}`}
                        className="btn btn--quick-out scanner-quick-btn"
                        disabled={adjustBusy}
                        onClick={() => { void handleAdjust(-n); }}
                      >−{n}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="scanner-result-footer">
                <button className="btn btn--ghost btn--sm" onClick={onClose}>
                  Full item details
                </button>
                <button className="btn btn--primary btn--sm" onClick={() => { void rescan(); }}>
                  Scan again
                </button>
              </div>
            </div>
          )}

          {phase === "notFound" && (
            <div className="scanner-result scanner-result--notfound">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="scanner-result-icon scanner-result-icon--warn">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="scanner-result-title">Item not found</p>
              <p className="scanner-found-code">{scannedCode}</p>
              <p className="scanner-result-body">
                No item in your inventory has this barcode.
              </p>
              <div className="scanner-result-footer">
                <button className="btn btn--ghost btn--sm" onClick={() => { void rescan(); }}>
                  Scan again
                </button>
                {canManageStock && (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => { onCreateNew(scannedCode); }}
                  >
                    + Add new item
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
