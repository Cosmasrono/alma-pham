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
  return Boolean(process.env.MAIL_HOST && process.env.MAIL_USERNAME);
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

export async function sendAccountSetupEmail(opts: {
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
    subject: "Set up your Amla Medicare account password",
    text: [
      `Hi ${opts.name},`,
      "",
      "An account has been created for you on Amla Medicare.",
      "Open the link below to choose your password.",
      "The link expires in 30 minutes and can only be used once.",
      "",
      opts.link,
      "",
      "If you were not expecting this, contact your administrator.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Set up your Amla Medicare password</h2>
        <p style="color:#3f3f46;line-height:1.6">Hi ${opts.name},</p>
        <p style="color:#3f3f46;line-height:1.6">
          An account has been created for you on Amla Medicare. Click the button below
          to choose your password. The link expires in <strong>30 minutes</strong>
          and can only be used once.
        </p>
        <p style="margin:24px 0">
          <a href="${opts.link}"
             style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">
            Set my password
          </a>
        </p>
        <p style="color:#71717a;font-size:13px;line-height:1.6">
          If the button doesn't work, copy this link into your browser:<br/>
          <a href="${opts.link}" style="color:#0d9488;word-break:break-all">${opts.link}</a>
        </p>
        <p style="color:#71717a;font-size:13px">
          If you were not expecting this, contact your administrator.
        </p>
      </div>`,
  });
}

export async function sendCredentialsEmail(opts: {
  to: string;
  name: string;
  username: string;
  password: string;
  setupLink: string;
}): Promise<void> {
  const from = `"${process.env.MAIL_FROM_NAME ?? "Amla Medicare"}" <${
    process.env.MAIL_FROM_ADDRESS ?? process.env.MAIL_USERNAME
  }>`;

  await transporter().sendMail({
    from,
    to: opts.to,
    subject: "Your Amla Medicare account — choose your password",
    text: [
      `Hi ${opts.name},`,
      "",
      "An account has been created for you on Amla Medicare.",
      "Open the link below to choose a password you'll remember:",
      "",
      opts.setupLink,
      "",
      `Your username is: ${opts.username}`,
      "",
      "The link works for 7 days. If it expires, or if you would rather sign",
      "in first, use this temporary password and change it later from the",
      "'Forgot password' link on the sign-in page:",
      "",
      `  Temporary password: ${opts.password}`,
      "",
      "If you were not expecting this, contact your administrator.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Welcome to Amla Medicare</h2>
        <p style="color:#3f3f46;line-height:1.6">Hi ${opts.name},</p>
        <p style="color:#3f3f46;line-height:1.6">
          An account has been created for you. Click below to choose a password
          you&rsquo;ll remember &mdash; the link works for <strong>7 days</strong>.
        </p>
        <p style="margin:24px 0">
          <a href="${opts.setupLink}"
             style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">
            Choose my password
          </a>
        </p>
        <table style="margin:20px 0;border-collapse:collapse;background:#f4f4f5;border-radius:10px">
          <tr>
            <td style="padding:10px 16px;color:#71717a;font-size:13px">Username</td>
            <td style="padding:10px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:#18181b">${opts.username}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;color:#71717a;font-size:13px">Temporary password</td>
            <td style="padding:10px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:#18181b">${opts.password}</td>
          </tr>
        </table>
        <p style="color:#71717a;font-size:13px;line-height:1.6">
          You can also sign in with the temporary password above and change it
          later from the <strong>Forgot password</strong> link on the sign-in page.
        </p>
        <p style="color:#71717a;font-size:13px;line-height:1.6">
          If the button doesn&rsquo;t work, copy this link into your browser:<br/>
          <a href="${opts.setupLink}" style="color:#0d9488;word-break:break-all">${opts.setupLink}</a>
        </p>
        <p style="color:#71717a;font-size:13px">
          If you were not expecting this, contact your administrator.
        </p>
      </div>`,
  });
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
