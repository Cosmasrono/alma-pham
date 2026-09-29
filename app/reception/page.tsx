"use client";

import { useMemo, useState } from "react";
import {
  payCharges,
  recordTriage,
  registerPatient,
  startVisit,
  useClinic,
} from "@/lib/store";
import type {
  Gender,
  Patient,
  PaymentMethod,
  Priority,
  Visit,
} from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LocationBadge,
  PageHeader,
  Spinner,
  StayBadge,
  cn,
  inputClass,
} from "@/components/ui";
import {
  LOCATION_LABELS,
  LONG_STAY_MS,
  VERY_LONG_STAY_MS,
  type VisitLocation,
  chargesTotal,
  doctorMap,
  doctorName,
  doctorQueueCounts,
  outstandingCharges,
  patientMap,
  patientName,
  visitLocation,
  visitTiming,
  visitsAwaitingPayment,
} from "@/lib/selectors";
import { StkBanner, useStkEnabled, useStkPush } from "@/components/MpesaPrompt";

/**
 * Reception is split into tabs so the receptionist only ever sees one job at
 * a time:
 *
 *   1. Check in  — one search box that finds a patient by ID / name / MRN,
 *                  or registers a new one if nothing matches.
 *   2. Payments  — the cashier desk. In per-stage billing patients wait here
 *                  for the consultation fee and, later, for their lab fees.
 *                  Stays empty in pay-at-end billing, where the pharmacy
 *                  collects everything at the end.
 *   3. Triage    — vitals for checked-in patients (badge shows how many wait).
 *   4. Patients  — the full register, for reference only.
 */

type Tab = "checkin" | "payments" | "triage" | "patients";

export default function ReceptionPage() {
  const data = useClinic();
  const [tab, setTab] = useState<Tab>("checkin");

  const triageCount = data.visits.filter(
    (v) => v.status === "awaiting-triage",
  ).length;
  const paymentCount = visitsAwaitingPayment(data).length;

  return (
    <div>
      <PageHeader
        title="Reception"
        subtitle="Check patients in, take their vitals, and send them to the doctor"
      />

      <InClinicStrip />

      <NextTask
        paymentCount={paymentCount}
        triageCount={triageCount}
        onSelect={setTab}
      />

      <TabBar
        tab={tab}
        onChange={setTab}
        paymentCount={paymentCount}
        triageCount={triageCount}
        patientCount={data.patients.length}
      />

      {tab === "checkin" && (
        <CheckInTab onGoToTriage={() => setTab("triage")} />
      )}
      {tab === "payments" && <PaymentsTab />}
      {tab === "triage" && <TriageTab />}
      {tab === "patients" && <PatientsTab />}
    </div>
  );
}

// --- tabs --------------------------------------------------------------------

function TabBar({
  tab,
  onChange,
  paymentCount,
  triageCount,
  patientCount,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  paymentCount: number;
  triageCount: number;
  patientCount: number;
}) {
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "checkin", label: "Check in" },
    { id: "payments", label: "Payments", count: paymentCount },
    { id: "triage", label: "Triage", count: triageCount },
    { id: "patients", label: "Patients", count: patientCount },
  ];
  return (
    <div
      role="tablist"
      aria-label="Reception tasks"
      className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-1"
    >
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex min-h-10 min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  active
                    ? "bg-teal-100 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NextTask({
  paymentCount,
  triageCount,
  onSelect,
}: {
  paymentCount: number;
  triageCount: number;
  onSelect: (tab: Tab) => void;
}) {
  const task = paymentCount > 0
    ? {
        tab: "payments" as const,
        eyebrow: "Needs attention",
        title: `${paymentCount} ${paymentCount === 1 ? "patient is" : "patients are"} waiting to pay`,
        detail: "Collect the outstanding charge so the patient can continue to the next station.",
        action: "Open payments",
      }
    : triageCount > 0
      ? {
          tab: "triage" as const,
          eyebrow: "Next task",
          title: `${triageCount} ${triageCount === 1 ? "patient is" : "patients are"} ready for triage`,
          detail: "Record vitals and priority, then send the patient to the assigned doctor.",
          action: "Start triage",
        }
      : {
          tab: "checkin" as const,
          eyebrow: "Reception ready",
          title: "Check in the next patient",
          detail: "Search first to avoid duplicate records, then register only if the patient is new.",
          action: "Find patient",
        };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-teal-700/15 bg-teal-50/90 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{task.eyebrow}</p>
        <p className="mt-1 font-semibold text-teal-950">{task.title}</p>
        <p className="mt-1 text-sm text-teal-900/65">{task.detail}</p>
      </div>
      <Button className="shrink-0" onClick={() => onSelect(task.tab)}>
        {task.action} <span aria-hidden>→</span>
      </Button>
    </div>
  );
}

