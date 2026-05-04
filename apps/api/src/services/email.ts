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

export async function sendPasswordResetEmail(
  to: string,
  rawToken: string,
): Promise<void> {
  const link = `${APP_URL}/reset-password?token=${rawToken}`;

  if (isDev) {
    logger.info("[EMAIL:DEV] Password reset link (SMTP not configured)", {
      to,
      link,
    });
    return;
  }

  const transporter = buildTransporter();
  if (!transporter) {
    logger.warn("[EMAIL] SMTP not configured — password reset email not sent", { to });
    return;
  }

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
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
  });
}

export async function sendEmailVerificationEmail(
  to: string,
  rawToken: string,
): Promise<void> {
  const link = `${APP_URL}/verify-email?token=${rawToken}`;

  if (isDev) {
    logger.info("[EMAIL:DEV] Email verification link (SMTP not configured)", {
      to,
      link,
    });
    return;
  }

  const transporter = buildTransporter();
  if (!transporter) {
    logger.warn("[EMAIL] SMTP not configured — verification email not sent", { to });
    return;
  }

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
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
  });
}
