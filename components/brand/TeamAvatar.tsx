import { teamMember, type TeamMemberId } from "@/lib/team";

interface TeamAvatarProps {
  id: TeamMemberId;
  size?: number;
  /** Outer ring thickness in px when the avatar needs to stand out */
  ring?: number;
}

export function TeamAvatar({ id, size = 24, ring }: TeamAvatarProps) {
  const m = teamMember(id);
  return (
    <div
      title={`${m.name} · ${m.role}`}
      className="grid place-items-center rounded-full font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        background: m.color,
        fontSize: size * 0.4,
        letterSpacing: "-0.02em",
        boxShadow: ring ? `0 0 0 2px var(--color-surface), 0 0 0 ${2 + ring}px ${m.color}` : undefined,
      }}
    >
      {m.initials}
    </div>
  );
}
