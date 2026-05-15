import { useRef, useState } from "react";
import type { InvoiceUpload, InvoiceUploadFull } from "../types";
import { uploadInvoice, extractInvoice } from "../api/receiving";

interface Props {
  purchaseOrderId: string;
  ocrAvailable: boolean;
  onExtracted: (upload: InvoiceUploadFull) => void;
  onUploaded?: (upload: InvoiceUpload) => void;
}

const STATUS_LABELS: Record<string, string> = {
  NOT_UPLOADED: "Not uploaded",
  UPLOADED: "Uploaded",
  PROCESSING: "Extracting…",
  EXTRACTED: "Extracted",
  NEEDS_REVIEW: "Needs review",
  FAILED: "Failed",
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function InvoiceUploadCard({ purchaseOrderId, ocrAvailable, onExtracted, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [upload, setUpload] = useState<InvoiceUpload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > 15 * 1024 * 1024) {
      setError("File too large. Maximum size is 15 MB.");
      return;
    }
    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setError("Invalid file type. Please upload a PDF, JPG, or PNG.");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadInvoice(file, purchaseOrderId);
      setUpload(res.invoiceUpload);
      onUploaded?.(res.invoiceUpload);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleExtract() {
    if (!upload) return;
    setError(null);
    setExtracting(true);
    try {
      const res = await extractInvoice(upload.id);
      setUpload(res.invoiceUpload);
      onExtracted(res.invoiceUpload);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? "Extraction failed. Please enter invoice lines manually.");
    } finally {
      setExtracting(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  const status = upload?.ocrStatus ?? null;
  const isProcessing = extracting || status === "PROCESSING";
  const isExtracted = status === "EXTRACTED" || status === "NEEDS_REVIEW";

  return (
    <div className="srm-upload-card">
      <div className="srm-upload-card-header">
        <svg className="srm-upload-card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
        </svg>
        <span className="srm-upload-card-title">Smart Invoice Matching</span>
        <span className="srm-upload-card-badge">Premium</span>
      </div>

      {!upload ? (
        <div
          className={`srm-dropzone${dragging ? " srm-dropzone--active" : ""}${uploading ? " srm-dropzone--loading" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleChange} style={{ display: "none" }} />
          {uploading ? (
            <div className="srm-dropzone-uploading">
              <div className="srm-spinner" />
              <span>Uploading…</span>
            </div>
          ) : (
            <>
              <svg className="srm-dropzone-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <p className="srm-dropzone-text">Drop invoice here or <span className="srm-dropzone-link">browse</span></p>
              <p className="srm-dropzone-hint">PDF, JPG, or PNG — max 15 MB</p>
            </>
          )}
        </div>
      ) : (
        <div className="srm-upload-file">
          <div className="srm-upload-file-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span className="srm-upload-filename">{upload.fileName}</span>
            <span className="srm-upload-filesize">{formatBytes(upload.fileSize)}</span>
            <span className={`srm-status-badge srm-status-badge--${(upload.ocrStatus ?? "uploaded").toLowerCase()}`}>
              {STATUS_LABELS[upload.ocrStatus] ?? upload.ocrStatus}
            </span>
          </div>
          {!isExtracted && !isProcessing && (
            <button type="button" className="srm-upload-change-btn" onClick={() => { setUpload(null); setError(null); }}>
              Change file
            </button>
          )}
        </div>
      )}

      {error && <div className="srm-upload-error">{error}</div>}

      {upload?.duplicateWarning && (
        <div className="srm-duplicate-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>Duplicate invoice detected — an invoice with this number has been received before.</span>
        </div>
      )}

      {isExtracted && upload && (
        <div className="srm-invoice-header">
          {upload.invoiceNumber && (
            <div className="srm-invoice-header-item">
              <span className="srm-invoice-header-label">Invoice #</span>
              <span className="srm-invoice-header-value">{upload.invoiceNumber}</span>
            </div>
          )}
          {upload.invoiceDate && (
            <div className="srm-invoice-header-item">
              <span className="srm-invoice-header-label">Date</span>
              <span className="srm-invoice-header-value">{new Date(upload.invoiceDate).toLocaleDateString()}</span>
            </div>
          )}
          {upload.supplierName && (
            <div className="srm-invoice-header-item">
              <span className="srm-invoice-header-label">Supplier</span>
              <span className="srm-invoice-header-value">{upload.supplierName}</span>
            </div>
          )}
          {upload.invoiceTotalInclTax != null && (
            <div className="srm-invoice-header-item">
              <span className="srm-invoice-header-label">Invoice Total</span>
              <span className="srm-invoice-header-value srm-invoice-header-value--bold">{upload.invoiceTotalInclTax.toFixed(2)}</span>
            </div>
          )}
          {upload.taxMode && (
            <div className="srm-invoice-header-item">
              <span className="srm-invoice-header-label">Tax Mode</span>
              <span className="srm-invoice-header-value srm-taxmode-badge">{upload.taxMode.replace(/_/g, " ")}</span>
            </div>
          )}
        </div>
      )}

      {upload && !isExtracted && (
        <div className="srm-extract-section">
          {ocrAvailable ? (
            <button
              type="button"
              className="btn btn--primary srm-extract-btn"
              onClick={() => void handleExtract()}
              disabled={isProcessing || uploading}
            >
              {isProcessing ? (
                <>
                  <div className="srm-spinner srm-spinner--sm" />
                  Extracting with AI…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  Extract with AI
                </>
              )}
            </button>
          ) : (
            <div className="srm-ocr-unavailable">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              AI extraction not configured — invoice uploaded, add lines manually below.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
