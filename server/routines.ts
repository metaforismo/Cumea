export type RoutineSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; time: string; timezone: string }
  | { kind: "weekly"; time: string; timezone: string; weekdays: number[] };

export type RoutineCatchUpPolicy = "latest" | "skip";

export interface ProjectedOccurrence {
  scheduledFor: number;
  localDate: string;
  localTime: string;
  timezone: string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  // Force ICU to reject an unknown IANA identifier here, not in the scheduler.
  created.format(0);
  formatters.set(timezone, created);
  return created;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

function zonedParts(at: number, timezone: string): ZonedParts {
  const parts = formatter(timezone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS[get("weekday")] ?? -1,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function dateKey(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function addLocalDays(parts: Pick<ZonedParts, "year" | "month" | "day">, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Resolve a local wall-clock value to its canonical instant.
 *
 * A spring-forward gap has no instant and is skipped. A fall-back fold has two
 * instants; choosing the earliest ensures a routine runs once, not twice.
 */
function resolveWallClock(
  date: Pick<ZonedParts, "year" | "month" | "day">,
  hour: number,
  minute: number,
  timezone: string,
): number | null {
  const utcGuess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let earliest: number | null = null;
  // Modern IANA UTC offsets are quarter-hour aligned. Looking at those
  // boundaries keeps this deterministic without a minute-by-minute day scan.
  for (let offset = -18 * 60; offset <= 18 * 60; offset += 15) {
    const candidate = utcGuess + offset * MINUTE_MS;
    const parts = zonedParts(candidate, timezone);
    if (
      parts.year === date.year &&
      parts.month === date.month &&
      parts.day === date.day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      earliest = earliest === null ? candidate : Math.min(earliest, candidate);
    }
  }
  return earliest;
}

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateSchedule(schedule: RoutineSchedule): RoutineSchedule {
  if (schedule.kind === "interval") {
    const everyMinutes = schedule.everyMinutes;
    if (!Number.isSafeInteger(everyMinutes) || everyMinutes < 5 || everyMinutes > 43_200) {
      throw Object.assign(new Error("interval must be between 5 minutes and 30 days"), { status: 400 });
    }
    return { kind: "interval", everyMinutes };
  }
  if (!validTime(schedule.time)) {
    throw Object.assign(new Error("schedule time must use HH:MM"), { status: 400 });
  }
  try {
    formatter(schedule.timezone);
  } catch {
    throw Object.assign(new Error("invalid schedule timezone"), { status: 400 });
  }
  if (schedule.kind === "weekly") {
    if (!Array.isArray(schedule.weekdays) || schedule.weekdays.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) {
      throw Object.assign(new Error("weekly weekdays must be integers from 0 through 6"), { status: 400 });
    }
    const weekdays = [...new Set(schedule.weekdays)]
      .sort((left, right) => left - right);
    if (!weekdays.length) throw Object.assign(new Error("weekly schedules need at least one weekday"), { status: 400 });
    return { kind: "weekly", time: schedule.time, timezone: schedule.timezone, weekdays };
  }
  return { kind: "daily", time: schedule.time, timezone: schedule.timezone };
}

/** Return the first occurrence strictly after `after`. */
export function nextOccurrence(scheduleInput: RoutineSchedule, after: number): number {
  const schedule = validateSchedule(scheduleInput);
  if (schedule.kind === "interval") return after + schedule.everyMinutes * MINUTE_MS;

  const [hour, minute] = schedule.time.split(":").map(Number);
  const localStart = zonedParts(after, schedule.timezone);
  for (let offset = 0; offset <= 15; offset += 1) {
    const localDate = addLocalDays(localStart, offset);
    const noon = resolveWallClock(localDate, 12, 0, schedule.timezone);
    if (noon === null) continue;
    const weekday = zonedParts(noon, schedule.timezone).weekday;
    if (schedule.kind === "weekly" && !schedule.weekdays.includes(weekday)) continue;
    const candidate = resolveWallClock(localDate, hour, minute, schedule.timezone);
    if (candidate !== null && candidate > after) return candidate;
  }
  throw new Error("could not calculate the next routine occurrence");
}

/** Bounded projection for calendar UI and catch-up decisions. */
export function projectOccurrences(
  scheduleInput: RoutineSchedule,
  from: number,
  to: number,
  limit = 256,
): ProjectedOccurrence[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const boundedLimit = Math.max(0, Math.min(512, Math.floor(limit)));
  if (!boundedLimit) return [];
  const schedule = validateSchedule(scheduleInput);
  const occurrences: ProjectedOccurrence[] = [];
  let cursor = from - 1;
  while (occurrences.length < boundedLimit) {
    const scheduledFor = nextOccurrence(schedule, cursor);
    if (scheduledFor > to) break;
    const timezone = schedule.kind === "interval" ? "UTC" : schedule.timezone;
    const parts = schedule.kind === "interval"
      ? zonedParts(scheduledFor, "UTC")
      : zonedParts(scheduledFor, schedule.timezone);
    occurrences.push({
      scheduledFor,
      localDate: dateKey(parts),
      localTime: `${parts.hour.toString().padStart(2, "0")}:${parts.minute.toString().padStart(2, "0")}`,
      timezone,
    });
    cursor = scheduledFor;
  }
  return occurrences;
}

/** Project from a known persisted occurrence. Unlike `projectOccurrences`,
 * this preserves the anchor of interval schedules. */
export function projectFromOccurrence(
  scheduleInput: RoutineSchedule,
  first: number,
  to: number,
  limit = 256,
): number[] {
  const schedule = validateSchedule(scheduleInput);
  const boundedLimit = Math.max(0, Math.min(512, Math.floor(limit)));
  if (!boundedLimit || first > to) return [];
  const occurrences = [first];
  while (occurrences.length < boundedLimit) {
    const candidate = nextOccurrence(schedule, occurrences.at(-1)!);
    if (candidate > to) break;
    occurrences.push(candidate);
  }
  return occurrences;
}

export const ROUTINE_CATCH_UP_WINDOW_MS = 12 * 60 * 60_000;
export const ROUTINE_PROJECTION_WINDOW_MS = 7 * DAY_MS;
