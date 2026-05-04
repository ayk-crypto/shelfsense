import nodemailer from "nodemailer";
import { logger } from "../lib/logger.js";

const isDev = process.env.NODE_ENV !== "production";

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  return null;
}

const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "ShelfSense";
const FROM_ADDRESS = process.env.EMAIL_FROM ?? "no-reply@shelfsense.app";
const APP_URL = process.env.APP_URL ?? "http://localhost:5000";

async function dispatchMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  devMeta?: Record<string, unknown>;
}): Promise<void> {
  if (isDev) {
    logger.info(`[EMAIL:DEV] ${opts.subject}`, { to: opts.to, ...opts.devMeta });
    return;
  }

  const transporter = buildTransporter();
  if (!transporter) {
    logger.warn("[EMAIL] SMTP not configured — email not sent", {
      to: opts.to,
      subject: opts.subject,
    });
    return;
  }

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

/* ── Auth emails ─────────────────────────────────────────────────────── */

export async function sendPasswordResetEmail(
  to: string,
  rawToken: string,
): Promise<void> {
  const link = `${APP_URL}/reset-password?token=${rawToken}`;
  await dispatchMail({
    to,
    subject: "Reset your ShelfSense password",
    text: [
      "You requested a password reset for your ShelfSense account.",
      "",
      "Click the link below to reset your password. This link expires in 60 minutes.",
      "",
      link,
      "",
      "If you did not request this, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <p>You requested a password reset for your ShelfSense account.</p>
      <p>Click the button below to reset your password. This link expires in <strong>60 minutes</strong>.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a></p>
      <p>Or copy this link: <code>${link}</code></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `,
    devMeta: { link },
  });
}

export async function sendEmailVerificationEmail(
  to: string,
  rawToken: string,
): Promise<void> {
  const link = `${APP_URL}/verify-email?token=${rawToken}`;
  await dispatchMail({
    to,
    subject: "Verify your ShelfSense email address",
    text: [
      "Welcome to ShelfSense! Please verify your email address.",
      "",
      link,
      "",
      "This link expires in 24 hours.",
    ].join("\n"),
    html: `
      <p>Welcome to ShelfSense! Please verify your email address to get started.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></p>
      <p>Or copy this link: <code>${link}</code></p>
      <p>This link expires in <strong>24 hours</strong>.</p>
    `,
    devMeta: { link },
  });
}

/* ── Inventory alert emails ───────────────────────────────────────────── */

export interface AlertEmailPayload {
  ownerEmail: string;
  workspaceName: string;
  lowStock: Array<{ itemName: string; unit: string; quantity: number; minStockLevel: number }>;
  expiringSoon: Array<{ itemName: string; batchNo: string | null; expiryDate: Date | null }>;
  expired: Array<{ itemName: string; batchNo: string | null; expiryDate: Date | null }>;
}

const VIEW_ALERTS_BTN = `<p style="margin-top:20px"><a href="${APP_URL}/alerts" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View alerts</a></p>`;

function buildLowStockSection(items: AlertEmailPayload["lowStock"]) {
  const text =
    `LOW STOCK (${items.length}):\n` +
    items.map((i) => `  • ${i.itemName}: ${i.quantity} ${i.unit} (min ${i.minStockLevel})`).join("\n");
  const html =
    `<h3 style="color:#ef4444;margin:16px 0 8px">Low Stock (${items.length})</h3>` +
    `<ul style="margin:0;padding-left:20px">` +
    items.map((i) => `<li>${i.itemName}: <strong>${i.quantity} ${i.unit}</strong> (min ${i.minStockLevel})</li>`).join("") +
    `</ul>`;
  return { text, html };
}

function buildExpiringSoonSection(batches: AlertEmailPayload["expiringSoon"]) {
  const text =
    `EXPIRING SOON (${batches.length}):\n` +
    batches
      .map(
        (b) =>
          `  • ${b.itemName}${b.batchNo ? ` [${b.batchNo}]` : ""} — expires ${b.expiryDate?.toISOString().slice(0, 10) ?? "unknown"}`,
      )
      .join("\n");
  const html =
    `<h3 style="color:#f59e0b;margin:16px 0 8px">Expiring Soon (${batches.length})</h3>` +
    `<ul style="margin:0;padding-left:20px">` +
    batches
      .map(
        (b) =>
          `<li>${b.itemName}${b.batchNo ? ` [${b.batchNo}]` : ""} — expires <strong>${b.expiryDate?.toISOString().slice(0, 10) ?? "unknown"}</strong></li>`,
      )
      .join("") +
    `</ul>`;
  return { text, html };
}

function buildExpiredSection(batches: AlertEmailPayload["expired"]) {
  const text =
    `EXPIRED STOCK (${batches.length}):\n` +
    batches
      .map(
        (b) =>
          `  • ${b.itemName}${b.batchNo ? ` [${b.batchNo}]` : ""} — expired ${b.expiryDate?.toISOString().slice(0, 10) ?? "unknown"}`,
      )
      .join("\n");
  const html =
    `<h3 style="color:#6b7280;margin:16px 0 8px">Expired Stock (${batches.length})</h3>` +
    `<ul style="margin:0;padding-left:20px">` +
    batches
      .map(
        (b) =>
          `<li>${b.itemName}${b.batchNo ? ` [${b.batchNo}]` : ""} — expired <strong>${b.expiryDate?.toISOString().slice(0, 10) ?? "unknown"}</strong></li>`,
      )
      .join("") +
    `</ul>`;
  return { text, html };
}

export async function sendLowStockAlertEmail(
  payload: Pick<AlertEmailPayload, "ownerEmail" | "workspaceName" | "lowStock">,
): Promise<void> {
  const { ownerEmail, workspaceName, lowStock } = payload;
  if (lowStock.length === 0) return;

  const s = buildLowStockSection(lowStock);
  await dispatchMail({
    to: ownerEmail,
    subject: `Low Stock Alert — ${workspaceName}`,
    text: [
      `Low stock alert for ${workspaceName}:`,
      "",
      s.text,
      "",
      `View your inventory at ${APP_URL}/alerts`,
    ].join("\n"),
    html: `<p>Low stock alert for <strong>${workspaceName}</strong>:</p>${s.html}${VIEW_ALERTS_BTN}`,
    devMeta: { workspaceName, count: lowStock.length },
  });
}

export async function sendExpirySoonAlertEmail(
  payload: Pick<AlertEmailPayload, "ownerEmail" | "workspaceName" | "expiringSoon" | "expired">,
): Promise<void> {
  const { ownerEmail, workspaceName, expiringSoon, expired } = payload;
  if (expiringSoon.length === 0 && expired.length === 0) return;

  const textParts: string[] = [];
  const htmlParts: string[] = [];

  if (expiringSoon.length > 0) {
    const s = buildExpiringSoonSection(expiringSoon);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }
  if (expired.length > 0) {
    const s = buildExpiredSection(expired);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }

  await dispatchMail({
    to: ownerEmail,
    subject: `Expiring Items Alert — ${workspaceName}`,
    text: [
      `Expiry alert for ${workspaceName}:`,
      "",
      textParts.join("\n\n"),
      "",
      `View your inventory at ${APP_URL}/alerts`,
    ].join("\n"),
    html: `<p>Expiry alert for <strong>${workspaceName}</strong>:</p>${htmlParts.join("")}${VIEW_ALERTS_BTN}`,
    devMeta: { workspaceName, expiringSoon: expiringSoon.length, expired: expired.length },
  });
}

export async function sendDailyDigestEmail(payload: AlertEmailPayload): Promise<void> {
  const { ownerEmail, workspaceName, lowStock, expiringSoon, expired } = payload;
  if (lowStock.length === 0 && expiringSoon.length === 0 && expired.length === 0) return;

  const textParts: string[] = [];
  const htmlParts: string[] = [];

  if (lowStock.length > 0) {
    const s = buildLowStockSection(lowStock);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }
  if (expiringSoon.length > 0) {
    const s = buildExpiringSoonSection(expiringSoon);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }
  if (expired.length > 0) {
    const s = buildExpiredSection(expired);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }

  await dispatchMail({
    to: ownerEmail,
    subject: `Daily Inventory Summary — ${workspaceName}`,
    text: [
      `Daily inventory summary for ${workspaceName}:`,
      "",
      textParts.join("\n\n"),
      "",
      `View your inventory at ${APP_URL}/alerts`,
    ].join("\n"),
    html: `<p>Daily inventory summary for <strong>${workspaceName}</strong>:</p>${htmlParts.join("")}${VIEW_ALERTS_BTN}`,
    devMeta: { workspaceName, sections: textParts.length },
  });
}

export async function sendAlertDigestEmail(payload: AlertEmailPayload): Promise<void> {
  const { ownerEmail, workspaceName, lowStock, expiringSoon, expired } = payload;

  const textParts: string[] = [];
  const htmlParts: string[] = [];

  if (lowStock.length > 0) {
    const s = buildLowStockSection(lowStock);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }
  if (expiringSoon.length > 0) {
    const s = buildExpiringSoonSection(expiringSoon);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }
  if (expired.length > 0) {
    const s = buildExpiredSection(expired);
    textParts.push(s.text);
    htmlParts.push(s.html);
  }

  if (textParts.length === 0) return;

  const subject = `[${workspaceName}] Inventory alert — ${textParts.length} issue${textParts.length > 1 ? "s" : ""} detected`;
  await dispatchMail({
    to: ownerEmail,
    subject,
    text: [
      `Inventory alert summary for ${workspaceName}:`,
      "",
      textParts.join("\n\n"),
      "",
      `View your alerts at ${APP_URL}/alerts`,
    ].join("\n"),
    html: `<p>Inventory alert summary for <strong>${workspaceName}</strong>:</p>${htmlParts.join("")}${VIEW_ALERTS_BTN}`,
    devMeta: {
      lowStock: lowStock.length,
      expiringSoon: expiringSoon.length,
      expired: expired.length,
    },
  });
}
