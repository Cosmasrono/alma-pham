"use client";

// Clinic-wide settings: billing mode + consultation fee. Admin only.
// The billing mode toggle only affects visits opened after the change; visits
// already in-flight keep the mode snapshotted at their check-in.

import { useState } from "react";
import {
  Button,
  Card,
  Field,
  PageHeader,
  Spinner,
  inputClass,
} from "@/components/ui";
import { useClinic, updateSettings } from "@/lib/store";
import { notify } from "@/lib/toast";
import type { BillingMode, ClinicSettings } from "@/lib/types";

export default function SettingsPage() {
  const settings = useClinic().settings;

  // The store serves a placeholder until /api/clinic lands — settings will have
  // an empty id. The form is only mounted once real settings exist, so its
  // useState initializers seed from them rather than from the placeholder.
  if (settings.id === "") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return <SettingsForm key={settings.id} settings={settings} />;
}

function SettingsForm({ settings }: { settings: ClinicSettings }) {
  const [billingMode, setBillingMode] = useState<BillingMode>(
    settings.billingMode,
  );
  const [consultationFee, setConsultationFee] = useState(
    String(settings.consultationFee ?? 0),
  );
  const [saving, setSaving] = useState(false);

  const dirty =
    billingMode !== settings.billingMode ||
    Number(consultationFee) !== settings.consultationFee;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const fee = Number(consultationFee);
    // A blank input coerces to 0 — reject it rather than silently zeroing the
    // fee for someone who cleared the box mid-edit.
    if (consultationFee.trim() === "" || !Number.isFinite(fee) || fee < 0) {
      notify("error", "Consultation fee must be zero or a positive number.");
      return;
    }
    setSaving(true);
    // The store already toasts on failure; nothing extra to report here.
    await updateSettings({ billingMode, consultationFee: fee });
    setSaving(false);
  }

  return (
    <>
      <PageHeader
        title="Clinic settings"
        subtitle="How the clinic charges patients and what the consultation costs."
      />

      <Card className="max-w-2xl">
        <form onSubmit={save} className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-zinc-700">
              Billing mode
            </legend>
            <p className="text-sm text-zinc-500">
              Changing this only affects new visits — anyone already in the
              queue finishes under the mode they checked in with.
            </p>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-teal-500">
              <input
                type="radio"
                name="billing-mode"
                className="mt-1 h-4 w-4 accent-teal-600"
                checked={billingMode === "per-stage"}
                onChange={() => setBillingMode("per-stage")}
              />
              <div>
                <div className="font-medium text-zinc-900">
                  Pay per stage
                </div>
                <p className="text-sm text-zinc-500">
                  Patient pays the consultation fee before seeing the doctor,
                  lab fees before the tests are run, and medicines at pharmacy
                  checkout.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-teal-500">
              <input
                type="radio"
                name="billing-mode"
                className="mt-1 h-4 w-4 accent-teal-600"
                checked={billingMode === "pay-at-end"}
                onChange={() => setBillingMode("pay-at-end")}
              />
              <div>
                <div className="font-medium text-zinc-900">
                  Pay all at pharmacy
                </div>
                <p className="text-sm text-zinc-500">
                  Charges accumulate as the patient moves through consultation,
                  labs and pharmacy — one payment covers everything at the end.
                </p>
              </div>
            </label>
          </fieldset>

          <Field label="Consultation fee (Ksh)">
            <input
              type="number"
              min={0}
              step={50}
              className={inputClass}
              value={consultationFee}
              onChange={(e) => setConsultationFee(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
            <p className="text-xs text-zinc-500">
              Last updated{" "}
              {new Date(settings.updatedAt).toLocaleString("en-KE")}
            </p>
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
