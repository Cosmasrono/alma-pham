This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

## Staff invitations

Three kinds of account:

- **Developer (you, the vendor)** — exactly one account. While none exists,
  the sign-in page shows **Are you a developer?**, which leads to a one-time
  signup (any email, verified by code). Once the account exists that link
  disappears and signup closes; the developer signs in on the normal sign-in
  page. The account is stored apart from clinic users, so admins never see it.
  Sees every page read-only and cannot change clinic data.
- **Owner and administrator (the client)** — the only emails allowed to sign
  up. Both get the admin role after verifying an emailed code. Only the owner
  can delete accounts.
- **Staff** — invited by an administrator from **Users**; they set their own
  password from the emailed link.

When installing for a client, name their owner and administrator with:
`pnpm exec tsx --env-file=.env scripts/configure-signup.ts --owner owner@client.com --admin admin@client.com`.
Either flag may be omitted to leave that email unchanged. This does not change
existing account passwords.

Set `APP_URL` to the public website address staff can open from their devices
(for example, `https://clinic.example.com`). A localhost URL only works on the
computer running the app. Configure `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`,
`MAIL_PASSWORD`, and optionally `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME`.

In **Users**, create a staff account with an email address. The app emails the
username and a single-use password setup link valid for seven days. Staff choose
their password, then select **Continue to sign in**. No password is emailed.
If delivery fails, the account remains in the list; use **Send setup link** to
retry. Sending a new link invalidates previous links. Existing users can also
use **Forgot password**, whose links expire after 30 minutes.

Run the isolated invitation and reset tests with
`pnpm exec tsx --test scripts/account-setup.test.ts`.

## SMTP Certificate Troubleshooting

SMTP certificate verification is enabled by default. The mail transport includes the operating system's trusted certificates alongside Node's default certificates on Node 22.15+/23.10+. This also works when Next.js starts without `--use-system-ca`. On older Node versions, the transport retains Node's default certificate trust. This supports SMTP connections inspected by security software whose CA is already trusted by Windows.

The development command also uses Node's `--use-system-ca` option. Use Node 22.19+ or Node 24+ for this command, and restart the dev server after updating it.

If certificate errors persist, check that `MAIL_HOST` is the SMTP provider's hostname and that `MAIL_PORT` matches its TLS mode (typically 587 for STARTTLS or 465 for implicit TLS). For a private CA, set `NODE_EXTRA_CA_CERTS` to the trusted CA's PEM file in the shell or deployment environment **before starting Node**; setting it in Next.js's `.env` is too late. Production deployments must configure their own CA trust.

The existing `MAIL_TLS_REJECT_UNAUTHORIZED=false` option disables SMTP certificate verification. Reserve it for a known local test server; do not use it for Gmail or production.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
