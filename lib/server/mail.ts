// Outbound email (SMTP via nodemailer). Node.js runtime only.
//
// Reads the MAIL_* variables from .env. When they are missing (e.g. a fresh
// checkout) the send functions throw, and callers surface a friendly error.
import nodemailer from "nodemailer";
import * as tls from "node:tls";

// Older Node typings do not include this API (Node 22.15+/23.10+).
const getCACertificates = (tls as typeof tls & {
  getCACertificates?: (type: "default" | "system") => string[];
}).getCACertificates;
let trustedCertificates: string[] | undefined;

function mailCertificates(): string[] | undefined {
  if (!getCACertificates) return undefined;
  // Include OS trust even when Next.js is started without --use-system-ca.
  // Preserve Node's default trust, including NODE_EXTRA_CA_CERTS.
  return (trustedCertificates ??= [...new Set([
    ...getCACertificates("default"),
    ...getCACertificates("system"),
  ])]);
}

export function mailConfigured(): boolean {
  return Boolean(process.env.MAIL_HOST && process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD);
}

function transporter() {
  const port = Number(process.env.MAIL_PORT ?? 587);
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure: port === 465, // 587 uses STARTTLS, negotiated automatically
    tls: {
      ca: mailCertificates(),
      // Keep certificate verification enabled by default. This opt-out is for
      // local development with a known self-signed/intercepting SMTP certificate.
      rejectUnauthorized: process.env.MAIL_TLS_REJECT_UNAUTHORIZED !== "false",
    },
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  link: string;
}): Promise<void> {
  const from = `"${process.env.MAIL_FROM_NAME ?? "Amla Medicare"}" <${
    process.env.MAIL_FROM_ADDRESS ?? process.env.MAIL_USERNAME
  }>`;

  await transporter().sendMail({
    from,
    to: opts.to,
    subject: "Reset your Amla Medicare password",
    text: [
      `Hi ${opts.name},`,
      "",
      "Someone (hopefully you) asked to reset your Amla Medicare password.",
      "Open the link below to choose a new one. It expires in 30 minutes",
      "and can only be used once.",
      "",
      opts.link,
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Reset your Amla Medicare password</h2>
        <p style="color:#3f3f46;line-height:1.6">Hi ${opts.name},</p>
        <p style="color:#3f3f46;line-height:1.6">
          Someone (hopefully you) asked to reset your Amla Medicare password.
          Click the button below to choose a new one. The link expires in
          <strong>30 minutes</strong> and can only be used once.
        </p>
        <p style="margin:24px 0">
          <a href="${opts.link}"
             style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">
            Choose a new password
          </a>
        </p>
        <p style="color:#71717a;font-size:13px;line-height:1.6">
          If the button doesn't work, copy this link into your browser:<br/>
          <a href="${opts.link}" style="color:#0d9488;word-break:break-all">${opts.link}</a>
        </p>
        <p style="color:#71717a;font-size:13px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export async function sendAccountSetupEmail(opts: {
  to: string;
  name: string;
  username: string;
  link: string;
}): Promise<void> {
  const result = await transporter().sendMail({
    from: { name: process.env.MAIL_FROM_NAME ?? "Amla Medicare", address: process.env.MAIL_FROM_ADDRESS ?? process.env.MAIL_USERNAME! },
    to: opts.to,
    subject: "Your Amla Medicare account — set your password",
    text: [
      `Hi ${opts.name},`, "",
      "Your administrator has created an Amla Medicare account for you.",
      `Username: ${opts.username}`, "",
      "Open this link to set your password, then sign in:", opts.link, "",
      "This link expires in 7 days and can only be used once.",
      "If it expires, ask your administrator to send another link or use Forgot password on the sign-in page.",
      "If you were not expecting this invitation, contact your administrator.",
    ].join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#3f3f46;line-height:1.6">
      <h2 style="color:#134e4a">Welcome to Amla Medicare</h2>
      <p>Hi ${escapeHtml(opts.name)},</p>
      <p>Your administrator has created an account for you.</p>
      <p>Your username: <strong>${escapeHtml(opts.username)}</strong></p>
      <p>Choose your password using the button below, then sign in with your username or email and your new password.</p>
      <p style="margin:24px 0"><a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#0b655d;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Set my password</a></p>
      <p>This link expires in <strong>7 days</strong> and can only be used once.</p>
      <p style="font-size:13px">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(opts.link)}" style="word-break:break-all">${escapeHtml(opts.link)}</a></p>
      <p style="font-size:13px">If it expires, ask your administrator to send another link or use Forgot password on the sign-in page.</p>
      <p style="font-size:13px">If you were not expecting this invitation, contact your administrator.</p>
    </div>`,
  });
  if (!result.accepted?.length) throw new Error("The mail server did not accept the invitation recipient.");
}

export async function sendAdminSignupCodeEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const from = `"${process.env.MAIL_FROM_NAME ?? "Amla Medicare"}" <${
    process.env.MAIL_FROM_ADDRESS ?? process.env.MAIL_USERNAME
  }>`;

  await transporter().sendMail({
    from,
    to: opts.to,
    subject: `${opts.code} is your Amla Medicare verification code`,
    text: [
      `Hi ${opts.name},`,
      "",
      "Use this code to finish creating the Amla Medicare administrator account:",
      "",
      `  ${opts.code}`,
      "",
      "It expires in 15 minutes. If you didn't try to sign up, ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Verify your email</h2>
        <p style="color:#3f3f46;line-height:1.6">Hi ${opts.name},</p>
        <p style="color:#3f3f46;line-height:1.6">
          Use this code to finish creating the Amla Medicare administrator account.
          It expires in <strong>15 minutes</strong>.
        </p>
        <p style="margin:24px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#134e4a">
          ${opts.code}
        </p>
        <p style="color:#71717a;font-size:13px">
          If you didn't try to sign up, you can safely ignore this email.
        </p>
      </div>`,
  });
}
