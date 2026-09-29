"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  addPrescription,
  addServiceOrders,
  assignVisitDoctor,
  sendToPharmacy,
  setVisitComplaint,
  startConsult,
  useClinic,
} from "@/lib/store";
import type { Med, OrderType } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LocationBadge,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  cn,
  inputClass,
} from "@/components/ui";
import {
  byPriorityThenArrival,
  chargesTotal,
  doctorMap,
  doctorName,
  doctorQueueCounts,
  ordersForVisit,
  patientMap,
  patientName,
  visitLocation,
  visitsByStatus,
} from "@/lib/selectors";

export default function DoctorPage() {
  const data = useClinic();
  const pmap = patientMap(data);
  const dmap = doctorMap(data);
  const active = visitsByStatus(data, "waiting", "with-doctor", "back-to-doctor");

  // Which doctor's queue we're looking at. "all" = whole department,
  // "unassigned" = patients reception didn't route yet.
  const [view, setView] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queue = active
    .filter((v) =>
      view === "all"
        ? true
        : view === "unassigned"
          ? !v.assignedDoctorId
          : v.assignedDoctorId === view,
    )
    .sort(byPriorityThenArrival);
  const selected = active.find((v) => v.id === selectedId) ?? null;

  const countFor = (id: string) =>
    id === "unassigned"
      ? active.filter((v) => !v.assignedDoctorId).length
      : active.filter((v) => v.assignedDoctorId === id).length;

  return (
    <div>
      <PageHeader
        title="Doctor"
        subtitle="Each doctor has their own queue. Reception routes patients here."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <QueueTab
          label={`All (${active.length})`}
          active={view === "all"}
          onClick={() => setView("all")}
        />
        {data.doctors.map((d) => (
          <QueueTab
            key={d.id}
            label={`${d.name} (${countFor(d.id)})`}
            active={view === d.id}
            onClick={() => setView(d.id)}
          />
        ))}
        {countFor("unassigned") > 0 && (
          <QueueTab
            label={`Unassigned (${countFor("unassigned")})`}
            active={view === "unassigned"}
            onClick={() => setView("unassigned")}
            warn
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">
            Queue ({queue.length})
          </h2>
          {queue.length === 0 ? (
            <EmptyState>No patients in this queue.</EmptyState>
          ) : (
            queue.map((v) => {
              const p = pmap.get(v.patientId);
              const emergency = v.priority === "emergency";
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    selectedId === v.id
                      ? emergency
                        ? "border-red-500 bg-red-50"
                        : "border-teal-500 bg-teal-50"
                      : emergency
                        ? "border-red-300 bg-red-50/60 hover:border-red-400"
                        : "border-zinc-200 bg-white hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {patientName(p)}
                    </span>
                    <div className="flex items-center gap-1">
                      {emergency && (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Emergency
                        </span>
                      )}
                      {v.priority && v.priority !== "normal" && (
                        <PriorityBadge priority={v.priority} />
                      )}
                      <LocationBadge location={visitLocation(data, v)} />
                    </div>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {p?.mrn} · {v.complaint || "Awaiting consultation"}
                  </p>
                  <p className="mt-1 text-xs font-medium text-teal-700">
                    {doctorName(
                      v.assignedDoctorId
                        ? dmap.get(v.assignedDoctorId)
                        : undefined,
                    )}
                  </p>
                </button>
              );
            })
          )}
        </div>

        <div>
          {selected ? (
            <ConsultPanel key={selected.id} visitId={selected.id} />
          ) : (
            <EmptyState>Select a patient from the queue to begin.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueTab({
  label,
  active,
  onClick,
  warn,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  warn?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-teal-600 text-white"
          : warn
            ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {label}
    </button>
  );
}

function ConsultPanel({ visitId }: { visitId: string }) {
  const data = useClinic();
  const [assignError, setAssignError] = useState<string | null>(null);
  const visit = data.visits.find((v) => v.id === visitId);
  const patient = visit && patientMap(data).get(visit.patientId);
  const orders = ordersForVisit(data, visitId);
  const [complaintDraft, setComplaintDraft] = useState(visit?.complaint ?? "");
  // Held here (not inside the form) so Finalize can save unsaved lines.
  const [medDrafts, setMedDrafts] = useState<MedDraft[]>([{ ...blankMed }]);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // The doctor either sends the patient for tests or prescribes — never both
  // forms at once. Returning patients (results in) default to prescribing.
  const [mode, setMode] = useState<"services" | "prescribe">(() =>
    visit?.status === "back-to-doctor" ||
    orders.some((o) => o.type === "prescription")
      ? "prescribe"
      : "services",
  );

  if (!visit || !patient) return null;

  const complaintDirty = complaintDraft.trim() !== visit.complaint.trim();

  const saveComplaintIfDirty = () => {
    if (complaintDirty) {
      setVisitComplaint(visitId, complaintDraft.trim());
    }
  };

  const startedDrafts = medDrafts.filter(isDraftStarted);
  const completeDrafts = startedDrafts.filter(isDraftComplete);

  const finalizeAndSendToPharmacy = async () => {
    // Never force a separate "Save" click before finalizing — neither for the
    // complaint nor for medicines typed into the form but not yet saved.
    setFinalizeError(null);
    if (startedDrafts.length !== completeDrafts.length) {
      setFinalizeError(
        "Finish each medicine line (medicine, dosage, frequency, duration and quantity) or remove it.",
      );
      return;
    }
    setFinalizing(true);
    saveComplaintIfDirty();
    if (completeDrafts.length > 0) {
      const { error } = await addPrescription(visitId, completeDrafts.map(toMedInput));
      if (error) {
        setFinalizing(false);
        return;
      }
      setMedDrafts([{ ...blankMed }]);
    }
    await sendToPharmacy(visitId);
    setFinalizing(false);
  };

  // Queue depth per doctor (this visit excluded) so reassignment shows load.
  const queueCounts = doctorQueueCounts(data, visitId);

  const pendingServices = orders.filter(
    (o) => o.type !== "prescription" && o.status !== "completed",
  );
  const hasSavedPrescription = orders.some((o) => o.type === "prescription");
  const hasPrescription = hasSavedPrescription || completeDrafts.length > 0;
  const canFinalize = pendingServices.length === 0 && !finalizing;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{patientName(patient)}</h2>
          <p className="text-sm text-zinc-500">
            {patient.mrn} · {patient.gender}, {patient.age}y · {patient.phone}
          </p>
        </div>
        <LocationBadge location={visitLocation(data, visit)} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {[
          { label: "Weight", value: visit.vitals?.weight, unit: "kg" },
          { label: "Temp", value: visit.vitals?.temperature, unit: "°C" },
          { label: "BP", value: visit.vitals?.bloodPressure, unit: "" },
        ].map((vital) => (
          <div key={vital.label} className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">{vital.label}</p>
            <p className="font-medium text-zinc-800">
              {vital.value ? `${vital.value} ${vital.unit}`.trim() : "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Field label="Assigned doctor">
          <select
            className={inputClass}
            value={visit.assignedDoctorId ?? ""}
            onChange={async (e) => {
              setAssignError(null);
              const err = await assignVisitDoctor(visitId, e.target.value);
              if (err) setAssignError(err);
            }}
          >
            <option value="" disabled>
              Unassigned — choose a doctor…
            </option>
            {data.doctors.map((d) => {
              const n = queueCounts.get(d.id) ?? 0;
              return (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {n > 0 ? ` — ${n} waiting` : ""}
                </option>
              );
            })}
          </select>
        </Field>
        {assignError && (
          <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
            {assignError}
          </p>
        )}
      </div>

      {visit.status === "waiting" && (
        <Button className="mt-4" onClick={() => startConsult(visitId)}>
          Start consultation
        </Button>
      )}

      {visit.status !== "waiting" && visit.status !== "completed" && (
        <div className="mt-4">
          <ComplaintEditor
            initial={visit.complaint}
            text={complaintDraft}
            onTextChange={setComplaintDraft}
            onSave={saveComplaintIfDirty}
          />
        </div>
      )}

      {/* What the visit has cost so far, so the doctor is never ordering
          blind against a bill the patient has to settle. */}
      {(visit.charges ?? []).length > 0 && (
        <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-zinc-700">Bill so far</span>
            <span className="tabular-nums font-semibold text-zinc-900">
              KSh {chargesTotal(visit.charges).toLocaleString("en-KE")}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-600">
            {visit.charges.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span>
                  {c.description}
                  {!c.paid && (
                    <span className="ml-2 text-amber-600">unpaid</span>
                  )}
                </span>
                <span className="tabular-nums">
                  {c.amount.toLocaleString("en-KE")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orders.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">
            Orders & results
          </h3>
          <ul className="flex flex-col gap-2">
            {orders.map((o) => (
              <li
                key={o.id}
                className="rounded-lg border border-zinc-200 p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">
                    {o.type === "prescription" ? "Prescription" : o.title}
                    <span className="ml-2 text-xs font-normal text-zinc-400">
                      {o.type}
                    </span>
                  </span>
                  <StatusBadge status={o.status} />
                </div>
                {o.results && o.results.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5 rounded bg-green-50 p-2 text-xs text-green-900">
                    {o.results.map((r) => (
                      <li key={r.parameter} className="flex justify-between gap-3">
                        <span>{r.parameter}</span>
                        <span
                          className={cn(
                            "tabular-nums",
                            r.flag === "high" && "font-semibold text-red-600",
                            r.flag === "low" && "font-semibold text-amber-600",
                          )}
                        >
                          {r.value}
                          {r.flag && r.flag !== "normal" ? ` (${r.flag})` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {o.result && (
                  <p className="mt-2 rounded bg-green-50 p-2 text-xs text-green-800">
                    Result: {o.result}
                  </p>
                )}
                {o.meds && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600">
                    {o.meds.map((m) => (
                      <li key={m.id}>
                        {m.name} — {m.dosage}, {m.frequency}, {m.duration}
                        {m.quantity ? ` · give ${m.quantity}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visit.status !== "waiting" && visit.status !== "completed" && (
        <div className="mt-5 border-t border-zinc-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">
            Next step
          </h3>
          <div className="mb-4 flex gap-2">
            <QueueTab
              label="Send for tests"
              active={mode === "services"}
              onClick={() => setMode("services")}
            />
            <QueueTab
              label="Prescribe medicine"
              active={mode === "prescribe"}
              onClick={() => setMode("prescribe")}
            />
          </div>

          {mode === "services" ? (
            <ServiceOrderForm visitId={visitId} />
          ) : (
            <>
              <PrescriptionForm
                visitId={visitId}
                meds={medDrafts}
                setMeds={setMedDrafts}
              />
              <div className="mt-5 border-t border-zinc-100 pt-4">
                {finalizeError && (
                  <p className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                    {finalizeError}
                  </p>
                )}
                {/* Every patient leaves through the pharmacy, prescription or
                    not — it is the pay point, and in pay-at-end billing the
                    consultation and any tests are still owed there. */}
                <Button
                  disabled={!canFinalize}
                  onClick={finalizeAndSendToPharmacy}
                  className="w-full"
                >
                  {finalizing
                    ? "Sending…"
                    : pendingServices.length > 0
                      ? "Waiting for service results…"
                      : completeDrafts.length > 0
                        ? "Save prescription & send to pharmacy"
                        : hasPrescription
                          ? "Finalize & send to pharmacy"
                          : "Finalize & send to pharmacy to settle up"}
                </Button>
                {canFinalize && !hasPrescription && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Nothing prescribed — the pharmacy desk collects whatever is
                    still owed and closes the visit.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ComplaintEditor({
  initial,
  text,
  onTextChange,
  onSave,
}: {
  initial: string;
  text: string;
  onTextChange: (value: string) => void;
  onSave: () => void;
}) {
  const dirty = text.trim() !== initial.trim();
  const entries = text.split("\n");

  const updateEntry = (index: number, value: string) => {
    onTextChange(
      entries
        .map((entry, entryIndex) =>
          entryIndex === index ? value : entry,
        )
        .join("\n"),
    );
  };

  const removeEntry = (index: number) => {
    const next = entries.filter((_, entryIndex) => entryIndex !== index);
    onTextChange(next.length > 0 ? next.join("\n") : "");
  };

  // Persist whenever the doctor is done with the field (blur), not only on an
  // explicit Save — otherwise the complaint is lost when they type it and go
  // straight to ordering a lab/procedure.
  const save = () => onSave();

  return (
    <Field label="Complaint / history (recorded by doctor)">
      <div className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <div key={index} className="flex gap-2">
            <input
              className={`${inputClass} flex-1`}
              placeholder={
                index === 0
                  ? "e.g. Fever and headache for 3 days"
                  : "Add another complaint or history note"
              }
              value={entry}
              onChange={(e) => updateEntry(index, e.target.value)}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            {entries.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                title="Remove entry"
                aria-label={`Remove complaint or history entry ${index + 1}`}
                onClick={() => removeEntry(index)}
              >
                <Trash2Icon className="size-4" />
              </Button>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onTextChange(text ? `${text}\n` : "\n")}
          >
            <PlusIcon className="size-4" />
            Add entry
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty}
            onClick={save}
          >
            Save
          </Button>
        </div>
      </div>
    </Field>
  );
}

/** Services are ordered off the priced catalog rather than typed free-hand:
 *  the price is what the patient will be charged, so the doctor sees the cost
 *  of what they are ordering before they order it. */
function ServiceOrderForm({ visitId }: { visitId: string }) {
  const data = useClinic();
  const [type, setType] = useState<Exclude<OrderType, "prescription">>("lab");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  const available = data.serviceCatalog.filter((s) => s.orderType === type);
  const selected = data.serviceCatalog.filter((s) => selectedIds.includes(s.id));
  const total = selected.reduce((sum, item) => sum + item.price, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    setBusy(true);
    const error = await addServiceOrders(visitId, selectedIds, instructions);
    setBusy(false);
    if (error) return;
    setSelectedIds([]);
    setInstructions("");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-zinc-700">Order a service</h3>
      <Field label="Department">
        <select
          className={inputClass}
          value={type}
          onChange={(e) => {
            setType(e.target.value as typeof type);
            setSelectedIds([]);
          }}
        >
          <option value="lab">Lab</option>
          <option value="radiology">Radiology</option>
          <option value="procedure">Procedure</option>
        </select>
      </Field>
      <Field label="Select all required tests / procedures">
        {available.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Nothing in the catalog for this department yet — an admin adds
            these under Service catalog.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((s) => (
              <label key={s.id} className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm",
                selectedIds.includes(s.id) ? "border-teal-500 bg-teal-50" : "border-zinc-200 bg-white",
              )}>
                <input
                  type="checkbox"
                  className="mt-1 accent-teal-700"
                  checked={selectedIds.includes(s.id)}
                  onChange={() => setSelectedIds((ids) =>
                    ids.includes(s.id) ? ids.filter((id) => id !== s.id) : [...ids, s.id]
                  )}
                />
                <span><strong>{s.name}</strong><span className="block text-xs text-zinc-500">{s.price > 0 ? `KSh ${s.price.toLocaleString("en-KE")}` : "Free"}</span></span>
              </label>
            ))}
          </div>
        )}
      </Field>
      <Field label="Instructions (optional)">
        <input
          className={inputClass}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      {selected.length > 0 && (
        <p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">
          <strong>{selected.length} selected</strong> · Total charge KSh {total.toLocaleString("en-KE")}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={selectedIds.length === 0 || busy}>
        {busy ? "Sending requests…" : `Send ${selectedIds.length || ""} request${selectedIds.length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}

/** A medicine line being written. `qtyEdited` marks that the doctor typed the
 *  quantity themselves, so it stops following the dosage/frequency/duration. */
type MedDraft = Omit<Med, "id" | "dispensed"> & { qtyEdited?: boolean };
const blankMed: MedDraft = {
  name: "",
  dosage: "",
  frequency: "",
  duration: "",
};

const isDraftStarted = (m: MedDraft) =>
  !!(m.medicineId || m.dosage.trim() || m.frequency.trim() || m.duration.trim() || m.quantity);
const isDraftComplete = (m: MedDraft) =>
  !!(m.medicineId && m.name.trim() && m.dosage.trim() && m.frequency.trim() && m.duration.trim()) &&
  Number.isInteger(m.quantity) &&
  (m.quantity ?? 0) >= 1;
const toMedInput = (draft: MedDraft): Omit<Med, "id" | "dispensed"> => {
  const m = { ...draft };
  delete m.qtyEdited; // UI-only flag
  return m;
};

/** Doses per day from free-text frequency: "twice daily", "BD", "3x", "every 8 hours". */
function dosesPerDay(frequency: string): number | null {
  const f = frequency.toLowerCase();
  const everyHours = f.match(/every\s*(\d+)\s*(h|hr|hrs|hour|hours)\b/);
  if (everyHours) return Math.max(1, Math.round(24 / Number(everyHours[1])));
  if (/\b(qid|qds|four times|4\s*x|x\s*4)\b/.test(f)) return 4;
  if (/\b(tds|tid|thrice|three times|3\s*x|x\s*3)\b/.test(f)) return 3;
  if (/\b(bd|bid|twice|two times|2\s*x|x\s*2)\b/.test(f)) return 2;
  if (/\b(od|once|daily|nocte|mane|1\s*x|x\s*1)\b/.test(f)) return 1;
  return null;
}

/** Days from free-text duration: "5 days", "1 week", "2/52", or a bare "5". */
function durationDays(duration: string): number | null {
  const d = duration.toLowerCase().trim();
  const m = d.match(/(\d+)\s*(d|day|days|w|wk|wks|week|weeks|\/52|m|month|months|\/12)?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "d";
  if (/^(w|wk|wks|week|weeks|\/52)$/.test(unit)) return n * 7;
  if (/^(m|month|months|\/12)$/.test(unit)) return n * 30;
  return n;
}

/** Suggested units to dispense. Only countable forms (tablets, capsules…) are
 *  multiplied out; a syrup, cream or inhaler defaults to one pack. */
function suggestQuantity(m: MedDraft, form: string | undefined): number | null {
  const countable = /tab|cap|sachet|pessar|suppos/i.test(form ?? "");
  if (!countable) return m.medicineId ? 1 : null;
  const perDay = dosesPerDay(m.frequency);
  const days = durationDays(m.duration);
  if (!perDay || !days) return null;
  // "2 tabs" → 2 per dose; "500mg" → 1 per dose
  const perDose = Number(m.dosage.match(/^\s*(\d+(?:\.\d+)?)\s*(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|sachet|sachets)\b/i)?.[1] ?? 1);
  return Math.ceil(perDose * perDay * days);
}

function PrescriptionForm({
  visitId,
  meds,
  setMeds,
}: {
  visitId: string;
  meds: MedDraft[];
  setMeds: React.Dispatch<React.SetStateAction<MedDraft[]>>;
}) {
  const data = useClinic();
  const [busy, setBusy] = useState(false);
  const formOf = (id?: string) => data.medicines.find((x) => x.id === id)?.form;

  // Apply a change, then re-suggest the quantity unless the doctor set it by hand.
  const change = (i: number, patch: Partial<MedDraft>) =>
    setMeds((list) =>
      list.map((m, idx) => {
        if (idx !== i) return m;
        const next = { ...m, ...patch };
        if (!next.qtyEdited) next.quantity = suggestQuantity(next, formOf(next.medicineId)) ?? undefined;
        return next;
      }),
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = meds.filter(isDraftComplete);
    if (valid.length === 0) return;
    setBusy(true);
    const { error } = await addPrescription(visitId, valid.map(toMedInput));
    setBusy(false);
    if (!error) setMeds([{ ...blankMed }]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-zinc-700">Prescribe</h3>
      <p className="-mt-2 text-xs text-zinc-500">
        The pharmacy hands over exactly what you write here, including the quantity.
      </p>
      {meds.map((m, i) => {
        const stock = data.medicines.find((x) => x.id === m.medicineId)?.stock;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3">
            <div className="flex gap-2">
              <select
                className={`${inputClass} flex-1`}
                value={m.medicineId ?? ""}
                onChange={(e) => {
                  const item = data.medicines.find((medicine) => medicine.id === e.target.value);
                  change(i, {
                    medicineId: item?.id,
                    name: item ? `${item.name} ${item.strength}`.trim() : "",
                  });
                }}
              >
                <option value="">Choose medicine…</option>
                {data.medicines.map((medicine) => (
                  <option key={medicine.id} value={medicine.id} disabled={medicine.stock <= 0}>
                    {medicine.name} {medicine.strength} · {medicine.stock > 0 ? `${medicine.stock} in stock` : "out of stock"}
                  </option>
                ))}
              </select>
              {meds.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove medicine line ${i + 1}`}
                  onClick={() => setMeds((list) => list.filter((_, idx) => idx !== i))}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input
                className={inputClass}
                placeholder="Dosage e.g. 2 tabs"
                value={m.dosage}
                onChange={(e) => change(i, { dosage: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Frequency e.g. twice daily"
                value={m.frequency}
                onChange={(e) => change(i, { frequency: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Duration e.g. 5 days"
                value={m.duration}
                onChange={(e) => change(i, { duration: e.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                min={1}
                step={1}
                placeholder="Quantity"
                aria-label="Quantity to dispense"
                value={m.quantity ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Clearing the box hands control back to the automatic suggestion.
                  if (raw === "") change(i, { qtyEdited: false });
                  else change(i, { quantity: Math.max(0, Math.floor(Number(raw))), qtyEdited: true });
                }}
              />
            </div>
            {m.quantity != null && stock != null && m.quantity > stock && (
              <p className="text-xs text-amber-700">
                Only {stock} in stock — the pharmacy can give at most that many.
              </p>
            )}
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMeds((l) => [...l, { ...blankMed }])}
        >
          + Add medicine
        </Button>
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !meds.some(isDraftComplete)}>
          {busy ? "Saving…" : "Save prescription"}
        </Button>
      </div>
    </form>
  );
}

