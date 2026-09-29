"use client";

import { useState } from "react";
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

      <input
        className={`${inputClass} mb-4 w-full`}
        placeholder="Search by name, national ID or MRN…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

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
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selectedId === p.id
                    ? "border-teal-500 bg-teal-50"
                    : "border-zinc-200 bg-white hover:border-zinc-300"
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
            <PatientHistory patientId={selected.id} />
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
  if (!patient) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold">{patientName(patient)}</h2>
      <p className="text-sm text-zinc-500">
        {patient.mrn} · ID {patient.nationalId || "—"} · {patient.gender},{" "}
        {patient.age}y · {patient.phone || "no phone"}
      </p>

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
    </Card>
  );
}
