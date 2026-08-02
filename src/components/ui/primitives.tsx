"use client";

import type { Severity } from "@/lib/types";

/** Shared, calm UI primitives — editorial, trustworthy, minimal chrome. */

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl2 bg-paper-parchment border border-hairline shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  title,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "sage";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-ink text-paper-parchment hover:bg-ink-soft",
    sage: "bg-sage text-white hover:bg-sage/90",
    secondary:
      "bg-paper-deep text-ink border border-hairline hover:bg-paper",
    ghost: "text-slate hover:text-ink hover:bg-paper-deep/60",
    danger: "bg-clay text-white hover:bg-clay/90",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

const SEVERITY_STYLE: Record<
  Severity,
  { bg: string; text: string; dot: string; label: string }
> = {
  block: { bg: "bg-clay/12", text: "text-clay", dot: "bg-clay", label: "Blocks" },
  warn: { bg: "bg-amber/12", text: "text-amber", dot: "bg-amber", label: "Review" },
  info: { bg: "bg-slate/12", text: "text-slate", dot: "bg-slate", label: "Info" },
  ok: { bg: "bg-sage/12", text: "text-sage", dot: "bg-sage", label: "Cleared" },
};

export function SeverityBadge({
  severity,
  children,
}: {
  severity: Severity;
  children?: React.ReactNode;
}) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {children ?? s.label}
    </span>
  );
}

export function severityAccent(severity: Severity): string {
  return SEVERITY_STYLE[severity].dot;
}

export function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "sage" | "amber" | "clay" | "ink";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate/10 text-slate",
    sage: "bg-sage/12 text-sage",
    amber: "bg-amber/12 text-amber",
    clay: "bg-clay/12 text-clay",
    ink: "bg-ink/8 text-ink",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-paper-deep overflow-hidden">
      <div
        className="h-full rounded-full bg-sage transition-all duration-500"
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </div>
  );
}

export function Labeled({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate">{hint}</span>}
    </label>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20 ${
        props.className ?? ""
      }`}
    />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>
) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20 ${
        props.className ?? ""
      }`}
    />
  );
}

export function MockLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">
      {children}
    </span>
  );
}
