import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";

export type RiskLevel = "critical" | "high" | "medium" | "low" | "none";

export interface RiskSignal {
  id: string;
  label: string;
  points: number;
}

export interface DealRisk {
  dealId: string;
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
}

function parseSettlementDate(settlement: string | null | undefined, now: Date): Date | null {
  if (!settlement || settlement === "TBD") return null;
  const match = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(settlement.trim());
  if (!match) return null;
  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const day = parseInt(match[1], 10);
  const mon = MONTHS[match[2].toLowerCase()];
  if (mon === undefined) return null;
  let year = now.getFullYear();
  const candidate = new Date(year, mon, day);
  if (candidate.getTime() < now.getTime() - 30 * 86_400_000) year += 1;
  return new Date(year, mon, day);
}

function parseIso(isoDate: string | null | undefined): Date | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function scoreDeal(deal: Deal, now: Date = new Date()): DealRisk {
  if (deal.nurturedAt || deal.stageId === "settled") {
    return { dealId: deal.id, score: 0, level: "none", signals: [] };
  }

  const signals: RiskSignal[] = [];
  let score = 0;

  const add = (signal: RiskSignal) => {
    signals.push(signal);
    score += signal.points;
  };

  // Pre-approval expiry
  const expiry = parseIso(deal.preApprovalExpiry);
  if (expiry) {
    const daysToExpiry = daysBetween(expiry, now);
    if (daysToExpiry < 0) {
      add({ id: "pa-expired", label: `Pre-approval expired ${Math.abs(daysToExpiry)}d ago`, points: 45 });
    } else if (daysToExpiry <= 14) {
      add({ id: "pa-expiring", label: `Pre-approval expires in ${daysToExpiry}d`, points: 25 });
    }
  }

  // Settlement date approaching but stage not ready
  const settles = parseSettlementDate(deal.settlement, now);
  if (settles) {
    const daysToSettle = daysBetween(settles, now);
    const stageReady = ["settle-booked", "loan-docs", "unconditional", "settled"].includes(deal.stageId);
    if (daysToSettle >= 0 && daysToSettle <= 7 && !stageReady) {
      add({ id: "settle-imminent", label: `Settling in ${daysToSettle}d, stage still ${deal.stageId.replace(/-/g, " ")}`, points: 50 });
    } else if (daysToSettle >= 0 && daysToSettle <= 21 && !stageReady) {
      add({ id: "settle-approaching", label: `Settling in ${daysToSettle}d, stage lagging`, points: 20 });
    }
  }

  // Extended stall
  if (deal.daysSinceContact >= 21) {
    add({ id: "long-stall", label: `${deal.daysSinceContact}d since last contact`, points: deal.overdue.length >= 3 ? 30 : 20 });
  } else if (deal.daysSinceContact >= 14 && deal.overdue.length >= 3) {
    add({ id: "overdue-stall", label: `${deal.overdue.length} overdue docs + ${deal.daysSinceContact}d no contact`, points: 20 });
  }

  // New lead stuck with no docs
  if (deal.stageId === "pre-lodge" && deal.received.length === 0 && deal.daysSinceContact > 5) {
    add({ id: "new-lead-stuck", label: `No docs received after ${deal.daysSinceContact}d`, points: 15 });
  }

  // Large overdue pile-up
  if (deal.overdue.length >= 5) {
    add({ id: "many-overdue", label: `${deal.overdue.length} docs overdue`, points: 15 });
  }

  const finalScore = Math.min(100, score);
  let level: RiskLevel = "none";
  if (finalScore >= 60) level = "critical";
  else if (finalScore >= 35) level = "high";
  else if (finalScore >= 15) level = "medium";
  else if (finalScore > 0) level = "low";

  return { dealId: deal.id, score: finalScore, level, signals };
}
