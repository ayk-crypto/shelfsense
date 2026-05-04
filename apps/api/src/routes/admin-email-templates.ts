import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "../services/email.js";

export const adminEmailTemplatesRouter = Router();

async function logAdminAction(
  adminId: string,
  action: string,
  entity: string,
  entityId: string,
  meta: Record<string, unknown> = {},
) {
  await prisma.adminAuditLog.create({
    data: { adminId, action, entity, entityId, meta: meta as Prisma.InputJsonValue },
  });
}

const TEMPLATE_KEYS = [
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
  "WORKSPACE_INVITATION",
  "WELCOME",
  "TRIAL_STARTED",
  "TRIAL_ENDING_SOON",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_EXPIRING",
  "SUBSCRIPTION_EXPIRED",
  "PAYMENT_RECEIVED",
  "LOW_STOCK_ALERT",
  "EXPIRING_STOCK_ALERT",
] as const;

type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const DEFAULT_TEMPLATES: Record<TemplateKey, { name: string; subject: string; htmlBody: string; textBody: string; variables: string[] }> = {
  EMAIL_VERIFICATION: {
    name: "Email Verification",
    subject: "Verify your ShelfSense email address",
    htmlBody: `<p>Welcome to ShelfSense! Please verify your email address to get started.</p><p><a href="{{verificationLink}}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></p><p>Or copy this link: <code>{{verificationLink}}</code></p><p>This link expires in <strong>24 hours</strong>.</p>`,
    textBody: `Welcome to ShelfSense! Please verify your email address.\n\n{{verificationLink}}\n\nThis link expires in 24 hours.`,
    variables: ["{{verificationLink}}", "{{userName}}", "{{appUrl}}"],
  },
  PASSWORD_RESET: {
    name: "Password Reset",
    subject: "Reset your ShelfSense password",
    htmlBody: `<p>You requested a password reset for your ShelfSense account.</p><p>Click the button below to reset your password. This link expires in <strong>60 minutes</strong>.</p><p><a href="{{resetLink}}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a></p><p>Or copy this link: <code>{{resetLink}}</code></p><p>If you did not request this, you can safely ignore this email.</p>`,
    textBody: `You requested a password reset for your ShelfSense account.\n\nClick the link below to reset your password. This link expires in 60 minutes.\n\n{{resetLink}}\n\nIf you did not request this, you can safely ignore this email.`,
    variables: ["{{resetLink}}", "{{userName}}", "{{appUrl}}"],
  },
  WORKSPACE_INVITATION: {
    name: "Workspace Invitation",
    subject: "You've been invited to {{workspaceName}} on ShelfSense",
    htmlBody: `<p>Hi {{userName}},</p><p>You have been invited to join <strong>{{workspaceName}}</strong> on ShelfSense.</p><p><a href="{{appUrl}}/login" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Accept Invitation</a></p>`,
    textBody: `Hi {{userName}},\n\nYou have been invited to join {{workspaceName}} on ShelfSense.\n\nLog in at: {{appUrl}}/login`,
    variables: ["{{userName}}", "{{workspaceName}}", "{{appUrl}}"],
  },
  WELCOME: {
    name: "Welcome",
    subject: "Welcome to ShelfSense, {{userName}}!",
    htmlBody: `<p>Hi {{userName}},</p><p>Welcome to ShelfSense! Your workspace <strong>{{workspaceName}}</strong> is ready.</p><p><a href="{{appUrl}}/dashboard" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Get started</a></p>`,
    textBody: `Hi {{userName}},\n\nWelcome to ShelfSense! Your workspace {{workspaceName}} is ready.\n\nGet started at: {{appUrl}}/dashboard`,
    variables: ["{{userName}}", "{{workspaceName}}", "{{appUrl}}"],
  },
  TRIAL_STARTED: {
    name: "Trial Started",
    subject: "Your ShelfSense trial has started",
    htmlBody: `<p>Hi {{userName}},</p><p>Your free trial of ShelfSense ({{planName}}) has started.</p><p>Your trial ends on <strong>{{trialEndDate}}</strong>.</p><p><a href="{{appUrl}}/dashboard" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Start using ShelfSense</a></p>`,
    textBody: `Hi {{userName}},\n\nYour free trial of ShelfSense ({{planName}}) has started. Your trial ends on {{trialEndDate}}.\n\n{{appUrl}}/dashboard`,
    variables: ["{{userName}}", "{{planName}}", "{{trialEndDate}}", "{{appUrl}}"],
  },
  TRIAL_ENDING_SOON: {
    name: "Trial Ending Soon",
    subject: "Your ShelfSense trial ends in 3 days",
    htmlBody: `<p>Hi {{userName}},</p><p>Your ShelfSense trial ends on <strong>{{trialEndDate}}</strong>.</p><p>Upgrade now to keep access to all features.</p><p><a href="{{appUrl}}/plan" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Upgrade plan</a></p>`,
    textBody: `Hi {{userName}},\n\nYour ShelfSense trial ends on {{trialEndDate}}. Upgrade now to keep access.\n\n{{appUrl}}/plan`,
    variables: ["{{userName}}", "{{trialEndDate}}", "{{appUrl}}"],
  },
  SUBSCRIPTION_ACTIVATED: {
    name: "Subscription Activated",
    subject: "Your ShelfSense subscription is active",
    htmlBody: `<p>Hi {{userName}},</p><p>Your <strong>{{planName}}</strong> subscription for {{workspaceName}} is now active.</p><p>Thank you for choosing ShelfSense!</p>`,
    textBody: `Hi {{userName}},\n\nYour {{planName}} subscription for {{workspaceName}} is now active. Thank you!`,
    variables: ["{{userName}}", "{{planName}}", "{{workspaceName}}", "{{appUrl}}"],
  },
  SUBSCRIPTION_EXPIRING: {
    name: "Subscription Expiring",
    subject: "Your ShelfSense subscription expires soon",
    htmlBody: `<p>Hi {{userName}},</p><p>Your ShelfSense subscription for <strong>{{workspaceName}}</strong> expires on {{trialEndDate}}.</p><p>Please renew to avoid interruption.</p><p>Contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a> for assistance.</p>`,
    textBody: `Hi {{userName}},\n\nYour ShelfSense subscription expires on {{trialEndDate}}. Please renew to avoid interruption.\n\nContact: {{supportEmail}}`,
    variables: ["{{userName}}", "{{workspaceName}}", "{{trialEndDate}}", "{{supportEmail}}"],
  },
  SUBSCRIPTION_EXPIRED: {
    name: "Subscription Expired",
    subject: "Your ShelfSense subscription has expired",
    htmlBody: `<p>Hi {{userName}},</p><p>Your ShelfSense subscription for <strong>{{workspaceName}}</strong> has expired.</p><p>Contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a> to renew.</p>`,
    textBody: `Hi {{userName}},\n\nYour ShelfSense subscription has expired. Contact {{supportEmail}} to renew.`,
    variables: ["{{userName}}", "{{workspaceName}}", "{{supportEmail}}"],
  },
  PAYMENT_RECEIVED: {
    name: "Payment Received",
    subject: "Payment received — ShelfSense",
    htmlBody: `<p>Hi {{userName}},</p><p>We have received your payment for <strong>{{workspaceName}}</strong>. Thank you!</p>`,
    textBody: `Hi {{userName}},\n\nWe have received your payment for {{workspaceName}}. Thank you!`,
    variables: ["{{userName}}", "{{workspaceName}}"],
  },
  LOW_STOCK_ALERT: {
    name: "Low Stock Alert",
    subject: "Low stock alert — {{workspaceName}}",
    htmlBody: `<p>Low stock alert for <strong>{{workspaceName}}</strong>.</p><p><a href="{{appUrl}}/alerts" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View alerts</a></p>`,
    textBody: `Low stock alert for {{workspaceName}}.\n\nView alerts at: {{appUrl}}/alerts`,
    variables: ["{{workspaceName}}", "{{appUrl}}"],
  },
  EXPIRING_STOCK_ALERT: {
    name: "Expiring Stock Alert",
    subject: "Expiring items alert — {{workspaceName}}",
    htmlBody: `<p>Expiring stock alert for <strong>{{workspaceName}}</strong>.</p><p><a href="{{appUrl}}/alerts" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View alerts</a></p>`,
    textBody: `Expiring stock alert for {{workspaceName}}.\n\nView alerts at: {{appUrl}}/alerts`,
    variables: ["{{workspaceName}}", "{{appUrl}}"],
  },
};

