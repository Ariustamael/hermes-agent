import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Download, Moon, RotateCw, Search, Settings2, Sun } from "lucide-react";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import ChatPage from "@/pages/ChatPage";
import { UiModeSwitcher } from "@/components/UiModeSwitcher";
import { PluginSlot } from "@/plugins";
import { PageHeaderContext } from "@/contexts/page-header-context";
import { useSystemActions } from "@/contexts/useSystemActions";
import type { SystemAction } from "@/contexts/system-actions-context";
import { useI18n } from "@/i18n";
import { resolvePageTitle } from "@/lib/resolve-page-title";
import { cn } from "@/lib/utils";

const SHIZEN_TONE_STORAGE_KEY = "hermes-shizen-tone";
type ShizenTone = "light" | "dark";

function ShizenUnknownRouteFallback({ pluginsLoading }: { pluginsLoading: boolean }) {
  if (pluginsLoading) return null;
  return <Navigate to="/sessions" replace />;
}

const SHIZEN_ROUTE_META: Record<string, { section: string; title?: string; description: string }> = {
  "/chat": {
    section: "Conversation",
    title: "Conversation",
    description: "Native Hermes chat, kept alive while the rest of the dashboard moves around it.",
  },
  "/sessions": {
    section: "Recent traces",
    title: "Traces",
    description: "Past runs, resumable threads, and the shape of recent work.",
  },
  "/analytics": {
    section: "Measures",
    title: "Measures",
    description: "Usage patterns and system drift without turning the cockpit into a scoreboard.",
  },
  "/models": {
    section: "Engines",
    title: "Engines",
    description: "Provider and model choices for the work behind the interface.",
  },
  "/logs": {
    section: "Signals",
    title: "Signals",
    description: "Runtime output and failures gathered into one readable ledger.",
  },
  "/cron": {
    section: "Rhythms",
    title: "Rhythms",
    description: "Scheduled work, quiet reminders, and recurring agent runs.",
  },
  "/skills": {
    section: "Practices",
    title: "Practices",
    description: "Reusable procedures the agent can load before it acts.",
  },
  "/plugins": {
    section: "Extensions",
    title: "Extensions",
    description: "Dashboard surfaces and local tools mounted into Hermes.",
  },
  "/profiles": {
    section: "Identities",
    title: "Identities",
    description: "Separate working contexts, models, tools, and memory scopes.",
  },
  "/config": {
    section: "Settings",
    title: "Settings",
    description: "The living configuration beneath the dashboard shell.",
  },
  "/env": {
    section: "Keys",
    title: "Keys",
    description: "Environment variables and credentials without exposing their contents.",
  },
  "/docs": {
    section: "Reference",
    title: "Reference",
    description: "Documentation and working notes close to the instrument panel.",
  },
};

const SHIZEN_NAV_SECTIONS = [
  { title: "Work", paths: new Set(["/chat", "/sessions", "/analytics", "/cron"]) },
  { title: "Instruments", paths: new Set(["/models", "/skills", "/plugins"]) },
  { title: "Settings", paths: new Set(["/profiles", "/config", "/env", "/logs", "/docs"]) },
] as const;

function getShizenNavSections(navItems: NavItem[], t: ReturnType<typeof useI18n>["t"]): ShizenNavSection[] {
  const seen = new Set<string>();
  const sections: ShizenNavSection[] = [];

  for (const section of SHIZEN_NAV_SECTIONS) {
    const items = navItems
      .filter((item) => section.paths.has(item.path))
      .map((item) => ({ ...item, resolvedLabel: resolveNavLabel(item, t) }));
    if (items.length) {
      items.forEach((item) => seen.add(item.path));
      sections.push({ title: section.title, items });
    }
  }

  const extensionItems = navItems
    .filter((item) => !seen.has(item.path))
    .map((item) => ({ ...item, resolvedLabel: resolveNavLabel(item, t) }));
  if (extensionItems.length) sections.push({ title: "Local rooms", items: extensionItems });
  return sections;
}

function resolveNavLabel(item: NavItem, t: ReturnType<typeof useI18n>["t"]): string {
  return item.labelKey ? ((t.app.nav as Record<string, string>)[item.labelKey] ?? item.label) : item.label;
}

