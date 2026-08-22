const TZ = "Europe/Lisbon";

export interface LisbonParts {
  dateKey: string;
  hour: number;
  minute: number;
  weekday: number;
}

/** weekday: 1=Mon … 7=Sun (ISO). */
export function lisbonParts(now = new Date()): LisbonParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const weekdayName = (map.weekday ?? "").toLowerCase().replace(".", "");
  const wd: Record<string, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 7,
  };
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: wd[weekdayName.slice(0, 3)] ?? 0,
  };
}

export function shouldFireDaily(opts: {
  lastDateKey: string | null;
  hour: number;
  weekdaysOnly: boolean;
  now?: Date;
}): boolean {
  const p = lisbonParts(opts.now);
  if (opts.weekdaysOnly && (p.weekday < 1 || p.weekday > 5)) return false;
  if (p.hour < opts.hour) return false;
  return opts.lastDateKey !== p.dateKey;
}