// --- in-clinic strip -----------------------------------------------------------

/** One quiet line of chips showing only departments that currently hold a
 *  patient — replaces the old 7-cell grid that was mostly zeros. */
function InClinicStrip() {
  const data = useClinic();
  const open = data.visits.filter((v) => v.status !== "completed");

  const counts = new Map<VisitLocation, number>();
  for (const v of open) {
    const loc = visitLocation(data, v);
    counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }

  if (open.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-muted-foreground">
        {open.length} in clinic:
      </span>
      {[...counts.entries()].map(([loc, n]) => (
        <span
          key={loc}
          className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground"
        >
          {n} · {LOCATION_LABELS[loc]}
        </span>
      ))}
    </div>
  );
}

// --- check in tab ---------------------------------------------------------------

/** One search box replaces the old ID-lookup card + separate "returning
 *  patients" card. Type anything — national ID, name, or MRN — and either
 *  check the match in or register a new patient. */
function CheckInTab({ onGoToTriage }: { onGoToTriage: () => void }) {
  const data = useClinic();
  const [query, setQuery] = useState("");
  const [registering, setRegistering] = useState(false);

  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return [];
    return data.patients.filter(
      (p) =>
        p.nationalId.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q) ||
        patientName(p).toLowerCase().includes(q),
    );
  }, [data.patients, q]);

  const exactIdMatch = data.patients.some(
    (p) => p.nationalId.toLowerCase() === q,
  );

  const handleCheckedIn = (name: string) => {
    void name;
    setQuery("");
    setRegistering(false);
    // Auto-route reception straight to triage after check-in.
    onGoToTriage();
  };

  return (
    <Card>
      <Field label="Find patient">
        <input
          className={inputClass}
          value={query}
          placeholder="National ID, name, or MRN…"
          onChange={(e) => {
            setQuery(e.target.value);
            setRegistering(false);
          }}
          autoFocus
        />
      </Field>

      {q && !registering && (
        <div className="mt-4">
          {matches.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {matches.map((p) => (
                <PatientResultRow
                  key={p.id}
                  patient={p}
                  onCheckedIn={handleCheckedIn}
                />
              ))}
            </ul>
          ) : (
            <EmptyState>No patient matches “{query}”.</EmptyState>
          )}

          {!exactIdMatch && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-300 p-3">
              <p className="text-sm text-zinc-600">
                Not registered yet?
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRegistering(true)}
              >
                Register new patient
              </Button>
            </div>
          )}
        </div>
      )}

      {registering && (
        <RegisterForm
          initialNationalId={/^\d+$/.test(query.trim()) ? query.trim() : ""}
          onCancel={() => setRegistering(false)}
          onRegistered={handleCheckedIn}
        />
      )}

      {!q && (
        <p className="mt-4 text-sm text-zinc-400">
          Start typing to find a patient, or enter a new national ID to
          register one.
        </p>
      )}
    </Card>
  );
}

/** A search result: shows where the patient is if they're already in the
 *  clinic; otherwise expands a doctor picker to check them in. */
