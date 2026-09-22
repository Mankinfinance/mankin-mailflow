import Link from "next/link";
import {
  ChevronsUpDown,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  PanelsTopLeft,
  ClipboardList,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { MailflowLogo } from "@/components/brand/MailflowLogo";

/**
 * Mailflow's own 200px left navigation.
 *
 * The marketing module carries its own nav rather than nesting under the
 * LoanFlow pipeline sidebar: its ten destinations have nothing to do with
 * a deal's stages, and mixing them would leave brokers scrolling past
 * "Landing pages" to reach today's queue. The launcher at / opens either
 * product; the workspace switcher here goes back to it.
 *
 * The footer slot varies by screen — sending-domain health on the
 * dashboard, group counts on subscribers, a compliance note on the
 * register — so it is passed in rather than fixed here.
 */

export type MailflowNavKey =
  | "dashboard"
  | "subscribers"
  | "campaigns"
  | "automations"
  | "forms"
  | "landing-pages"
  | "templates"
  | "files"
  | "settings";

interface NavEntry {
  key: MailflowNavKey;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  /** Destinations the design specifies but that have no backend yet. */
}

const NAV: NavEntry[] = [
  { key: "dashboard", label: "Dashboard", href: "/marketing", icon: LayoutDashboard },
  { key: "subscribers", label: "Subscribers", href: "/marketing/subscribers", icon: Users },
  { key: "campaigns", label: "Campaigns", href: "/marketing/campaigns", icon: Mail },
  { key: "automations", label: "Automations", href: "/marketing/automations", icon: Workflow },
  { key: "forms", label: "Forms", href: "/marketing/forms", icon: ClipboardList },
  { key: "landing-pages", label: "Landing pages", href: "/marketing/landing-pages", icon: PanelsTopLeft },
  { key: "templates", label: "Templates", href: "/marketing/templates", icon: LayoutTemplate },
  { key: "files", label: "File manager", href: "/marketing/files", icon: FolderOpen },
  { key: "settings", label: "Settings", href: "/marketing/settings", icon: Settings },
];

interface MailflowNavProps {
  active: MailflowNavKey;
  /** Screen-specific footer content, pushed to the bottom of the rail. */
  footer?: React.ReactNode;
}

export function MailflowNav({ active, footer }: MailflowNavProps) {
  return (
    <nav className="flex w-[200px] shrink-0 flex-col border-r border-hairline bg-surface px-3 py-3.5">
      {/* Which product you are in. Every screen inside /marketing carries
          this, because the surrounding chrome is otherwise identical to
          LoanFlow's and a broker three clicks deep should never have to
          work out which of the two they are looking at. */}
      <Link
        href="/marketing"
        className="mf-quiet flex items-center gap-2 rounded-md px-1 py-0.5"
        aria-label="Mailflow home"
      >
        <MailflowLogo size="sm" />
      </Link>

      {/* The way out: back to the launcher, and on to LoanFlow. Kept
          visually quieter than the wordmark above it — leaving is the
          rarer intent. */}
      <Link
        href="/"
        className="mf-quiet mt-2.5 flex items-center gap-2 rounded-md border border-hairline bg-paper px-2 py-1.5 transition-colors hover:bg-paper-warm"
      >
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-brand text-[13px] leading-none text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          M
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-semibold text-ink">
            Mankin Finance
          </span>
          <span className="block text-[9.5px] text-ink-mute">ACR 102746</span>
        </span>
        <ChevronsUpDown size={13} strokeWidth={1.5} className="shrink-0 text-ink-mute" />
      </Link>

      <div className="mt-3 flex flex-col gap-px">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          const className = cn(
            "mf-quiet flex items-center gap-[9px] rounded-md px-2.5 py-[7px] text-[12.5px] transition-colors",
            isActive
              ? "bg-brand-soft font-semibold text-brand"
              : "text-ink-mute hover:bg-paper-warm",
          );
          return (
            <Link key={item.key} href={item.href} className={className}>
              <Icon size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>

      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </nav>
  );
}

/** Sending-domain health — the dashboard's footer slot. */
export function SendingDomainHealth({
  domain,
  authenticated,
}: {
  domain: string;
  authenticated: boolean;
}) {
  return (
    <div className="rounded-md border border-hairline bg-paper px-2.5 py-2">
      <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-faint">
        Sending domain
      </div>
      <div className="mono truncate text-[10.5px] text-ink-soft">{domain}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            authenticated ? "bg-ok" : "bg-warn",
          )}
        />
        <span className="text-[10px] text-ink-mute">
          {authenticated ? "Authenticated" : "Not verified"}
        </span>
      </div>
    </div>
  );
}
