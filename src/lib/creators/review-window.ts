export const REVIEW_WINDOW_HOURS = 72;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface TimeLeft {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
}

export function reviewDeadlineFrom(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + REVIEW_WINDOW_HOURS * HOUR_MS);
}

export function timeLeft(deadline: string | Date, now: Date): TimeLeft {
  const ms = new Date(deadline).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { expired: true, days: 0, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  return {
    expired: false,
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
  };
}

export function isReviewWindowOver(deadline: string | Date | null, now: Date): boolean {
  if (!deadline) return false;
  return timeLeft(deadline, now).expired;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatTimeLeft(left: TimeLeft): string {
  if (left.expired) return "Vencido";
  if (left.days > 0) return `${plural(left.days, "día", "días")} ${plural(left.hours, "hora", "horas")}`;
  if (left.hours > 0) return `${plural(left.hours, "hora", "horas")} ${left.minutes} min`;
  return `${left.minutes} min`;
}

export function revisionsLeft(included: number, used: number): number {
  if (!Number.isInteger(included) || included < 0) return 0;
  return Math.max(0, included - Math.max(0, used));
}