function PatientResultRow({
  patient,
  onCheckedIn,
}: {
  patient: Patient;
  onCheckedIn: (name: string) => void;
}) {
  const data = useClinic();
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openVisit = data.visits.find(
    (v) => v.patientId === patient.id && v.status !== "completed",
  );

  const checkIn = async () => {
    if (!doctorId || submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await startVisit(patient.id, doctorId);
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCheckedIn(patientName(patient));
  };

  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        open ? "border-teal-200 bg-teal-50/40" : "border-zinc-200",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={patientName(patient)} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-800">
              {patientName(patient)}
            </p>
            <p className="truncate text-xs text-zinc-500">
              <span className="font-mono">{patient.mrn}</span> · ID{" "}
              <span className="font-mono">{patient.nationalId}</span> ·{" "}
              <span className="capitalize">{patient.gender}</span>,{" "}
              {patient.age}y
            </p>
          </div>
        </div>

        {openVisit ? (
          <LocationBadge location={visitLocation(data, openVisit)} />
        ) : open ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={() => setOpen(true)}>
            Check in
          </Button>
        )}
      </div>

      {open && !openVisit && (
        <div className="mt-3 border-t border-teal-100 pt-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <DoctorPicker value={doctorId} onChange={setDoctorId} />
            </div>
            <Button
              size="sm"
              disabled={!doctorId || submitting}
              onClick={checkIn}
            >
              {submitting ? <Spinner /> : "Confirm"}
            </Button>
          </div>
          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// --- new patient form ------------------------------------------------------------

const emptyDetails = {
  firstName: "",
  lastName: "",
  gender: "female" as Gender,
  age: "",
  phone: "",
};

function RegisterForm({
  initialNationalId,
  onCancel,
  onRegistered,
}: {
  initialNationalId: string;
  onCancel: () => void;
  onRegistered: (name: string) => void;
}) {
  const [nationalId, setNationalId] = useState(initialNationalId);
  const [details, setDetails] = useState(emptyDetails);
  const [doctorId, setDoctorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setField =
    (k: keyof typeof details) => (e: { target: { value: string } }) =>
      setDetails((d) => ({ ...d, [k]: e.target.value }));

  const submit = async () => {
    if (
      !nationalId.trim() ||
      !details.firstName.trim() ||
      !details.lastName.trim() ||
      !doctorId ||
      submitting
    )
      return;
    setError(null);
    setSubmitting(true);
    const result = await registerPatient({
      nationalId: nationalId.trim(),
      firstName: details.firstName,
      lastName: details.lastName,
      gender: details.gender,
      age: Number(details.age) || 0,
      phone: details.phone,
      assignedDoctorId: doctorId,
    });
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onRegistered(
      `${result.patient.firstName} ${result.patient.lastName} (${result.patient.mrn})`,
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="mt-4 grid grid-cols-1 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2"
    >
      <div className="col-span-1 flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-semibold text-zinc-700">New patient</h3>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="col-span-1 sm:col-span-2">
        <Field label="National ID">
          <input
            className={inputClass}
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="First name">
        <input
          className={inputClass}
          value={details.firstName}
          onChange={setField("firstName")}
          required
        />
      </Field>
      <Field label="Last name">
        <input
          className={inputClass}
          value={details.lastName}
          onChange={setField("lastName")}
          required
        />
      </Field>
      <Field label="Gender">
        <select
          className={inputClass}
          value={details.gender}
          onChange={setField("gender")}
        >
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Age">
        <input
          className={inputClass}
          type="number"
          min={0}
          value={details.age}
          onChange={setField("age")}
        />
      </Field>
      <div className="col-span-1 sm:col-span-2">
        <Field label="Phone">
          <input
            className={inputClass}
            value={details.phone}
            onChange={setField("phone")}
            placeholder="07xx xxx xxx"
          />
        </Field>
      </div>
      <div className="col-span-1 sm:col-span-2">
        <DoctorPicker value={doctorId} onChange={setDoctorId} />
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div className="col-span-1 sm:col-span-2">
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Spinner />}
          {submitting ? "Registering…" : "Register & check in"}
        </Button>
      </div>
    </form>
  );
}

// --- payments tab -----------------------------------------------------------------

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "mpesa", label: "M-Pesa" },
  { key: "card", label: "Card" },
];

/** The cashier queue: patients held at a pay-gate until their bill so far is
 *  settled. Only per-stage visits ever land here. */
function PaymentsTab() {
  const data = useClinic();
  const pmap = patientMap(data);
  const queue = visitsAwaitingPayment(data);
  // PayHero credentials present? If not, M-Pesa falls back to typing the code
  // off the patient's phone, exactly as the pharmacy does.
  const stkEnabled = useStkEnabled();

  if (queue.length === 0) {
    return (
      <EmptyState>
        Nobody is waiting to pay. In pay-at-end billing this stays empty — the
        pharmacy collects the whole bill when the patient leaves.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {queue.map((visit) => {
        const patient = pmap.get(visit.patientId);
        return (
          <PaymentCard
            key={visit.id}
            visit={visit}
            name={patient ? patientName(patient) : "Unknown patient"}
            mrn={patient?.mrn ?? ""}
            patientPhone={patient?.phone ?? ""}
            stkEnabled={stkEnabled}
          />
        );
      })}
    </div>
  );
}

function PaymentCard({
  visit,
  name,
  mrn,
  patientPhone,
  stkEnabled,
}: {
  visit: Visit;
  name: string;
  mrn: string;
  patientPhone: string;
  stkEnabled: boolean;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [phone, setPhone] = useState(patientPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charges = outstandingCharges(visit);
  const total = chargesTotal(charges);
  // With PayHero configured, M-Pesa prompts the patient's phone instead of
  // asking the cashier to copy a code — the same flow the pharmacy runs.
  const stkFlow = method === "mpesa" && stkEnabled;
  // Cash needs no reference; a typed-in M-Pesa or card payment must be
  // traceable to a receipt.
  const needsReference = method !== "cash" && !stkFlow;
  const cashAmount = Number(cashReceived);
  const cashValid =
    method !== "cash" ||
    (cashReceived.trim() !== "" &&
      Number.isFinite(cashAmount) &&
      cashAmount >= total);
  const change = method === "cash" && cashValid ? cashAmount - total : 0;
  const ready =
    !busy && cashValid && (!needsReference || reference.trim() !== "");

  const gate =
    visit.status === "awaiting-consult-payment"
      ? "Consultation fee — due before triage"
      : "Service fees — due before the tests are run";

  /** Book the money against the gate's charges. `serverReference` is the
   *  CheckoutRequestID of a confirmed push; the server swaps in the receipt.
   *  On success the gate opens and this card leaves the queue. */
  const take = async (serverReference?: string) => {
    setBusy(true);
    setError(null);
    const err = await payCharges({
      visitId: visit.id,
      chargeIds: charges.map((c) => c.id),
      method,
      reference: (serverReference ?? reference).trim() || undefined,
    });
    setBusy(false);
    if (err) setError(err);
  };

  // Money confirmed on the patient's phone → release the gate automatically.
  const {
    stk,
    busy: stkBusy,
    error: stkError,
    request,
    reset: resetStk,
  } = useStkPush((checkoutRequestId) => void take(checkoutRequestId));

  const requestStk = () =>
    void request({
      phone,
      accountReference: mrn || "AmlaMedicare",
      // The server prices these charges itself, so the pushed amount always
      // matches what payCharges will settle.
      visitId: visit.id,
      chargeIds: charges.map((c) => c.id),
    });

  const shownError = error ?? stkError;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-zinc-900">{name}</p>
          <p className="text-xs text-zinc-500">{mrn}</p>
        </div>
        <StayBadge timing={visitTiming(visit)} />
      </div>

      <p className="mt-2 text-xs font-medium text-amber-700">{gate}</p>

      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {charges.map((c) => (
          <li
            key={c.id}
            className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2"
          >
            <span className="text-zinc-700">{c.description}</span>
            <span className="tabular-nums text-zinc-900">
              {money(c.amount)}
            </span>
          </li>
        ))}
        <li className="mt-1 flex justify-between border-t border-zinc-200 px-3 pt-2 font-semibold">
          <span>Total due</span>
          <span className="tabular-nums text-teal-700">{money(total)}</span>
        </li>
      </ul>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Payment method">
          <select
            className={inputClass}
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as PaymentMethod);
              setCashReceived("");
              resetStk();
              setError(null);
            }}
          >
            {METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        {method === "cash" ? (
          <Field label="Cash received (KSh)">
            <input
              className={inputClass}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder={`At least ${total.toLocaleString("en-KE")}`}
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
            />
          </Field>
        ) : stkFlow ? (
          <Field label="Patient phone (Safaricom)">
            <input
              className={inputClass}
              placeholder="e.g. 0712 345678"
              value={phone}
              disabled={stk?.status === "pending"}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        ) : (
          <Field
            label={
              method === "mpesa"
                ? "M-Pesa code"
                : method === "card"
                  ? "Card reference"
                  : "Reference (optional)"
            }
          >
            <input
              className={inputClass}
              placeholder={method === "mpesa" ? "e.g. SGH4X2K9QT" : ""}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        )}
      </div>

      {method === "cash" && cashReceived.trim() !== "" && (
        cashValid ? (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
            <span>Change to return</span>
            <strong className="tabular-nums">{money(change)}</strong>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <span>Cash is short by</span>
            <strong className="tabular-nums">
              {money(Math.max(0, total - (Number.isFinite(cashAmount) ? cashAmount : 0)))}
            </strong>
          </div>
        )
      )}

      {shownError && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {shownError}
        </p>
      )}

      {stkFlow && stk && (
        <StkBanner
          stk={stk}
          phone={phone}
          onReset={resetStk}
          success={
            error ? (
              <>
                the payment was not recorded.{" "}
                <button
                  className="underline"
                  disabled={busy}
                  onClick={() => void take(stk.id)}
                >
                  Retry recording it
                </button>
              </>
            ) : (
              "releasing the patient…"
            )
          }
        />
      )}

      {stkFlow ? (
        <Button
          className="mt-4 w-full"
          disabled={
            !ready ||
            stkBusy ||
            !phone.trim() ||
            stk?.status === "pending" ||
            stk?.status === "success"
          }
          onClick={requestStk}
        >
          {!phone.trim()
            ? "Enter the patient's phone number"
            : stk?.status === "pending"
              ? "Waiting for M-Pesa…"
              : `Request ${money(Math.max(1, Math.round(total)))} via M-Pesa`}
        </Button>
      ) : (
        <Button className="mt-4 w-full" disabled={!ready} onClick={() => take()}>
          {busy
            ? "Recording…"
            : needsReference && !reference.trim()
              ? "Enter the payment reference"
              : method === "cash" && !cashReceived.trim()
                ? "Enter cash received"
                : method === "cash" && !cashValid
                  ? "Cash received is not enough"
              : method === "cash" && cashValid && change > 0
                ? `Take cash · return ${money(change)}`
                : `Take ${money(total)}`}
        </Button>
      )}
    </Card>
  );
}

// --- triage tab -------------------------------------------------------------------

function TriageTab() {
  const data = useClinic();
  const pmap = patientMap(data);
  const dmap = doctorMap(data);
  const queue = data.visits
    .filter((v) => v.status === "awaiting-triage")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (queue.length === 0) {
    return (
      <EmptyState>
        No patients waiting for triage. Check someone in first.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {queue.map((v) => {
        const patient = pmap.get(v.patientId);
        const doctor = v.assignedDoctorId
          ? dmap.get(v.assignedDoctorId)
          : undefined;
        return (
          <TriageCard
            key={v.id}
            visitId={v.id}
            patient={patientName(patient)}
            mrn={patient?.mrn ?? ""}
            doctor={doctorName(doctor)}
          />
        );
      })}
    </div>
  );
}

const PRIORITY_OPTIONS: { value: Priority; label: string; active: string }[] = [
  { value: "normal", label: "Normal", active: "bg-zinc-800 text-white" },
  { value: "urgent", label: "Urgent", active: "bg-orange-500 text-white" },
  { value: "emergency", label: "Emergency", active: "bg-red-600 text-white" },
];

function TriageCard({
  visitId,
  patient,
  mrn,
  doctor,
}: {
  visitId: string;
  patient: string;
  mrn: string;
  doctor: string;
}) {
  const [weight, setWeight] = useState("");
  const [temperature, setTemperature] = useState("");
  const [bloodPressure, setBloodPressure] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    const result = await recordTriage(
      visitId,
      { weight, temperature, bloodPressure },
      priority,
    );
    setSaving(false);
    if (result.error) setError(result.error);
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={patient} />
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-800">{patient}</p>
            <p className="truncate text-xs text-zinc-500">
              <span className="font-mono">{mrn}</span>
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
          → {doctor}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Field label="Weight (kg)">
          <input
            className={inputClass}
            type="number"
            min={0}
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </Field>
        <Field label="Temp (°C)">
          <input
            className={inputClass}
            type="number"
            min={0}
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </Field>
        <Field label="BP (mmHg)">
          <input
            className={inputClass}
            placeholder="120/80"
            value={bloodPressure}
            onChange={(e) => setBloodPressure(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-sm font-medium text-zinc-700">Priority</p>
        <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPriority(opt.value)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                priority === opt.value
                  ? opt.active
                  : "text-muted-foreground hover:bg-card hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <Button className="mt-4 w-full" onClick={submit} disabled={saving}>
        {saving && <Spinner />}
        {saving ? "Sending…" : "Send to doctor"}
      </Button>
    </Card>
  );
}

// --- patients tab -----------------------------------------------------------------

function PatientsTab() {
  const data = useClinic();

  if (data.patients.length === 0) {
    return (
      <EmptyState>
        No patients yet. Register your first from the Check in tab.
      </EmptyState>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">MRN</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Sex / Age</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 font-medium">Latest visit</th>
            </tr>
          </thead>
          <tbody>
            {[...data.patients].reverse().map((p) => {
              const last = [...data.visits]
                .reverse()
                .find((v) => v.patientId === p.id);
              const timing =
                last && last.status !== "completed"
                  ? visitTiming(last)
                  : null;
              // Long-stay rows get tinted so they stand out while scrolling.
              const slow =
                timing &&
                (timing.totalMs >= VERY_LONG_STAY_MS
                  ? "bg-red-50/60 dark:bg-red-950/40 hover:bg-red-50 dark:hover:bg-red-950/60"
                  : timing.totalMs >= LONG_STAY_MS
                    ? "bg-amber-50/60 dark:bg-amber-950/40 hover:bg-amber-50 dark:hover:bg-amber-950/60"
                    : null);
              return (
                <tr
                  key={p.id}
                  className={cn(
                    "border-t border-border transition-colors",
                    slow ?? "hover:bg-muted/50",
                  )}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {p.mrn}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {patientName(p)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <span className="capitalize">{p.gender}</span>, {p.age}y
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {p.phone || "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {last ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <LocationBadge location={visitLocation(data, last)} />
                        {timing && <StayBadge timing={timing} />}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- small shared pieces -----------------------------------------------------

function Avatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-100 text-xs font-semibold text-teal-700">
      {initials}
    </span>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="col-span-2 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <p>{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 leading-none text-red-400 transition-colors hover:text-red-600"
      >
        ✕
      </button>
    </div>
  );
}

// --- doctor picker ----------------------------------------------------------------

/** Reusable "Assign to doctor" dropdown driven by the roster. Queues are
 *  unbounded — each doctor shows how many patients they already have so the
 *  receptionist can balance the load. */
function DoctorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const data = useClinic();
  const counts = doctorQueueCounts(data);
  return (
    <Field label="Assign to doctor">
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      >
        <option value="" disabled>
          Select a doctor…
        </option>
        {data.doctors.map((d) => {
          const n = counts.get(d.id) ?? 0;
          return (
            <option key={d.id} value={d.id}>
              {d.name}
              {n > 0 ? ` — ${n} waiting` : " — free"}
            </option>
          );
        })}
      </select>
    </Field>
  );
}
