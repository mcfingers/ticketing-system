import nodemailer from "nodemailer";

/**
 * SMTP mailer for account-verification emails.
 *
 * Defaults target DataArt's internal relay (relay1.dataart.com), which accepts
 * unauthenticated mail destined for the @dataart.com domain — so no SMTP_USER /
 * SMTP_PASS are required for QA. All settings are overridable via env vars.
 */
const SMTP_HOST = process.env.SMTP_HOST || "relay1.dataart.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 25);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const MAIL_FROM = process.env.SMTP_FROM || "Ticketing <noreply@dataart.com>";

// Public base URL the verification link points at. The same origin serves the
// web app and proxies /api (nginx in Docker on :8080, Vite on :5173 in dev).
export const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false, // relay on :25 is plain SMTP/STARTTLS, not implicit TLS
  // Only attach credentials if provided; the DataArt relay needs none.
  ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {}),
});

export function buildVerificationUrl(token: string): string {
  return `${APP_BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const url = buildVerificationUrl(token);
  await transporter.sendMail({
    from: MAIL_FROM,
    to,
    subject: "Verify your Ticketing account",
    text:
      `Hi ${name},\n\n` +
      `Please confirm your email address to activate your Ticketing account by ` +
      `opening the link below within 24 hours:\n\n${url}\n\n` +
      `If you did not create this account, you can ignore this email.`,
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>Please confirm your email address to activate your Ticketing account. ` +
      `This link expires in <strong>24 hours</strong>.</p>` +
      `<p><a href="${url}">Verify my account</a></p>` +
      `<p style="color:#666;font-size:12px">If you did not create this account, you can ignore this email.</p>`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
