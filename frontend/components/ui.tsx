"use client";

import * as React from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlayClosers: Array<React.MutableRefObject<() => void>> = [];

function ensureEscapeListener() {
  if (typeof document === "undefined") return;
  if (document.documentElement.dataset.flagshipEscape === "1") return;
  document.documentElement.dataset.flagshipEscape = "1";
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || overlayClosers.length === 0) return;
    event.preventDefault();
    overlayClosers[overlayClosers.length - 1].current();
  });
}

function useOverlay(open: boolean, onClose: () => void, containerRef: React.RefObject<HTMLElement>) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    ensureEscapeListener();
    overlayClosers.push(onCloseRef);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = containerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );

    window.setTimeout(() => {
      (focusables()[0] ?? root)?.focus();
    }, 0);

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Tab" || !root) return;
      if (!root.contains(document.activeElement)) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      const index = overlayClosers.indexOf(onCloseRef);
      if (index >= 0) overlayClosers.splice(index, 1);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, containerRef]);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md";
}) {
  const variants: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    secondary: "bg-muted text-foreground hover:bg-border",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "hover:bg-muted text-foreground",
    outline: "border border-border bg-background hover:bg-muted",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 text-sm",
  };
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card p-5", className)} {...props} />;
}

export function Badge({
  color = "gray",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  color?: "gray" | "green" | "red" | "blue" | "amber" | "indigo";
}) {
  const colors: Record<string, string> = {
    gray: "bg-muted text-muted-foreground",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    amber: "bg-amber-100 text-amber-800",
    indigo: "bg-primary/10 text-primary",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        colors[color],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30 aria-[invalid=true]:border-red-400",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30 aria-[invalid=true]:border-red-400",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = htmlFor && hint ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor && error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-green-500" : "bg-gray-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  onDismiss,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  onDismiss?: () => void;
}) {
  const tones: Record<string, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm", tones[tone])}
    >
      <div>
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? "mt-0.5" : undefined}>{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="text-xs underline" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-border/80", className)} aria-hidden />;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-6 py-10 text-center">
      <h3 className="text-sm font-medium">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "down" | "idle" }) {
  const colors = {
    ok: "bg-green-500",
    warn: "bg-amber-500",
    down: "bg-red-500",
    idle: "bg-gray-300",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full", colors[tone])} aria-hidden />;
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-xs -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-normal text-background group-focus-within:block group-hover:block"
      >
        {label}
      </span>
    </span>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = React.useState<"idle" | "done" | "error">("idle");
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("done");
        } catch {
          setState("error");
        }
        window.setTimeout(() => setState("idle"), 1600);
      }}
    >
      {state === "done" ? "Copied" : state === "error" ? "Copy failed" : label}
    </Button>
  );
}

export function TabList<T extends string>({
  tabs,
  value,
  onChange,
  label = "Sections",
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
}) {
  function move(current: number, direction: 1 | -1 | "start" | "end") {
    const next =
      direction === "start"
        ? 0
        : direction === "end"
          ? tabs.length - 1
          : (current + direction + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="tab-scroll flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(index, 1);
              if (event.key === "ArrowLeft") move(index, -1);
              if (event.key === "Home") move(index, "start");
              if (event.key === "End") move(index, "end");
            }}
            className={cn(
              "shrink-0 px-4 py-2 text-sm font-medium",
              selected
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close panel" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 h-full w-full max-w-3xl overflow-y-auto bg-background p-4 shadow-xl outline-none sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-xl font-semibold">
              {title}
            </h2>
            {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    />
  );
}
