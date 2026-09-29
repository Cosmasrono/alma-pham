
const PAYHERO_BASE = "https://backend.payhero.co.ke";

function basicAuth(): string {
  const token = process.env.PAYHERO_AUTH_TOKEN?.trim();
  if (token) return token.startsWith("Basic ") ? token : `Basic ${token}`;

  const username = process.env.PAYHERO_API_USERNAME?.trim() ?? "";
  const password = process.env.PAYHERO_API_PASSWORD?.trim() ?? "";
  if (!username || !password) return "";

  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function channelId(): number | null {
  const value = Number(process.env.PAYHERO_CHANNEL_ID);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function callbackUrl(): string | undefined {
  return process.env.PAYHERO_CALLBACK_URL?.trim() || undefined;
}

export function mpesaConfigured(): boolean {
  return Boolean(basicAuth() && channelId());
}

/** "0712 345678" | "+254712345678" | "254712345678" -> "254712345678". */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const normalized = digits.startsWith("254")
    ? digits
    : digits.startsWith("0")
      ? `254${digits.slice(1)}`
      : digits.startsWith("7") || digits.startsWith("1")
        ? `254${digits}`
        : digits;
  return /^254[71]\d{8}$/.test(normalized) ? normalized : null;
}

function toLocalPhone(phone: string): string {
  return phone.startsWith("254") ? `0${phone.slice(3)}` : phone;
}

function payHeroHeaders() {
  return {
    Authorization: basicAuth(),
    "Content-Type": "application/json",
  };
}

export interface StkPushResult {
  ok: boolean;
  checkoutRequestId?: string;
  payheroReference?: string;
  payheroCheckoutRequestId?: string;
  error?: string;
}

/** Ask PayHero to pop the M-Pesa PIN prompt on the customer's phone. */
export async function stkPush(input: {
  phone: string; // normalized 2547XXXXXXXX
  amount: number; // whole shillings, >= 1
  accountReference: string; // e.g. the patient's MRN
  description: string;
}): Promise<StkPushResult> {
  const channel = channelId();
  if (!basicAuth() || !channel) {
    return { ok: false, error: "PayHero is not configured." };
  }

  const externalReference = `CF-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

  const res = await fetch(`${PAYHERO_BASE}/api/v2/payments`, {
    method: "POST",
    headers: payHeroHeaders(),
    body: JSON.stringify({
      amount: Math.max(1, Math.round(input.amount)),
      phone_number: toLocalPhone(input.phone),
      channel_id: channel,
      provider: "m-pesa",
      external_reference: externalReference,
      customer_name: input.accountReference || "AmlaMedicare",
      callback_url: callbackUrl(),
    }),
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    status?: string;
    reference?: string;
    CheckoutRequestID?: string;
    error_message?: string;
    message?: string;
    detail?: string;
  };

  if (res.ok && (body.success || body.status === "QUEUED")) {
    return {
      ok: true,
      // The app tracks this locally; callbacks use ExternalReference too.
      checkoutRequestId: externalReference,
      payheroReference: body.reference,
      payheroCheckoutRequestId: body.CheckoutRequestID,
    };
  }

  console.error("PayHero STK push rejected", res.status, body);
  return {
    ok: false,
    error:
      body.error_message ||
      body.message ||
      body.detail ||
      `PayHero M-Pesa request failed (${res.status})`,
  };
}

export type StkStatus =
  | { status: "pending" }
  | { status: "success"; receipt?: string }
  | { status: "failed"; detail: string };

function statusReference(storedReference: string): string {
  const match = storedReference.match(/PayHero reference: ([^;]+)/);
  return match?.[1] || storedReference;
}

/** Poll PayHero for the outcome of an STK push. */
 /** Poll PayHero for the outcome of an STK push. */
export async function stkQuery(reference: string): Promise<StkStatus> {
  const ref = statusReference(reference);
  const url = new URL(`${PAYHERO_BASE}/api/v2/transaction-status`);
  url.searchParams.set("reference", ref);

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuth() },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    success?: boolean;
    provider_reference?: string;
    third_party_reference?: string;
    error_message?: string;
    message?: string;
  };

  const status = body.status?.toUpperCase();

  // The payment outcome comes ONLY from `status`.
  // `body.success` just means the lookup itself worked.
  if (res.ok && status === "SUCCESS") {
    return {
      status: "success",
      receipt: body.provider_reference || body.third_party_reference,
    };
  }
  if (res.ok && status === "FAILED") {
    return { status: "failed", detail: body.message || "Payment failed." };
  }
  if (res.ok && (!status || status === "QUEUED" || status === "PENDING")) {
    return { status: "pending" };
  }

  // Transient server/network errors: keep polling instead of killing the tx.
  if (res.status >= 500) return { status: "pending" };

  return {
    status: "failed",
    detail:
      body.error_message ||
      body.message ||
      `PayHero status query failed (${res.status})`,
  };
}
