export function StockCountPage() {
  return (
    <div className="stock-count-page">
      <section className="stock-count-empty">
        <div className="stock-count-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3h8l2 3v15H6V6l2-3z" />
            <path d="M9 11h6" />
            <path d="M9 15h6" />
            <path d="M9 7h6" />
          </svg>
        </div>
        <div className="stock-count-copy">
          <span className="daily-ops-kicker">Stock Count</span>
          <h1 className="page-title">Stock Count workflow coming next</h1>
          <p className="page-subtitle">
            This will become the guided physical count workflow for checking actual shelf stock against ShelfSense.
          </p>
        </div>

        <ol className="stock-count-steps" aria-label="Intended stock count workflow">
          <li>
            <strong>Choose a branch and count list</strong>
            <span>Select all items, a category, or a focused low-stock/expiry count.</span>
          </li>
          <li>
            <strong>Scan or enter counted quantities</strong>
            <span>Staff record actual shelf counts with barcode support and quick quantity inputs.</span>
          </li>
          <li>
            <strong>Review variances</strong>
            <span>Managers compare counted stock with system stock before applying adjustments.</span>
          </li>
          <li>
            <strong>Post approved adjustments</strong>
            <span>ShelfSense creates auditable stock movements for every approved difference.</span>
          </li>
        </ol>
      </section>
    </div>
  );
}
