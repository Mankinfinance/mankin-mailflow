import Image from "next/image";
import { cn } from "@/lib/cn";
import type { TeamMember } from "@/lib/team";

interface BrokerCardProps {
  broker: TeamMember;
  compact?: boolean;
}

export function BrokerCard({ broker, compact = false }: BrokerCardProps) {
  const photoSrc = broker.id === "mm" ? "/brand/michael-photo.png" : null;
  const size = compact ? 44 : 56;

  return (
    <div
      className={cn(
        "flex items-center gap-3.5 rounded-2xl border border-hairline bg-paper-warm",
        compact ? "px-3.5 py-3" : "px-4.5 py-4",
      )}
    >
      {photoSrc ? (
        <Image
          src={photoSrc}
          alt={broker.name}
          width={size}
          height={size}
          className="shrink-0 rounded-full border-2 border-surface object-cover shadow-sm"
        />
      ) : (
        <div
          className="shrink-0 rounded-full border-2 border-surface shadow-sm grid place-items-center font-semibold text-surface"
          style={{ width: size, height: size, backgroundColor: broker.color, fontSize: size * 0.35 }}
        >
          {broker.initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div
          className={cn("font-medium text-ink", compact ? "text-base" : "text-lg")}
          style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
        >
          {broker.name}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-mute">
          {broker.role} · Mankin Finance
        </div>
        <div
          className={cn(
            "flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-ink-soft",
            compact ? "mt-1" : "mt-2",
          )}
        >
          <span>📞 {broker.phone}</span>
          <span>✉ {broker.email}</span>
        </div>
      </div>
    </div>
  );
}
