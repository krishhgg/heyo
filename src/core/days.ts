// Local calendar days, as YYYY-MM-DD strings.

/** The local calendar day of a time. */
export function dayOf(epoch: number): string {
  const date = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from one day to a later one. The same day gives 0. */
export function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** The day `count` days after a day. */
export function addDays(day: string, count: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}
