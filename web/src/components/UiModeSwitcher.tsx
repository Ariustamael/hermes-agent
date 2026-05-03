import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { Typography } from "@/components/NouiTypography";
import { cn } from "@/lib/utils";

export const UI_MODE_STORAGE_KEY = "hermes-dashboard-ui-mode";
export const UI_MODE_CHANGE_EVENT = "hermes-dashboard-ui-mode-change";
const MODES = [
  { value: "original", label: "Original" },
  { value: "shizen", label: "Shizen" },
] as const;

export type UiMode = (typeof MODES)[number]["value"];

export function readStoredUiMode(): UiMode {
  if (typeof window === "undefined") return "original";
  const stored = window.localStorage.getItem(UI_MODE_STORAGE_KEY);
  return stored === "shizen" ? "shizen" : "original";
}

/**
 * Sidebar dashboard UI-mode selector.
 *
 * The switch is intentionally lightweight for now: `original` keeps the
 * current dashboard, while `shizen` persists intent and exposes
 * `data-dashboard-ui-mode="shizen"` on <html>. The future Shizen dashboard can
 * key off the same storage value without changing this user-facing control.
 */
export function UiModeSwitcher() {
  const [mode, setMode] = useState<UiMode>(() => readStoredUiMode());

  useEffect(() => {
    document.documentElement.dataset.dashboardUiMode = mode;
    window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent<UiMode>(UI_MODE_CHANGE_EVENT, { detail: mode }));
  }, [mode]);

  const activeLabel = useMemo(
    () => MODES.find((entry) => entry.value === mode)?.label ?? "Original",
    [mode],
  );

  return (
    <section
      aria-label="Dashboard UI selector"
      className="shrink-0 border-t border-current/20 px-5 py-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <LayoutDashboard className="h-3.5 w-3.5 text-midground/45" />
        <Typography
          mondwest
          className="text-[0.6rem] uppercase tracking-[0.15em] text-midground/45"
        >
          Interface
        </Typography>
      </div>

      <div
        role="radiogroup"
        aria-label={`Dashboard UI: ${activeLabel}`}
        className="grid grid-cols-2 border border-current/20 bg-background-base/40"
      >
        {MODES.map((entry) => {
          const active = entry.value === mode;
          return (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMode(entry.value)}
              className={cn(
                "relative px-2.5 py-1.5",
                "font-mondwest text-[0.65rem] uppercase tracking-[0.12em]",
                "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground",
                active
                  ? "bg-midground text-background-base"
                  : "text-midground/55 hover:bg-midground/5 hover:text-midground",
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