adminEmailTemplatesRouter.get("/", asyncHandler(async (_req, res) => {
  const templates = await prisma.emailTemplate.findMany({
    orderBy: { key: "asc" },
    select: {
      id: true, key: true, name: true, subject: true, enabled: true,
      variables: true, updatedAt: true,
      updatedBy: { select: { id: true, name: true } },
    },
  });

  const keys = templates.map((t) => t.key);
  const missing = TEMPLATE_KEYS.filter((k) => !keys.includes(k));

  const stubs = missing.map((k) => ({
    id: null,
    key: k,
    name: DEFAULT_TEMPLATES[k].name,
    subject: DEFAULT_TEMPLATES[k].subject,
    enabled: true,
    variables: DEFAULT_TEMPLATES[k].variables,
    updatedAt: null,
    updatedBy: null,
    isDefault: true,
  }));

  return res.json({ templates: [...templates.map((t) => ({ ...t, isDefault: false })), ...stubs] });
}));

adminEmailTemplatesRouter.get("/:key", asyncHandler(async (req, res) => {
  const { key } = req.params;
  const upper = key.toUpperCase();

  if (!TEMPLATE_KEYS.includes(upper as TemplateKey)) {
    return res.status(404).json({ error: "Unknown template key" });
  }

  const tpl = await prisma.emailTemplate.findUnique({ where: { key: upper } });

  if (tpl) {
    return res.json({ template: { ...tpl, isDefault: false } });
  }

  const def = DEFAULT_TEMPLATES[upper as TemplateKey];
  return res.json({
    template: {
      id: null, key: upper, name: def.name, subject: def.subject,
      htmlBody: def.htmlBody, textBody: def.textBody, enabled: true,
      variables: def.variables, updatedAt: null, updatedBy: null, isDefault: true,
    },
  });
}));

