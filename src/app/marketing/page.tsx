"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  QrCodeIcon,
  UserGroupIcon,
  FireIcon,
  CreditCardIcon,
  ChartBarIcon,
  LanguageIcon,
  BoltIcon,
  ShieldCheckIcon,
  CheckIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  Bars3Icon,
  XMarkIcon,
  SparklesIcon,
  ClockIcon,
  BellAlertIcon,
} from "@heroicons/react/24/outline";

// ═══════════════════════════════════════════════════════════════════════
// MARKETING LANDING PAGE — B2B conversion optimized for Google Ads
// ═══════════════════════════════════════════════════════════════════════

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export default function MarketingPage() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-white text-text-primary">
      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-sand-200/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link href="/marketing" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ocean-600 to-status-wait-600 text-white shadow-sm">
              <BoltIcon className="h-4 w-4" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">
              Table to Cash
            </span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-text-secondary transition hover:text-text-primary"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <a
              href="#demo"
              className="text-sm font-semibold text-text-secondary hover:text-text-primary"
            >
              Sign in
            </a>
            <a
              href="#demo"
              className="inline-flex items-center gap-1.5 rounded-full bg-sand-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sand-800"
            >
              Book a demo
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </a>
          </div>
          <button
            onClick={() => setNavOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-sand-200 md:hidden"
            aria-label="Toggle menu"
          >
            {navOpen ? (
              <XMarkIcon className="h-5 w-5" />
            ) : (
              <Bars3Icon className="h-5 w-5" />
            )}
          </button>
        </div>
        {navOpen && (
          <div className="border-t border-sand-200 bg-white md:hidden">
            <div className="flex flex-col gap-1 px-5 py-3">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setNavOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-sand-50"
                >
                  {l.label}
                </a>
              ))}
              <a
                href="#demo"
                onClick={() => setNavOpen(false)}
                className="mt-2 rounded-full bg-sand-900 px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                Book a demo
              </a>
            </div>
          </div>
        )}
      </header>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
        >
          <div className="absolute -top-40 left-1/2 h-[800px] w-[1200px] -translate-x-1/2 rounded-full bg-gradient-to-br from-ocean-100 via-status-wait-100 to-status-info-100 opacity-60 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.08),transparent_60%)]" />
        </div>

        <div className="mx-auto max-w-7xl px-5 pb-16 pt-14 lg:px-8 lg:pb-24 lg:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-4xl text-center"
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ocean-200 bg-ocean-50 px-3 py-1">
              <SparklesIcon className="h-3.5 w-3.5 text-ocean-600" />
              <span className="text-xs font-semibold text-ocean-700">
                New · Live owner dashboard with real-time perception engine
              </span>
            </div>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-text-primary sm:text-5xl lg:text-6xl">
              The operating system for{" "}
              <span className="bg-gradient-to-r from-ocean-600 via-status-wait-600 to-fuchsia-600 bg-clip-text text-transparent">
                full-service restaurants
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-text-secondary sm:text-xl">
              Guest QR ordering, waiter tools, kitchen &amp; bar routing,
              cashier rounds, and a live owner dashboard. One platform — from
              the table to the cash.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#demo"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-sand-900 px-7 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-sand-900/10 transition hover:bg-sand-800 sm:w-auto"
              >
                Book a free demo
                <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </a>
              <a
                href="#how"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-sand-300 bg-white px-7 py-3.5 text-[15px] font-semibold text-text-secondary transition hover:border-sand-400 hover:bg-sand-50 sm:w-auto"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 text-xs font-medium text-text-secondary">
              No credit card required · Setup in one day · Cancel anytime
            </p>
          </motion.div>

          {/* Hero product mock */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative mx-auto mt-14 max-w-5xl"
          >
            <div className="absolute inset-x-8 -top-4 h-6 rounded-t-3xl bg-sand-200/70 blur-sm" />
            <div className="relative overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-2xl shadow-ocean-500/10">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-sand-100 bg-sand-50 px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-status-bad-400" />
                  <div className="h-2.5 w-2.5 rounded-full bg-status-warn-400" />
                  <div className="h-2.5 w-2.5 rounded-full bg-status-good-400" />
                </div>
                <div className="mx-auto rounded-md bg-white px-3 py-0.5 text-[11px] font-medium text-text-secondary shadow-sm">
                  tabletocash.app/dashboard
                </div>
              </div>
              <DashboardMock />
            </div>
          </motion.div>

          {/* Trust bar */}
          <div className="mx-auto mt-16 max-w-5xl">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
              Trusted by modern hospitality teams
            </p>
            <div className="mt-5 grid grid-cols-2 items-center gap-6 opacity-60 sm:grid-cols-3 md:grid-cols-5">
              {[
                "NEOM DAHAB",
                "LUMA & CO",
                "THE GROVE",
                "SALT HOUSE",
                "NORTH YARD",
              ].map((b) => (
                <div
                  key={b}
                  className="text-center text-sm font-semibold tracking-[0.2em] text-text-secondary"
                >
                  {b}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLEM ─────────────────────────────────────────────────── */}
      <section className="border-y border-sand-100 bg-sand-50/60 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Your restaurant runs on{" "}
              <span className="text-status-bad-600">five disconnected tools</span>.
            </h2>
            <p className="mt-4 text-lg text-text-secondary">
              QR menu, POS, kitchen printer, a spreadsheet, and a WhatsApp
              group. Every handoff loses money.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                stat: "23%",
                label: "of tickets lost",
                body: "between waiter, kitchen, and cashier on a busy Saturday.",
              },
              {
                stat: "11 min",
                label: "avg extra wait",
                body: "because nobody sees the bottleneck until guests complain.",
              },
              {
                stat: "$140k",
                label: "leakage / year",
                body: "in uncharged items, missed upsells, and comped rounds.",
              },
            ].map((s) => (
              <div
                key={s.stat}
                className="rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
              >
                <p className="text-4xl font-semibold text-status-bad-600">{s.stat}</p>
                <p className="mt-1 text-sm font-bold text-text-primary">
                  {s.label}
                </p>
                <p className="mt-2 text-sm text-text-secondary">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section id="features" className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-ocean-600">
              Features
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              Everything your restaurant needs. Nothing it doesn&apos;t.
            </h2>
            <p className="mt-5 text-lg text-text-secondary">
              Eight integrated modules sharing one live state — so your team
              stops fighting the software and starts serving guests.
            </p>
          </div>

          <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.4 }}
                className="group relative overflow-hidden rounded-2xl border border-sand-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-ocean-200 hover:shadow-lg hover:shadow-ocean-500/5"
              >
                <div
                  className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl ${f.bg}`}
                >
                  <f.icon className={`h-5 w-5 ${f.fg}`} />
                </div>
                <h3 className="text-[17px] font-bold text-text-primary">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {f.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────── */}
      <section
        id="how"
        className="relative overflow-hidden bg-sand-900 py-20 text-white lg:py-28"
      >
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.25),transparent_50%),radial-gradient(circle_at_80%_60%,rgba(139,92,246,0.2),transparent_50%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-ocean-300">
              How it works
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              From table to cash in three moves.
            </h2>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                className="relative rounded-2xl border border-white/10 bg-white/5 p-7 backdrop-blur-sm"
              >
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-ocean-500 to-status-wait-500 text-sm font-semibold">
                  {i + 1}
                </div>
                <h3 className="text-xl font-bold">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">
                  {s.body}
                </p>
                <ul className="mt-5 space-y-2">
                  {s.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-sm text-text-muted"
                    >
                      <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-good-400" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ROI / METRICS ──────────────────────────────────────────── */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-ocean-600">
                The numbers
              </span>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
                Operators see payback in the first month.
              </h2>
              <p className="mt-5 text-lg text-text-secondary">
                Because the system is measuring itself — real prep times, real
                wait times, real upsell conversion — you stop guessing and start
                cutting waste.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  "Cut average ticket time by 18%",
                  "Lift upsell acceptance 2.4×",
                  "Eliminate re-billing errors on split rounds",
                  "Catch stuck orders before the guest complains",
                ].map((r) => (
                  <div key={r} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-status-good-100">
                      <CheckIcon className="h-3 w-3 text-status-good-700" />
                    </div>
                    <span className="text-[15px] font-medium text-text-primary">
                      {r}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { num: "18%", label: "faster tickets", color: "text-ocean-600" },
                { num: "2.4×", label: "upsell lift", color: "text-status-wait-600" },
                { num: "0", label: "split-bill errors", color: "text-status-good-600" },
                { num: "1 day", label: "to go live", color: "text-status-info-600" },
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-2xl border border-sand-200 bg-gradient-to-br from-white to-sand-50 p-6 shadow-sm"
                >
                  <p className={`text-4xl font-semibold tracking-tight ${m.color}`}>
                    {m.num}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-text-secondary">
                    {m.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ────────────────────────────────────────────── */}
      <section className="border-y border-sand-100 bg-sand-50/60 py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Loved by operators who run tight ships.
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure
                key={t.author}
                className="rounded-2xl border border-sand-200 bg-white p-7 shadow-sm"
              >
                <div className="flex gap-0.5 text-status-warn-400">
                  {"★★★★★".split("").map((s, i) => (
                    <span key={i}>{s}</span>
                  ))}
                </div>
                <blockquote className="mt-4 text-[15px] leading-relaxed text-text-secondary">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3 border-t border-sand-100 pt-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-ocean-500 to-status-wait-500 text-sm font-semibold text-white">
                    {t.author.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-text-primary">
                      {t.author}
                    </p>
                    <p className="text-xs text-text-secondary">{t.role}</p>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-ocean-600">
              Pricing
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              Simple plans that scale with your floor.
            </h2>
            <p className="mt-5 text-lg text-text-secondary">
              Every plan includes unlimited guests, unlimited orders, and free
              updates. No per-transaction fees.
            </p>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-3xl border p-8 ${
                  p.featured
                    ? "border-ocean-600 bg-gradient-to-b from-ocean-50 to-white shadow-xl shadow-ocean-500/10"
                    : "border-sand-200 bg-white"
                }`}
              >
                {p.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-ocean-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
                    Most popular
                  </div>
                )}
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">
                  {p.name}
                </h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-5xl font-semibold tracking-tight">
                    {p.price}
                  </span>
                  {p.unit && (
                    <span className="text-sm font-semibold text-text-secondary">
                      {p.unit}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-text-secondary">{p.tagline}</p>
                <a
                  href="#demo"
                  className={`mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-5 py-3 text-sm font-semibold transition ${
                    p.featured
                      ? "bg-sand-900 text-white hover:bg-sand-800"
                      : "border border-sand-300 bg-white text-text-primary hover:bg-sand-50"
                  }`}
                >
                  {p.cta}
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </a>
                <ul className="mt-7 space-y-3 border-t border-sand-200 pt-6">
                  {p.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2.5 text-sm text-text-secondary"
                    >
                      <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-good-600" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section
        id="faq"
        className="border-t border-sand-100 bg-sand-50/60 py-20 lg:py-28"
      >
        <div className="mx-auto max-w-3xl px-5 lg:px-8">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-ocean-600">
              FAQ
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Questions, answered.
            </h2>
          </div>
          <div className="mt-12 space-y-3">
            {FAQS.map((f, i) => (
              <FaqItem key={i} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA / DEMO ────────────────────────────────────────── */}
      <section id="demo" className="py-20 lg:py-28">
        <div className="mx-auto max-w-4xl px-5 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sand-900 via-ocean-900 to-status-wait-900 p-10 text-center text-white shadow-2xl lg:p-16">
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent_60%)]"
            />
            <div className="relative">
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
                See it run your restaurant.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg text-ocean-100">
                Book a 20-minute demo. We&apos;ll load your menu, your floor
                plan, and show the system live on your real data.
              </p>
              <DemoForm />
              <p className="mt-4 text-xs text-ocean-200/80">
                No credit card · No pressure · Response within 1 business day
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="border-t border-sand-200 bg-white py-14">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ocean-600 to-status-wait-600 text-white">
                  <BoltIcon className="h-4 w-4" />
                </div>
                <span className="text-[15px] font-semibold">Table to Cash</span>
              </div>
              <p className="mt-4 max-w-sm text-sm text-text-secondary">
                The operating system for full-service restaurants. Built by
                hospitality operators, for hospitality operators.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Product
              </h4>
              <ul className="mt-4 space-y-2 text-sm text-text-secondary">
                <li>
                  <a href="#features" className="hover:text-text-primary">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-text-primary">
                    Pricing
                  </a>
                </li>
                <li>
                  <a href="#how" className="hover:text-text-primary">
                    How it works
                  </a>
                </li>
                <li>
                  <a href="#demo" className="hover:text-text-primary">
                    Book a demo
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Company
              </h4>
              <ul className="mt-4 space-y-2 text-sm text-text-secondary">
                <li>
                  <a href="#" className="hover:text-text-primary">
                    About
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-text-primary">
                    Contact
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-text-primary">
                    Privacy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-text-primary">
                    Terms
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-sand-200 pt-8 text-xs text-text-secondary md:flex-row">
            <p>© {new Date().getFullYear()} Table to Cash. All rights reserved.</p>
            <p>Built for restaurants that take hospitality seriously.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════════

const FEATURES = [
  {
    icon: QrCodeIcon,
    bg: "bg-ocean-50",
    fg: "text-ocean-600",
    title: "Guest QR ordering",
    body: "Guests scan, browse a gorgeous menu, and order — no app install, no download friction. Works in English and Arabic out of the box.",
  },
  {
    icon: UserGroupIcon,
    bg: "bg-status-wait-50",
    fg: "text-status-wait-600",
    title: "Waiter-opened tables",
    body: "Walk-ins, regulars, waiter-driven service — open a table in two taps. No guest has to scan anything.",
  },
  {
    icon: FireIcon,
    bg: "bg-status-warn-50",
    fg: "text-status-warn-600",
    title: "Kitchen & bar routing",
    body: "Orders split automatically between the kitchen and the bar. Both stations see only what they need.",
  },
  {
    icon: CreditCardIcon,
    bg: "bg-status-good-50",
    fg: "text-status-good-600",
    title: "Cashier with split rounds",
    body: "Pay in rounds, mix cash and card, settle per guest. The cashier sees every round, printed receipts stay clean.",
  },
  {
    icon: ChartBarIcon,
    bg: "bg-status-info-50",
    fg: "text-status-info-600",
    title: "Live owner dashboard",
    body: "Real prep times, real wait times, real upsell conversion — not vanity numbers. Updated every few seconds.",
  },
  {
    icon: BellAlertIcon,
    bg: "bg-status-bad-50",
    fg: "text-status-bad-600",
    title: "Perception engine",
    body: "Stuck orders, idle tables, bottleneck items — the system surfaces problems before guests complain.",
  },
  {
    icon: LanguageIcon,
    bg: "bg-fuchsia-50",
    fg: "text-fuchsia-600",
    title: "Multi-language",
    body: "Full Arabic and English UI across guest, waiter, cashier, and owner views. Switch per device.",
  },
  {
    icon: ShieldCheckIcon,
    bg: "bg-status-warn-50",
    fg: "text-status-warn-600",
    title: "One source of truth",
    body: "The cashier is financial truth. No double billing, no lost rounds, no reconciliation spreadsheets.",
  },
  {
    icon: ClockIcon,
    bg: "bg-teal-50",
    fg: "text-teal-600",
    title: "Shift-aware staff",
    body: "Waiter and cashier tools respect shift schedules. Off-shift? They can&apos;t open the table.",
  },
];

const STEPS = [
  {
    title: "Guests arrive",
    body: "They scan the QR on the table — or a waiter opens the table for them. Either way, one session starts.",
    bullets: ["QR or waiter-opened", "Arabic + English menu", "No app install"],
  },
  {
    title: "Orders flow",
    body: "Items route to the kitchen and bar automatically. The waiter sees the status, the guest sees the timer.",
    bullets: [
      "Kitchen & bar split",
      "Live prep status",
      "Stuck-order alerts",
    ],
  },
  {
    title: "Cashier closes",
    body: "Split rounds, mixed payments, printed receipt. The dashboard updates in real time across every device.",
    bullets: [
      "Round-aware billing",
      "Cash + card mix",
      "Financial truth, always",
    ],
  },
];

const TESTIMONIALS = [
  {
    quote:
      "We replaced three tools with one. Our Saturday covers went up 22% and our reconciliation time went to zero.",
    author: "Mariam A.",
    role: "Owner · Neom Dahab",
  },
  {
    quote:
      "The round-aware cashier alone is worth it. No more customers asking why they&apos;re being billed twice.",
    author: "Karim S.",
    role: "GM · Luma & Co",
  },
  {
    quote:
      "Finally a dashboard that tells me the truth about wait times. I know exactly where the bottleneck is.",
    author: "Leila H.",
    role: "Operations · The Grove",
  },
];

const PRICING = [
  {
    name: "Starter",
    price: "$149",
    unit: "/ month",
    tagline: "For single-location spots opening up to 20 tables.",
    cta: "Start free trial",
    featured: false,
    features: [
      "Up to 20 tables",
      "Guest QR ordering",
      "Cashier with split rounds",
      "Kitchen display",
      "Owner dashboard",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$349",
    unit: "/ month",
    tagline: "For full-service restaurants with bar and multi-station prep.",
    cta: "Book a demo",
    featured: true,
    features: [
      "Up to 60 tables",
      "Everything in Starter",
      "Bar + kitchen station routing",
      "Multi-language (EN / AR)",
      "Perception engine + alerts",
      "Walk-in + room service revenue split",
      "Priority support",
    ],
  },
  {
    name: "Scale",
    price: "Custom",
    unit: "",
    tagline: "For groups, chains, and hotels. SLA, SSO, custom integrations.",
    cta: "Contact sales",
    featured: false,
    features: [
      "Unlimited tables & locations",
      "Everything in Pro",
      "SSO + role-based access",
      "POS / accounting integrations",
      "API access",
      "Dedicated success manager",
      "99.9% uptime SLA",
    ],
  },
];

const FAQS = [
  {
    q: "Do guests need to install an app?",
    a: "No. Guests scan the QR code and order from their browser. It works on any phone — no app, no download, no account.",
  },
  {
    q: "What if a guest walks in without scanning a QR?",
    a: "The waiter opens the table from their own device in two taps. The system handles walk-ins, regulars, and waiter-driven service identically to QR flows.",
  },
  {
    q: "How long does it take to set up?",
    a: "Most restaurants go live in a single day. We load your menu, your floor plan, and train your team in one onboarding session.",
  },
  {
    q: "Can we split a bill across cash and card?",
    a: "Yes. The cashier handles payment rounds — pay some in cash now, the rest on card later. Every round is tracked and printed clearly on the receipt.",
  },
  {
    q: "Does it support Arabic?",
    a: "Yes, full Arabic and English across every screen: guest menu, waiter tools, cashier, kitchen, and the owner dashboard. Each device can be set independently.",
  },
  {
    q: "What happens if the internet goes down?",
    a: "Core order entry keeps working on your local network and syncs when the connection returns. Payments and receipts are queued safely.",
  },
  {
    q: "Can I see it running on my real menu first?",
    a: "Yes. Book a demo and we&apos;ll load your real menu before the call, so you see the system running on your data, not a generic sandbox.",
  },
];

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-[15px] font-bold text-text-primary">{q}</span>
        <ChevronDownIcon
          className={`h-4 w-4 flex-shrink-0 text-text-secondary transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-sand-100 px-5 py-4 text-sm leading-relaxed text-text-secondary">
          {a}
        </div>
      )}
    </div>
  );
}

function DemoForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [restaurant, setRestaurant] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !restaurant) return;
    setStatus("sending");
    // Placeholder — wire up to /api/leads or your CRM
    await new Promise((r) => setTimeout(r, 600));
    setStatus("sent");
  };

  if (status === "sent") {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white/10 p-6 backdrop-blur-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-status-good-500">
          <CheckIcon className="h-6 w-6 text-white" />
        </div>
        <p className="text-lg font-bold">Got it — we&apos;ll be in touch.</p>
        <p className="mt-2 text-sm text-ocean-100">
          Expect an email from our team within one business day.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-10 grid max-w-xl gap-3 text-left"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Your name"
          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-ocean-200/70 backdrop-blur-sm focus:border-white/40 focus:outline-none"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          placeholder="Work email"
          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-ocean-200/70 backdrop-blur-sm focus:border-white/40 focus:outline-none"
        />
      </div>
      <input
        value={restaurant}
        onChange={(e) => setRestaurant(e.target.value)}
        required
        placeholder="Restaurant name"
        className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-ocean-200/70 backdrop-blur-sm focus:border-white/40 focus:outline-none"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-bold text-text-primary shadow-lg transition hover:bg-sand-100 disabled:opacity-60"
      >
        {status === "sending" ? "Sending..." : "Book my demo"}
        <ArrowRightIcon className="h-4 w-4" />
      </button>
    </form>
  );
}

function DashboardMock() {
  return (
    <div className="grid gap-4 bg-gradient-to-br from-sand-50 to-white p-6 lg:grid-cols-4">
      {/* KPI row */}
      <div className="lg:col-span-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Revenue today", value: "$4,820", color: "text-status-good-600" },
          { label: "Orders", value: "142", color: "text-ocean-600" },
          { label: "Avg ticket", value: "$34", color: "text-status-wait-600" },
          { label: "Occupancy", value: "78%", color: "text-status-info-600" },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-sand-200 bg-white p-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
              {k.label}
            </p>
            <p className={`mt-1 text-xl font-semibold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tables grid */}
      <div className="lg:col-span-2 rounded-xl border border-sand-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Floor
          </p>
          <span className="rounded-full bg-status-good-50 px-2 py-0.5 text-[10px] font-bold text-status-good-700">
            Live
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }).map((_, i) => {
            const states = [
              "bg-status-good-100 text-status-good-700",
              "bg-ocean-100 text-ocean-700",
              "bg-status-warn-100 text-status-warn-700",
              "bg-sand-100 text-text-secondary",
            ];
            const s = states[i % states.length];
            return (
              <div
                key={i}
                className={`aspect-square rounded-lg ${s} flex items-center justify-center text-xs font-bold`}
              >
                T{i + 1}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live orders */}
      <div className="lg:col-span-2 rounded-xl border border-sand-200 bg-white p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-text-secondary">
          Live orders
        </p>
        <div className="space-y-2">
          {[
            { n: "#1043", t: "T7", s: "Preparing", badge: "bg-status-warn-100 text-status-warn-700" },
            { n: "#1042", t: "T3", s: "Ready", badge: "bg-status-good-100 text-status-good-700" },
            { n: "#1041", t: "T12", s: "Served", badge: "bg-sand-200 text-text-secondary" },
            { n: "#1040", t: "T5", s: "Preparing", badge: "bg-status-warn-100 text-status-warn-700" },
          ].map((o) => (
            <div
              key={o.n}
              className="flex items-center justify-between rounded-lg bg-sand-50 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">{o.n}</span>
                <span className="text-[10px] font-semibold text-text-secondary">
                  {o.t}
                </span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${o.badge}`}
              >
                {o.s}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
