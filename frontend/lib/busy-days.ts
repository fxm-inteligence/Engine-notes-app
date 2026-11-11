/** One day of a calendar of the times that are taken. */
export interface BusyDay {
  /** The date, `2030-05-01`. */
  key: string;
  /** The date as the browser writes it for a person, `Wed, 1 May`. */
  label: string;
  /** The times taken on this day, `10:00–12:00`, soonest first. */
  times: string[];
}

const pad = (value: number): string => String(value).padStart(2, "0");
const clock = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/**
 * The next `days` days from today, each with the times that are taken, in the time of the browser. `times` is the
 * answer of a busy route, `{ start, end, resource }` for each; with a `resource` only that one's are kept. Nothing
 * while the answer has not come.
 */
export function busyDays(times: unknown, days = 14, resource = ""): BusyDay[] {
  if (!Array.isArray(times)) return [];
  const taken = times
    .map((time) => (time ?? {}) as Record<string, unknown>)
    .filter((time) => resource === "" || String(time.resource ?? "") === resource)
    .map((time) => ({ start: new Date(String(time.start)), end: new Date(String(time.end)) }))
    .filter((time) => !Number.isNaN(time.start.getTime()) && !Number.isNaN(time.end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const now = new Date();
  const calendar: BusyDay[] = [];
  for (let offset = 0; offset < Math.max(0, Math.floor(days)); offset++) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1);
    calendar.push({
      key: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      label: from.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
      times: taken
        .filter((time) => time.start < to && time.end > from)
        .map((time) => {
          const start = time.start > from ? time.start : from;
          const end = time.end < to ? time.end : to;
          return `${clock(start)}–${end.getTime() === to.getTime() ? "24:00" : clock(end)}`;
        }),
    });
  }
  return calendar;
}