adminEmailTemplatesRouter.patch("/:key", asyncHandler(async (req, res) => {
  const { key } = req.params;
  const adminId = req.user!.id;
  const upper = key.toUpperCase();

  if (!TEMPLATE_KEYS.includes(upper as TemplateKey)) {
    return res.status(404).json({ error: "Unknown template key" });
  }

  const body = req.body as Partial<{
    name: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    enabled: boolean;
  }>;

  if (body.htmlBody && /<script/i.test(body.htmlBody)) {
    return res.status(400).json({ error: "Script tags are not allowed in HTML templates" });
  }

  const def = DEFAULT_TEMPLATES[upper as TemplateKey];

  const tpl = await prisma.emailTemplate.upsert({
    where: { key: upper },
    create: {
      key: upper,
      name: body.name?.trim() ?? def.name,
      subject: body.subject?.trim() ?? def.subject,
      htmlBody: body.htmlBody ?? def.htmlBody,
      textBody: body.textBody ?? def.textBody,
      enabled: body.enabled ?? true,
      variables: def.variables as unknown as Prisma.InputJsonValue,
      updatedByUserId: adminId,
    },
    update: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.subject !== undefined && { subject: body.subject.trim() }),
      ...(body.htmlBody !== undefined && { htmlBody: body.htmlBody }),
      ...(body.textBody !== undefined && { textBody: body.textBody }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      updatedByUserId: adminId,
    },
  });

  await logAdminAction(adminId, "email_template_updated", "email_template", tpl.id, {
    key: upper,
    changes: Object.keys(body),
  });

  return res.json({ template: { ...tpl, isDefault: false } });
}));

adminEmailTemplatesRouter.post("/:key/reset", asyncHandler(async (req, res) => {
  const { key } = req.params;
  const adminId = req.user!.id;
  const upper = key.toUpperCase();

  if (!TEMPLATE_KEYS.includes(upper as TemplateKey)) {
    return res.status(404).json({ error: "Unknown template key" });
  }

  await prisma.emailTemplate.deleteMany({ where: { key: upper } });

  await logAdminAction(adminId, "email_template_reset", "email_template", upper, { key: upper });

  const def = DEFAULT_TEMPLATES[upper as TemplateKey];
  return res.json({
    template: {
      id: null, key: upper, name: def.name, subject: def.subject,
      htmlBody: def.htmlBody, textBody: def.textBody, enabled: true,
      variables: def.variables, updatedAt: null, updatedBy: null, isDefault: true,
    },
  });
}));

adminEmailTemplatesRouter.post("/:key/test", asyncHandler(async (req, res) => {
  const { key } = req.params;
  const adminId = req.user!.id;
  const upper = key.toUpperCase();
  const { testEmail } = req.body as { testEmail?: string };

  if (!TEMPLATE_KEYS.includes(upper as TemplateKey)) {
    return res.status(404).json({ error: "Unknown template key" });
  }

  const to = testEmail?.trim() || req.user!.email;
  if (!to) return res.status(400).json({ error: "testEmail is required" });

  if (upper === "EMAIL_VERIFICATION") {
    await sendEmailVerificationEmail(to, "test-token-preview-only");
  } else if (upper === "PASSWORD_RESET") {
    await sendPasswordResetEmail(to, "test-token-preview-only");
  }

  await logAdminAction(adminId, "email_template_test_sent", "email_template", upper, {
    key: upper,
    sentTo: to,
  });

  return res.json({ ok: true, sentTo: to });
}));