function resolveShizenRouteMeta(pathname: string, pluginTabs: { path: string; label: string }[]) {
  const exact = SHIZEN_ROUTE_META[pathname];
  if (exact) return exact;
  const plugin = pluginTabs.find((tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`));
  if (plugin) {
    return {
      section: "Local room",
      title: plugin.label,
      description: "A local dashboard surface mounted into the Shizen shell.",
    };
  }
  return {
    section: "Dashboard",
    description: "A quiet working surface for Hermes.",
  };
}

function readStoredShizenTone(): ShizenTone {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(SHIZEN_TONE_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function getShizenVars(tone: ShizenTone): CSSProperties {
  if (tone === "dark") {
    return {
      "--foreground": "#eae5dd",
      "--foreground-base": "#eae5dd",
      "--midground": "#eae5dd",
      "--midground-base": "#eae5dd",
      "--background": "#1a1714",
      "--background-base": "#1a1714",
      "--warm-glow": "rgba(150, 170, 150, 0.14)",
      "--shizen-bg": "#1a1714",
      "--shizen-sidebar": "#221f1b",
      "--shizen-surface": "#221f1b",
      "--shizen-surface-raised": "#2a2622",
      "--shizen-text": "#eae5dd",
      "--shizen-muted": "#b8b0a4",
      "--shizen-faint": "#8c8278",
      "--shizen-border": "#3a342c",
      "--shizen-border-soft": "#2e2922",
      "--shizen-accent": "#96aa96",
      "--shizen-accent-deep": "#b4c8b4",
      "--shizen-thread": "rgba(150, 170, 150, 0.44)",
      "--shizen-shadow-soft": "0 24px 70px rgba(0,0,0,.26)",
      "--shizen-shadow-line": "0 1px 0 rgba(234,229,221,.05)",
      "--shizen-status-ok": "#86a98e",
      "--shizen-status-warn": "#b6a15e",
      "--shizen-status-error": "#b87868",
      "--shizen-grid": "rgba(234,229,221,.16)",
      "--color-foreground": "#eae5dd",
      "--color-card": "#221f1b",
      "--color-card-foreground": "#eae5dd",
      "--color-primary": "#96aa96",
      "--color-primary-foreground": "#151812",
      "--color-secondary": "#272320",
      "--color-secondary-foreground": "#eae5dd",
      "--color-muted": "#272320",
      "--color-muted-foreground": "#b8b0a4",
      "--color-accent": "#253025",
      "--color-accent-foreground": "#b4c8b4",
      "--color-border": "#3a342c",
      "--color-input": "#3a342c",
      "--color-ring": "#96aa96",
      "--color-popover": "#221f1b",
      "--color-popover-foreground": "#eae5dd",
    } as CSSProperties;
  }
  return {
    "--foreground": "#1c1a17",
    "--foreground-base": "#1c1a17",
    "--midground": "#1c1a17",
    "--midground-base": "#1c1a17",
    "--background": "#faf7f2",
    "--background-base": "#faf7f2",
    "--warm-glow": "rgba(138, 158, 138, 0.18)",
    "--shizen-bg": "#faf7f2",
    "--shizen-sidebar": "#fdfcfa",
    "--shizen-surface": "#ffffff",
    "--shizen-surface-raised": "#fdfcfa",
    "--shizen-text": "#1c1a17",
    "--shizen-muted": "#6b6459",
    "--shizen-faint": "#a09890",
    "--shizen-border": "#d6cfc2",
    "--shizen-border-soft": "#e8e2d9",
    "--shizen-accent": "#8a9e8a",
    "--shizen-accent-deep": "#5c7a5c",
    "--shizen-thread": "rgba(92, 122, 92, 0.38)",
    "--shizen-shadow-soft": "0 26px 80px rgba(69, 55, 36, .12)",
    "--shizen-shadow-line": "0 1px 0 rgba(255,255,255,.72)",
    "--shizen-status-ok": "#4a8c6e",
    "--shizen-status-warn": "#b08830",
    "--shizen-status-error": "#9e4a3a",
    "--shizen-grid": "rgba(28,26,23,.12)",
    "--color-foreground": "#1c1a17",
    "--color-card": "#ffffff",
    "--color-card-foreground": "#1c1a17",
    "--color-primary": "#5c7a5c",
    "--color-primary-foreground": "#ffffff",
    "--color-secondary": "#f3efe8",
    "--color-secondary-foreground": "#1c1a17",
    "--color-muted": "#ede8df",
    "--color-muted-foreground": "#6b6459",
    "--color-accent": "#eaf0ea",
    "--color-accent-foreground": "#3d5c3d",
    "--color-border": "#d6cfc2",
    "--color-input": "#d6cfc2",
    "--color-ring": "#8a9e8a",
    "--color-popover": "#ffffff",
    "--color-popover-foreground": "#1c1a17",
  } as CSSProperties;
}


export function ShizenDashboardShell({
  navItems,
  routes,
  pluginTabMeta,
  isChatRoute,
  isDocsRoute,
  embeddedChat,
  pluginsLoading,
  chatOverriddenByPlugin,
}: ShizenDashboardShellProps) {
  const { t } = useI18n();
  const [tone, setTone] = useState<ShizenTone>(() => readStoredShizenTone());
  const shizenVars = getShizenVars(tone);
  const navSections = useMemo(() => getShizenNavSections(navItems, t), [navItems, t]);

  useEffect(() => {
    window.localStorage.setItem(SHIZEN_TONE_STORAGE_KEY, tone);
  }, [tone]);

  return (
    <div
      className="shizen-shell flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-[var(--shizen-bg)] text-[var(--shizen-text)] antialiased"
      data-shizen-tone={tone}
      style={shizenVars}
    >
      <div aria-hidden className="shizen-ambient" />
      <div aria-hidden className="shizen-paper-grain" />
      <aside className="relative z-10 hidden h-dvh w-[292px] shrink-0 flex-col border-r border-[var(--shizen-border)] bg-[var(--shizen-sidebar)]/92 shadow-[var(--shizen-shadow-line)] backdrop-blur lg:flex">
        <div className="relative border-b border-[var(--shizen-border-soft)] px-6 py-6">
          <div aria-hidden className="absolute bottom-0 left-6 right-6 h-px bg-[var(--shizen-thread)] opacity-55" />
          <div className="shizen-eyebrow text-[0.68rem] uppercase tracking-[0.24em] text-[var(--shizen-accent)]">
            Agent cockpit
          </div>
          <div className="shizen-display mt-2 text-3xl font-medium leading-tight tracking-[-0.01em] text-[var(--shizen-text)]">
            Hermes
          </div>
          <div className="mt-4 grid gap-1.5 text-[0.78rem] leading-relaxed text-[var(--shizen-muted)]">
            <div className="flex items-center justify-between gap-3">
              <span>Dashboard shell</span>
              <span className="shizen-status-dot" aria-hidden />
            </div>
            <div className="text-[var(--shizen-faint)]">Quiet surface for local agent work.</div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto border-b border-[var(--shizen-border-soft)] py-4" aria-label={t.app.navigation}>
          <div className="flex flex-col gap-5 px-3">
            {navSections.map((section) => (
              <section key={section.title} aria-label={section.title}>
                <div className="shizen-caption mb-2 px-3 text-[0.61rem] uppercase tracking-[0.18em] text-[var(--shizen-faint)]">
                  {section.title}
                </div>
                <ul className="flex flex-col gap-1">
                  {section.items.map(({ path, resolvedLabel, icon: Icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        end={path === "/sessions"}
                        className={({ isActive }) =>
                          cn(
                            "group relative flex items-center gap-3 rounded-[8px] border border-transparent px-3 py-2.5",
                            "text-sm font-light normal-case tracking-[0.01em] transition-[background-color,border-color,color,transform] duration-150 ease-out",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--shizen-accent)]",
                            isActive
                              ? "border-[var(--shizen-border)] bg-[var(--shizen-surface)] text-[var(--shizen-text)] shadow-[0_1px_2px_rgba(28,26,23,.05)]"
                              : "text-[var(--shizen-muted)] hover:translate-x-0.5 hover:border-[var(--shizen-border-soft)] hover:bg-[var(--shizen-surface)]/62 hover:text-[var(--shizen-text)]",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              aria-hidden
                              className={cn(
                                "absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full transition-opacity",
                                isActive ? "bg-[var(--shizen-accent)] opacity-100" : "bg-[var(--shizen-thread)] opacity-0 group-hover:opacity-50",
                              )}
                            />
                            <Icon className="h-4 w-4 shrink-0 text-[var(--shizen-accent)]" />
                            <span className="truncate">{resolvedLabel}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </nav>

        <ShizenSystemPanel />
        <UiModeSwitcher />
        <ShizenToneSwitcher tone={tone} onToneChange={setTone} />
        <div className="border-t border-[var(--shizen-border-soft)] px-6 py-4">
          <div className="shizen-caption flex items-center justify-between text-[0.68rem] uppercase tracking-[0.18em] text-[var(--shizen-faint)]">
            <span>v0.12.0</span>
            <span>Nous Research</span>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--shizen-border-soft)] bg-[var(--shizen-bg)]/85 px-4 backdrop-blur sm:px-6 lg:hidden">
          <div>
            <div className="shizen-eyebrow text-[0.65rem] uppercase tracking-[0.22em] text-[var(--shizen-accent)]">
              Hermes
            </div>
            <div className="shizen-display text-xl font-medium leading-tight">Shizen dashboard</div>
          </div>
          <div className="flex items-center gap-2">
            <ShizenToneSwitcher tone={tone} onToneChange={setTone} compact />
            <UiModeSwitcher />
          </div>
        </header>

        <PluginSlot name="header-banner" />

        <ShizenPageFrame
          pluginTabs={pluginTabMeta}
          isChatRoute={isChatRoute}
          isDocsRoute={isDocsRoute}
        >
          <PluginSlot name="pre-main" />
          <div
            className={cn(
              "w-full min-w-0",
              (isDocsRoute || isChatRoute) && "min-h-0 flex flex-1 flex-col",
            )}
          >
            <Routes>
              {routes.map(({ key, path, element }) => (
                <Route key={key} path={path} element={element} />
              ))}
              <Route path="*" element={<ShizenUnknownRouteFallback pluginsLoading={pluginsLoading} />} />
            </Routes>

            {embeddedChat &&
              !chatOverriddenByPlugin &&
              (pluginsLoading ? (
                isChatRoute ? (
                  <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center" aria-busy="true" aria-live="polite">
                    <div className="flex items-center gap-2 text-sm text-[var(--shizen-muted)]">
                      <Spinner />
                      <span>Loading chat…</span>
                    </div>
                  </div>
                ) : null
              ) : (
                <div
                  data-chat-active={isChatRoute ? "true" : "false"}
                  className={cn("min-h-0 min-w-0", isChatRoute ? "flex flex-1 flex-col" : "hidden")}
                  aria-hidden={!isChatRoute}
                >
                  <ChatPage isActive={isChatRoute} />
                </div>
              ))}
          </div>
          <PluginSlot name="post-main" />
        </ShizenPageFrame>
      </div>

      <PluginSlot name="overlay" />
    </div>
  );
}

function ShizenPageFrame({ children, pluginTabs, isChatRoute, isDocsRoute }: ShizenPageFrameProps) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [afterTitle, setAfterTitle] = useState<ReactNode>(null);
  const [end, setEnd] = useState<ReactNode>(null);

  /* Existing page-header bridge intentionally clears route-scoped header slots on navigation. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    setTitleOverride(null);
    setAfterTitle(null);
    setEnd(null);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const defaultTitle = useMemo(
    () => resolvePageTitle(pathname, t, pluginTabs),
    [pathname, t, pluginTabs],
  );
  const routeMeta = useMemo(() => resolveShizenRouteMeta(pathname, pluginTabs), [pathname, pluginTabs]);
  const displayTitle = titleOverride ?? routeMeta.title ?? defaultTitle;
  const value = useMemo(
    () => ({ setAfterTitle, setEnd, setTitle: setTitleOverride }),
    [],
  );

  return (
    <PageHeaderContext.Provider value={value}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-[var(--shizen-border-soft)] bg-[var(--shizen-bg)]/78 px-5 py-5 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 max-w-3xl">
              <div className="shizen-eyebrow text-[0.68rem] uppercase tracking-[0.24em] text-[var(--shizen-accent)]">
                {routeMeta.section}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-3">
                <h1 className="truncate text-3xl font-normal leading-tight tracking-[-0.01em] text-[var(--shizen-text)] sm:text-4xl">
                  {displayTitle}
                </h1>
                {afterTitle ? <div className="shizen-header-adornment shrink-0">{afterTitle}</div> : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--shizen-muted)]">
                {routeMeta.description}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-start gap-3 xl:justify-end">
              {end}
              {!isChatRoute && (
                <div className="hidden items-center gap-2 rounded-full border border-[var(--shizen-border-soft)] bg-[var(--shizen-surface)]/72 px-3 py-2 text-sm text-[var(--shizen-muted)] shadow-[var(--shizen-shadow-line)] md:flex">
                  <Search className="h-4 w-4 text-[var(--shizen-accent)]" />
                  <span>Search sessions, tools, and notes</span>
                </div>
              )}
              <div className="hidden items-center gap-2 rounded-full border border-[var(--shizen-border-soft)] bg-[var(--shizen-surface)]/52 px-3 py-2 text-sm text-[var(--shizen-muted)] lg:flex">
                <span className="shizen-status-dot" aria-hidden />
                <span>Signals listening</span>
              </div>
            </div>
          </div>
        </header>

        <main
          className={cn(
            "shizen-workbench min-h-0 w-full min-w-0 flex-1 flex-col bg-[var(--shizen-bg)]",
            isChatRoute ? "flex overflow-hidden" : "overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
            isDocsRoute && "flex",
          )}
        >
          <div className={cn("mx-auto w-full", isChatRoute || isDocsRoute ? "flex min-h-0 flex-1 flex-col" : "max-w-7xl px-5 py-6 sm:px-8")}>{children}</div>
        </main>
      </div>
    </PageHeaderContext.Provider>
  );
}

function ShizenToneSwitcher({
  tone,
  onToneChange,
  compact = false,
}: {
  tone: ShizenTone;
  onToneChange: (tone: ShizenTone) => void;
  compact?: boolean;
}) {
  const options: Array<{ value: ShizenTone; label: string; icon: ComponentType<{ className?: string }> }> = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <section
      aria-label="Shizen color mode"
      className={cn(
        compact
          ? "shrink-0"
          : "shrink-0 border-t border-[var(--shizen-border-soft)] px-6 py-3",
      )}
    >
      {!compact && (
        <div className="shizen-caption mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-[var(--shizen-faint)]">
          Appearance
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={`Shizen appearance: ${tone}`}
        className={cn(
          "grid border border-[var(--shizen-border)] bg-[var(--shizen-surface-raised)]/70",
          compact ? "grid-cols-2" : "grid-cols-2",
        )}
      >
        {options.map(({ value, label, icon: Icon }) => {
          const active = value === tone;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onToneChange(value)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 px-2 py-1.5",
                "shizen-caption text-[0.65rem] uppercase tracking-[0.12em] transition-colors",
                active
                  ? "bg-[var(--shizen-accent)] text-[var(--shizen-bg)]"
                  : "text-[var(--shizen-muted)] hover:bg-[var(--shizen-surface)] hover:text-[var(--shizen-text)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {!compact && <span>{label}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ShizenSystemPanel() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activeAction, isBusy, isRunning, pendingAction, runAction } = useSystemActions();

  const items: Array<{ action: SystemAction; icon: ComponentType<{ className?: string }>; label: string; runningLabel: string; spin: boolean }> = [
    {
      action: "restart",
      icon: RotateCw,
      label: t.status.restartGateway,
      runningLabel: t.status.restartingGateway,
      spin: true,
    },
    {
      action: "update",
      icon: Download,
      label: t.status.updateHermes,
      runningLabel: t.status.updatingHermes,
      spin: false,
    },
  ];

  const handleClick = (action: SystemAction) => {
    if (isBusy) return;
    void runAction(action);
    navigate("/sessions");
  };

  return (
    <section className="shrink-0 border-t border-[var(--shizen-border-soft)] px-6 py-4">
      <div className="shizen-caption mb-3 flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.2em] text-[var(--shizen-faint)]">
        <Settings2 className="h-3.5 w-3.5" />
        System
      </div>
      <div className="space-y-1">
        {items.map(({ action, icon: Icon, label, runningLabel, spin }) => {
          const isPending = pendingAction === action;
          const isActionRunning = activeAction === action && isRunning && !isPending;
          const busy = isPending || isActionRunning;
          const disabled = isBusy && !busy;
          const displayLabel = isActionRunning ? runningLabel : label;
          return (
            <button
              key={action}
              type="button"
              onClick={() => handleClick(action)}
              disabled={disabled}
              aria-busy={busy}
              className={cn(
                "flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left text-sm font-light text-[var(--shizen-muted)] transition-colors",
                "hover:bg-[var(--shizen-surface)]/70 hover:text-[var(--shizen-text)] disabled:opacity-40",
                busy && "bg-[var(--shizen-surface)] text-[var(--shizen-text)]",
              )}
            >
              {isPending || (isActionRunning && spin) ? (
                <Spinner className="shrink-0 text-[0.875rem]" />
              ) : (
                <Icon className={cn("h-4 w-4 shrink-0 text-[var(--shizen-accent)]", isActionRunning && !spin && "animate-pulse")} />
              )}
              <span>{displayLabel}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface ShizenDashboardShellProps {
  navItems: NavItem[];
  routes: Array<{ key: string; path: string; element: ReactNode }>;
  pluginTabMeta: { path: string; label: string }[];
  isChatRoute: boolean;
  isDocsRoute: boolean;
  embeddedChat: boolean;
  pluginsLoading: boolean;
  chatOverriddenByPlugin: boolean;
}

interface ShizenPageFrameProps {
  children: ReactNode;
  pluginTabs: { path: string; label: string }[];
  isChatRoute: boolean;
  isDocsRoute: boolean;
}

interface NavItem {
  icon: ComponentType<{ className?: string }>;
  label: string;
  labelKey?: string;
  path: string;
}

type ShizenNavItem = NavItem & { resolvedLabel: string };

interface ShizenNavSection {
  title: string;
  items: ShizenNavItem[];
}
