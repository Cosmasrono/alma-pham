// Public landing page — the only page reachable without a session. Staff sign
// in via the header button; everything else stays behind the middleware.

import Image from "next/image";
import Link from "next/link";
import {
  Stethoscope,
  FlaskConical,
  Pill,
  Clock,
  Banknote,
  UserCheck,
  Footprints,
  ClipboardList,
  MapPin,
  Wallet,
  Ambulance,
  Shield,
  Phone,
  Star,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { DemoVideo } from "@/components/DemoVideo";
import { MobileNav } from "@/components/MobileNav";
import { ThemeToggle } from "@/components/ThemeProvider";
import { PREMISES_REG_NO } from "@/lib/brand";

const NAV_LINKS: [href: string, label: string][] = [
  ["#services", "Services"],
  ["#visit", "Your Visit"],
  ["#demo", "Demo"],
  ["#contact", "Contact"],
];

// The walkthrough that plays in the "See Amla Medicare in action" section.
const DEMO_VIDEO_ID = "Z0E-YOhU7tE";

// WhatsApp contact number — update to the clinic's real number
const WHATSAPP_NUMBER = "254796268600";
const WHATSAPP_MESSAGE = encodeURIComponent(
  "Hello Amla Medicare! I would like to book an appointment or get more information about your services."
);
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`;

const SERVICES: { title: string; text: string; img: string; alt: string; Icon: LucideIcon }[] = [
  {
    title: "Consultation & Diagnosis",
    text: "Experienced doctors review your history, examine you and walk you through every result on screen.",
    img: "/images/consultation.jpg",
    alt: "Doctor discussing scan results with a patient",
    Icon: Stethoscope,
  },
  {
    title: "Laboratory",
    text: "An on-site lab runs your samples the same day, so treatment starts without the wait.",
    img: "/images/lab.jpg",
    alt: "Laboratory technician pipetting samples",
    Icon: FlaskConical,
  },
  {
    title: "In-house Pharmacy & Community Pharmacy",
    text: "Our in-house pharmacy serves clinic patients, while our community pharmacy welcomes walk-in customers for prescriptions and everyday medicine needs.",
    img: "/images/amla-pharmacy.jpg",
    alt: "Well-stocked medicine shelves at the Amla Medicare pharmacy",
    Icon: Pill,
  },
];

const FLOW: { step: string; label: string; text: string; color: string; Icon: LucideIcon }[] = [
  {
    step: "01",
    label: "Reception",
    text: "Register and get triaged by a nurse in minutes — no long queues.",
    color: "from-teal-400 to-teal-600",
    Icon: ClipboardList,
  },
  {
    step: "02",
    label: "Doctor",
    text: "Consultation, clinical exams and specialist orders on a single record.",
    color: "from-teal-500 to-teal-700",
    Icon: Stethoscope,
  },
  {
    step: "03",
    label: "Lab / Radiology",
    text: "Tests and imaging done on site, results back to your doctor instantly.",
    color: "from-teal-600 to-teal-800",
    Icon: FlaskConical,
  },
  {
    step: "04",
    label: "Pharmacy",
    text: "Collect your medication and go home — zero extra trips or paperwork.",
    color: "from-teal-700 to-teal-900",
    Icon: Pill,
  },
];

const TESTIMONIALS = [
  {
    quote:
      "From registration to picking up my medication — one morning. I've never experienced anything like it.",
    name: "Amina K.",
    role: "Patient",
    initials: "AK",
  },
  {
    quote:
      "The lab results were ready before I even finished talking to the doctor. Incredible speed.",
    name: "James M.",
    role: "Patient",
    initials: "JM",
  },
  {
    quote:
      "Clean, organised and the staff genuinely care. My whole family comes here now.",
    name: "Grace W.",
    role: "Patient",
    initials: "GW",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen text-zinc-900 dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-teal-950/5 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandLogo />
            <div>
              <p className="font-display text-base font-semibold leading-tight text-teal-950 dark:text-white">
                Amla Medicare
              </p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-teal-600 dark:text-teal-400">
                Clinic &amp; Diagnostics
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-500 sm:flex dark:text-zinc-400">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="relative transition-colors hover:text-teal-700 dark:hover:text-teal-400 after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0 after:bg-teal-600 after:transition-all hover:after:w-full"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle size="sm" className="border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" />
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden h-9 items-center gap-2 rounded-full border border-[#25D366]/40 bg-[#25D366]/10 px-4 text-sm font-medium text-[#128C7E] transition-colors hover:bg-[#25D366]/20 sm:inline-flex"
            >
              <WhatsAppIcon className="h-4 w-4" />
              WhatsApp
            </a>
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-full bg-teal-700 px-4 text-sm font-medium text-white shadow-sm shadow-teal-950/20 transition-colors hover:bg-teal-800"
            >
              Staff sign in
            </Link>
            <MobileNav links={NAV_LINKS} />
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-white/60 dark:bg-zinc-950/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute -right-32 -top-32 h-[600px] w-[600px] rounded-full bg-teal-50 opacity-60 blur-3xl" />
          <div className="absolute -bottom-20 left-0 h-[400px] w-[400px] rounded-full bg-teal-100/40 blur-3xl" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-teal-950 sm:text-[3.25rem] sm:leading-[1.07]">
              <span className="block">Amla-Medicare Ltd</span>
              <span className="block text-teal-700">Pharmacy</span>
              <span className="block text-teal-700">Clinic &amp; Diagnostics</span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-7 text-zinc-500">
              Amla Medicare is a full-service outpatient clinic at Kanduma Centre, Kikuyu. One
              visit covers your consultation, lab work, imaging and medication —
              no referrals, no second trips, no losing your file between
              departments.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-2.5 rounded-full bg-[#25D366] px-6 text-sm font-semibold text-white shadow-lg shadow-[#25D366]/30 transition-all hover:bg-[#1fad54] hover:shadow-[#25D366]/40 hover:-translate-y-0.5"
              >
                <WhatsAppIcon className="h-5 w-5" />
                Chat on WhatsApp
              </a>
              <a
                href="#services"
                className="inline-flex h-12 items-center rounded-full border border-border bg-card px-6 text-sm font-medium text-foreground shadow-sm transition-all hover:border-teal-700/30 hover:bg-teal-50/80 dark:hover:bg-teal-950/60 hover:text-teal-900 dark:hover:text-teal-200 hover:-translate-y-0.5"
              >
                Our services
              </a>
            </div>

            <dl className="mt-10 grid max-w-sm grid-cols-3 gap-3">
              {[
                ["7", "days a week"],
                ["6+", "departments"],
                ["1", "visit, start to finish"],
              ].map(([n, label]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-border bg-card p-3 text-center shadow-sm"
                >
                  <dt className="font-display text-2xl font-bold text-teal-700 dark:text-teal-400">
                    {n}
                  </dt>
                  <dd className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-3xl shadow-2xl shadow-teal-950/20 ring-1 ring-teal-950/10">
              <Image
                src="/images/amla-storefront-hero.jpg"
                alt="Amla Medical Centre storefront with its sign, outpatient services list and patients at the pharmacy counter"
                width={1199}
                height={1312}
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-linear-to-t from-teal-950/20 via-transparent to-transparent" />
            </div>

            <div className="absolute -bottom-5 -left-5 hidden rounded-2xl border border-border bg-card/90 backdrop-blur-md p-3 shadow-xl shadow-black/20 sm:block">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-700">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Fully Licensed
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Govt. regulated facility
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <div className="border-y border-teal-950/5 bg-[#f3f8f7]/70 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-8 px-4 py-5 sm:px-6">
          {([
            { Icon: Clock,         label: "Same-day results" },
            { Icon: Banknote,      label: "M-Pesa & cash accepted" },
            { Icon: UserCheck,     label: "Specialist doctors on site" },
            { Icon: Footprints,    label: "Walk-ins always welcome" },
            { Icon: ClipboardList, label: "Digital patient records" },
          ] as { Icon: LucideIcon; label: string }[]).map(({ Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-sm text-teal-900">
              <Icon className="h-4 w-4 text-teal-600" />
              <span className="font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <section id="services" className="bg-white/60 dark:bg-zinc-950/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 dark:bg-teal-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              Departments
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Everything under one roof
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Each department hands your visit to the next automatically — you
              never carry paperwork around the building.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <article
                key={s.title}
                className="group overflow-hidden rounded-3xl border border-border bg-card shadow-[0_1px_2px_rgb(4_47_43/0.04),0_12px_32px_-16px_rgb(4_47_43/0.14)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_4px_8px_rgb(4_47_43/0.07),0_24px_48px_-16px_rgb(4_47_43/0.22)]"
              >
                <div className="relative h-48 overflow-hidden">
                  <Image
                    src={s.img}
                    alt={s.alt}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-teal-950/60 via-transparent to-transparent" />
                  <span className="absolute bottom-3 left-3 grid h-9 w-9 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
                    <s.Icon className="h-5 w-5 text-white" />
                  </span>
                </div>
                <div className="p-5">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="premises" className="bg-transparent">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="overflow-hidden rounded-3xl shadow-2xl shadow-teal-950/15 ring-1 ring-teal-950/10">
            <Image
              src="/images/amla-storefront-hero.jpg"
              alt="Amla Medical Centre storefront with its sign and list of outpatient services, patients at the pharmacy counter"
              width={1199}
              height={1312}
              sizes="(max-width: 1024px) 100vw, 60vw"
              className="aspect-4/3 h-full w-full object-cover object-[50%_40%]"
            />
          </div>
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-600/30">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              Visit us
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground">
              Amla Medical Centre
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Walk in for outpatient care: pharmacy, consultation, immunization,
              blood pressure and diabetic clinics,
              family planning and counselling. Pay by M-Pesa or cash.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-teal-900 dark:text-teal-300">
              <Shield className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              PPB licensed premises · Reg. No. {PREMISES_REG_NO}
            </p>
          </div>
        </div>
      </section>

      {/* ── Your Visit (Flow) ──────────────────────────────────────── */}
      <section id="visit" className="border-t border-border bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 dark:bg-teal-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              Patient journey
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Your visit, step by step
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              One seamless journey from the door to the dispensary.
            </p>
          </div>

          <div className="relative mt-12">
            {/* Connector line (desktop only) */}
            <div
              aria-hidden
              className="absolute left-[calc(12.5%-1px)] right-[calc(12.5%-1px)] top-10 hidden h-0.5 bg-gradient-to-r from-teal-400 via-teal-600 to-teal-900 lg:block"
            />

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FLOW.map((f, i) => (
                <div key={f.step} className="relative flex flex-col items-center text-center">
                  <div
                    className={`relative z-10 grid h-20 w-20 place-items-center rounded-full bg-linear-to-br ${f.color} shadow-lg ring-4 ring-card`}
                  >
                    <f.Icon className="h-8 w-8 text-white" />
                    <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-card font-display text-xs font-bold text-teal-700 dark:text-teal-300 ring-1 ring-teal-200 dark:ring-teal-800">
                      {f.step}
                    </span>
                  </div>
                  <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm w-full">
                    <h3 className="font-display text-lg font-semibold text-foreground">
                      {f.label}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="demo" className="border-t border-border bg-white/60 dark:bg-zinc-950/60">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 dark:bg-teal-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              Walkthrough
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              See Amla Medicare in action
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              A short tour of one patient visit as the clinic sees it — from the
              reception desk, through the doctor and the lab, to the pharmacy
              handing over medication on the same record.
            </p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-6 text-sm font-semibold text-white shadow-md shadow-[#25D366]/30 transition-all hover:bg-[#1fad54] hover:-translate-y-0.5"
            >
              <WhatsAppIcon className="h-4 w-4" />
              Book via WhatsApp
            </a>
          </div>
          <DemoVideo
            videoId={DEMO_VIDEO_ID}
            title="Amla Medicare clinic walkthrough"
          />
        </div>
      </section>

      <section className="border-t border-border bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 dark:bg-teal-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              Patients
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              What our patients say
            </h2>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="rounded-3xl border border-border bg-card p-6 shadow-sm"
              >
                <div className="flex gap-0.5 text-amber-400">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4" fill="currentColor" />
                  ))}
                </div>
                <blockquote className="mt-4 text-sm leading-6 text-muted-foreground">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <div className="mt-5 flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-700 text-xs font-bold text-white">
                    {t.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="contact"
        className="relative overflow-hidden border-t border-teal-950/5 bg-linear-to-br from-teal-800 via-teal-900 to-teal-950"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-700/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-teal-600/20 blur-3xl"
        />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Need to see a doctor today?
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-teal-100/80">
                No appointment needed — walk in and reception will register you
                in minutes. For enquiries, reach us on any channel below.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center gap-2.5 rounded-full bg-[#25D366] px-6 text-sm font-semibold text-white shadow-lg shadow-[#25D366]/30 transition-all hover:bg-[#1fad54] hover:-translate-y-0.5"
                >
                  <WhatsAppIcon className="h-5 w-5" />
                  Chat on WhatsApp
                </a>
                <a
                  href="tel:+254796268600"
                  className="inline-flex h-12 items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white backdrop-blur transition-all hover:bg-white/20 hover:-translate-y-0.5"
                >
                  <Phone className="h-4 w-4" />
                  +254 796 268600
                </a>
              </div>
              <p className="mt-4 text-xs text-teal-300/60">
                Or email{" "}
                <a
                  href="mailto:amla.medicare@outlook.com"
                  className="font-medium text-teal-300 underline"
                >
                  amla.medicare@outlook.com
                </a>
              </p>
            </div>

            {/* Right — info cards */}
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                {
                  Icon: Clock,
                  title: "Opening Hours",
                  body: "Monday – Sunday\n7:00 AM – 9:00 PM",
                },
                {
                  Icon: MapPin,
                  title: "Location",
                  body: "Kanduma Centre, Kikuyu",
                },
                {
                  Icon: Wallet,
                  title: "Payment",
                  body: "M-Pesa, Cash\nInsurance accepted",
                },
                {
                  Icon: Ambulance,
                  title: "Emergencies",
                  body: "Priority triage\nDon't hesitate to come in",
                },
              ] as { Icon: LucideIcon; title: string; body: string }[]).map(({ Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10">
                    <Icon className="h-5 w-5 text-teal-300" />
                  </div>
                  <h3 className="mt-3 font-semibold text-white">{title}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-teal-100/70">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 border-t border-white/10 pt-8 text-center">
            <p className="text-sm text-teal-200/60">
              Are you a staff member?{" "}
              <Link
                href="/login"
                className="font-semibold text-white underline underline-offset-2 transition-colors hover:text-teal-300"
              >
                Sign in to the staff portal →
              </Link>
            </p>
          </div>
        </div>
      </section>

      <footer className="bg-teal-950 py-8 text-center">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <BrandLogo size="sm" />
            <span className="font-display text-sm font-semibold text-white">
              Amla Medicare
            </span>
          </div>
          <p className="text-xs text-teal-300/50">
            © {new Date().getFullYear()} Amla - Medicare Ltd · Premises Reg. No.{" "}
            {PREMISES_REG_NO}. Powered by{" "}
            <a
              href="https://nebtech.online"
              className="underline hover:text-teal-300/80"
              rel="noopener noreferrer"
              target="_blank"
            >
              nebtech.online
            </a>
            .
          </p>
        </div>
      </footer>

      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-2xl shadow-[#25D366]/50 ring-4 ring-white transition-all hover:scale-110 hover:bg-[#1fad54] hover:shadow-[#25D366]/60"
      >
        <WhatsAppIcon className="h-7 w-7 text-white" />
        <span
          aria-hidden
          className="absolute h-full w-full animate-ping rounded-full bg-[#25D366] opacity-30"
        />
      </a>
    </div>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
