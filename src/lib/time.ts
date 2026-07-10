// Small time helpers. YouTube quota resets at midnight Pacific (plan §4), so a
// quota-parked job wakes shortly after the next midnight PT.

/** ISO timestamp of the next midnight in America/Los_Angeles, +2 min slack. */
export function nextMidnightPacificISO(now: Date = new Date()): string {
  // Current wall-clock time in Los Angeles.
  const laNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const laMidnight = new Date(laNow);
  laMidnight.setHours(24, 2, 0, 0); // 00:02 tomorrow, PT
  // Offset between this machine's interpretation and real UTC.
  const deltaMs = now.getTime() - laNow.getTime();
  return new Date(laMidnight.getTime() + deltaMs).toISOString();
}

export function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
