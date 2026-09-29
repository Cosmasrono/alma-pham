"use client";

// The priced service catalog: every lab test, scan and procedure the clinic
// offers. Doctors order from this list, so a row's price is what the patient
// gets charged, and a lab row's parameters are the panel the technician fills
// in. Re-pricing a row never touches charges already raised.

import { useState } from "react";
import { addServiceItem, updateServiceItem, useClinic } from "@/lib/store";
import type { LabParameter, OrderType, ServiceItem } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  cn,
  inputClass,
} from "@/components/ui";

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

type Department = Exclude<OrderType, "prescription">;

const DEPARTMENTS: { key: Department; label: string }[] = [
  { key: "lab", label: "Lab" },
  { key: "radiology", label: "Radiology" },
  { key: "procedure", label: "Procedure" },
];

// Lab categories group the catalog the way a request form does; imaging and
// procedures only ever use their own bucket.
const CATEGORIES = [
  "haematology",
  "biochemistry",
  "microbiology",
  "serology",
  "urinalysis",
  "imaging",
  "other",
];

export default function ServiceCatalogPage() {
  const data = useClinic();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState<Department | "all">("all");

  const q = search.trim().toLowerCase();
  const items = data.serviceCatalog.filter(
    (s) =>
      (dept === "all" || s.orderType === dept) &&
      (!q ||
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)),
  );

  return (
    <div>
      <PageHeader
        title="Service catalog"
        subtitle="What the clinic offers and what each costs. Doctors order from this list and the price becomes the patient's charge."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} min-w-[220px] flex-1`}
              placeholder="Search by name or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {(["all", ...DEPARTMENTS.map((d) => d.key)] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setDept(key as Department | "all")}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  dept === key
                    ? "bg-teal-600 text-white"
                    : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {key === "all"
                  ? "All"
                  : DEPARTMENTS.find((d) => d.key === key)?.label}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <EmptyState>
              {data.serviceCatalog.length === 0
                ? "The catalog is empty — add your first service."
                : "No services match your search."}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Service</th>
                      <th className="px-4 py-2 font-medium">Department</th>
                      <th className="px-4 py-2 font-medium">Price</th>
                      <th className="px-4 py-2 font-medium">Offered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => (
                      <ServiceRow key={`${s.id}-${s.price}-${s.active}`} item={s} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <AddServiceForm />
      </div>
    </div>
  );
}

/** One catalog row. Price is edited in place and saved on blur (or Enter),
 *  matching how the medicine catalog behaves. */
function ServiceRow({ item }: { item: ServiceItem }) {
  const [price, setPrice] = useState(String(item.price));
  const [error, setError] = useState<string | null>(null);

  const save = async (changes?: { active?: boolean }) => {
    setError(null);
    const next = Number(price);
    if (!changes && next === item.price) return;
    const err = await updateServiceItem({
      id: item.id,
      name: item.name,
      orderType: item.orderType,
      category: item.category,
      price: next,
      parameters: item.parameters,
      ...changes,
    });
    if (err) setError(err);
  };

  return (
    <tr className="border-t border-zinc-100">
      <td className="px-4 py-2">
        <span className="font-medium">{item.name}</span>
        <p className="text-xs capitalize text-zinc-500">
          {item.category}
          {item.parameters.length > 0 &&
            ` · ${item.parameters.length} parameter${
              item.parameters.length === 1 ? "" : "s"
            }`}
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-4 py-2 capitalize text-zinc-600">{item.orderType}</td>
      <td className="px-4 py-2">
        <input
          className={`${inputClass} h-8 w-28`}
          type="number"
          min="0"
          step="50"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => save()}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
          aria-label={`Price of ${item.name}`}
        />
        <p className="mt-1 text-xs text-zinc-400">
          {item.price > 0 ? money(item.price) : "Free"}
        </p>
      </td>
      <td className="px-4 py-2">
        <Button
          size="sm"
          variant={item.active ? "secondary" : "ghost"}
          onClick={() => save({ active: !item.active })}
        >
          {item.active ? "Offered" : "Retired"}
        </Button>
      </td>
    </tr>
  );
}

const emptyForm = {
  name: "",
  orderType: "lab" as Department,
  category: "haematology",
  price: "",
};

function AddServiceForm() {
  const [form, setForm] = useState(emptyForm);
  // One parameter per line, "Name | unit | low | high" — a full editor would
  // be a lot of UI for something an admin sets up once per test.
  const [panel, setPanel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const parsePanel = (): LabParameter[] =>
    panel
      .split("\n")
      .map((line) => line.split("|").map((p) => p.trim()))
      .filter((parts) => parts[0])
      .map((parts) => ({
        name: parts[0],
        unit: parts[1] ?? "",
        refLow: parts[2] !== undefined && parts[2] !== "" ? Number(parts[2]) : undefined,
        refHigh: parts[3] !== undefined && parts[3] !== "" ? Number(parts[3]) : undefined,
      }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const err = await addServiceItem({
      name: form.name,
      orderType: form.orderType,
      category: form.category,
      price: Number(form.price) || 0,
      parameters: form.orderType === "lab" ? parsePanel() : [],
    });
    if (err) {
      setError(err);
      return;
    }
    setSaved(`${form.name} added.`);
    setForm(emptyForm);
    setPanel("");
  };

  return (
    <Card className="h-fit">
      <h2 className="mb-3 text-sm font-semibold text-zinc-700">Add a service</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <input
            className={inputClass}
            placeholder="e.g. Full haemogram (CBC)"
            value={form.name}
            onChange={set("name")}
          />
        </Field>
        <Field label="Department">
          <select
            className={inputClass}
            value={form.orderType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                orderType: e.target.value as Department,
                // Imaging never belongs to a lab bench category.
                category: e.target.value === "radiology" ? "imaging" : f.category,
              }))
            }
          >
            {DEPARTMENTS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            className={inputClass}
            value={form.category}
            onChange={set("category")}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price (Ksh)">
          <input
            className={inputClass}
            type="number"
            min="0"
            step="50"
            placeholder="0 for a free service"
            value={form.price}
            onChange={set("price")}
          />
        </Field>

        {form.orderType === "lab" && (
          <Field label="Result parameters (one per line)">
            <textarea
              className={`${inputClass} h-28 w-full py-2 font-mono text-xs`}
              placeholder={"WBC | 10^9/L | 4 | 11\nHaemoglobin | g/dL | 12 | 16\nResult |"}
              value={panel}
              onChange={(e) => setPanel(e.target.value)}
            />
            <p className="mt-1 text-xs text-zinc-500">
              Name | unit | low | high. Leave the range blank for qualitative
              results like positive / negative.
            </p>
          </Field>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800">
            {saved}
          </p>
        )}

        <Button type="submit" disabled={!form.name.trim()}>
          Add to catalog
        </Button>
      </form>
    </Card>
  );
}
