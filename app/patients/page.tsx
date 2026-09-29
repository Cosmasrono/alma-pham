"use client";

import { useState } from "react";
import { Search, UserRound } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useClinic } from "@/lib/store";
import {
  Card,
  EmptyState,
  LocationBadge,
  PageHeader,
  PriorityBadge,
  StayBadge,
  inputClass,
} from "@/components/ui";
import { VisitTimeline } from "@/components/VisitTimeline";
import {
  doctorMap,
  doctorName,
  ordersForVisit,
  paymentsOf,
  patientName,
  searchPatients,
  visitLocation,
  visitTiming,
  visitsForPatient,
} from "@/lib/selectors";

export default function PatientsPage() {
  const data = useClinic();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = searchPatients(data, query);
  const selected = data.patients.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Search the register and review a patient's full visit history"
      />

      <div className="relative mb-5">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-zinc-400" />
      <input
        aria-label="Search patients by name, national ID or MRN"
        className={`${inputClass} w-full pl-10`}
        placeholder="Search by name, national ID or MRN…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">
            {results.length} patient{results.length === 1 ? "" : "s"}
          </h2>
          {results.length === 0 ? (
            <EmptyState>No matching patients.</EmptyState>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                aria-pressed={selectedId === p.id}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selectedId === p.id
                    ? "border-teal-500 bg-teal-50 dark:bg-teal-950/60 ring-1 ring-teal-500/20"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <p className="text-sm font-medium">{patientName(p)}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {p.mrn} · ID {p.nationalId || "—"} · {p.gender}, {p.age}y
                </p>
              </button>
            ))
          )}
        </div>

        <div>
          {selected ? (
            <PatientHistory key={selected.id} patientId={selected.id} />
          ) : (
            <EmptyState>Select a patient to see their history.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function PatientHistory({ patientId }: { patientId: string }) {
  const data = useClinic();
  const dmap = doctorMap(data);
  const patient = data.patients.find((p) => p.id === patientId);
  const visits = visitsForPatient(data, patientId);
  const prescriptions = visits.flatMap((visit) => ordersForVisit(data, visit.id).filter((order) => order.type === "prescription"));
  const payments = visits.flatMap((visit) => paymentsOf(visit));
  if (!patient) return null;

  return (
    <Card>
      <div className="mb-5 flex items-center gap-3 border-b border-zinc-100 pb-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><UserRound aria-hidden="true" className="size-6" /></span>
      <div>
      <h2 className="text-lg font-semibold">{patientName(patient)}</h2>
      <p className="text-sm text-zinc-500">
        {patient.mrn} · ID {patient.nationalId || "—"} · {patient.gender},{" "}
        {patient.age}y · {patient.phone || "no phone"}
      </p>
      </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList aria-label="Patient record sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="visits">Visits</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ["Medical record", patient.mrn],
              ["Phone", patient.phone || "Not recorded"],
              ["National ID", patient.nationalId || "Not recorded"],
              ["Age / gender", `${patient.age} years · ${patient.gender}`],
              ["Recorded visits", String(visits.length)],
              ["Total paid", `KSh ${payments.reduce((total, payment) => total + payment.amount, 0).toLocaleString("en-KE")}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4">
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">{value}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="visits">

      <h3 className="mb-2 mt-5 text-sm font-semibold text-zinc-700">
        Visit history ({visits.length})
      </h3>
      {visits.length === 0 ? (
        <EmptyState>No visits recorded.</EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {visits.map((v) => {
            const orders = ordersForVisit(data, v.id);
            const doctor = v.assignedDoctorId
              ? dmap.get(v.assignedDoctorId)
              : undefined;
            return (
              <li
                key={v.id}
                className="rounded-lg border border-zinc-200 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                  <LocationBadge location={visitLocation(data, v)} />
                  {v.priority && <PriorityBadge priority={v.priority} />}
                  <StayBadge timing={visitTiming(v)} />
                  <span className="text-xs text-zinc-500">
                    {doctorName(doctor)}
                  </span>
                </div>

                <VisitTimeline visit={v} />

                <p className="mt-2 text-zinc-600">
                  <span className="font-medium text-zinc-700">Complaint: </span>
                  {v.complaint || "—"}
                </p>
                <p className="text-xs text-zinc-500">
                  Vitals: {v.vitals?.weight || "—"} kg ·{" "}
                  {v.vitals?.temperature || "—"} °C ·{" "}
                  {v.vitals?.bloodPressure || "—"}
                </p>
                {v.payment && (
                  <p className="text-xs text-zinc-500">
                    Paid: KSh {v.payment.amount.toLocaleString()} ·{" "}
                    {v.payment.method}
                    {v.payment.reference ? ` (${v.payment.reference})` : ""}
                  </p>
                )}

                {orders.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600">
                    {orders.map((o) => (
                      <li key={o.id}>
                        <span className="capitalize">{o.type}</span>:{" "}
                        {o.type === "prescription"
                          ? (o.meds ?? []).map((m) => m.name).join(", ") || "—"
                          : `${o.title}${o.result ? ` — ${o.result}` : ""}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
        </TabsContent>
        <TabsContent value="prescriptions">
          {prescriptions.length === 0 ? <EmptyState>No prescriptions recorded.</EmptyState> : (
            <ul className="space-y-3">
              {prescriptions.map((order) => (
                <li key={order.id} className="rounded-lg border border-zinc-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{new Date(order.createdAt).toLocaleDateString("en-KE")}</span>
                    <span className="capitalize">{order.status.replace(/-/g, " ")}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{(order.meds ?? []).map((med) => med.name).join(", ") || order.title}</p>
                  {order.instructions && <p className="mt-1 text-sm text-zinc-600">{order.instructions}</p>}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="payments">
          {payments.length === 0 ? <EmptyState>No payments recorded.</EmptyState> : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Patient payment history</caption>
                <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th scope="col" className="px-3">Date</th><th scope="col" className="px-3">Method</th><th scope="col" className="px-3">Reference</th><th scope="col" className="px-3 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {payments.map((payment, index) => <tr key={`${payment.paidAt}-${index}`}><td className="whitespace-nowrap px-3 py-3">{new Date(payment.paidAt).toLocaleDateString("en-KE")}</td><td className="px-3 py-3 capitalize">{payment.method === "mpesa" ? "M-Pesa" : payment.method}</td><td className="px-3 py-3">{payment.reference || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">KSh {payment.amount.toLocaleString("en-KE")}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
