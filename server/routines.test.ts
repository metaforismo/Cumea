import { describe, expect, it } from "vitest";

import { nextOccurrence, projectOccurrences, validateSchedule } from "./routines.ts";

describe("routine occurrence projection", () => {
  it("skips a nonexistent spring-forward wall time", () => {
    const after = Date.parse("2026-03-07T08:00:00.000Z");
    expect(
      new Date(nextOccurrence({ kind: "daily", time: "02:30", timezone: "America/New_York" }, after)).toISOString(),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("uses only the first instant in a fall-back fold", () => {
    const schedule = { kind: "daily", time: "01:30", timezone: "America/New_York" } as const;
    const first = nextOccurrence(schedule, Date.parse("2026-10-31T12:00:00.000Z"));
    expect(new Date(first).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(new Date(nextOccurrence(schedule, first)).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });

  it("keeps weekly schedules on their IANA-local weekday across DST", () => {
    const occurrences = projectOccurrences(
      { kind: "weekly", time: "09:00", timezone: "Europe/Rome", weekdays: [1] },
      Date.parse("2026-03-20T00:00:00.000Z"),
      Date.parse("2026-04-07T00:00:00.000Z"),
      10,
    );
    expect(occurrences.map((item) => new Date(item.scheduledFor).toISOString())).toEqual([
      "2026-03-23T08:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
      "2026-04-06T07:00:00.000Z",
    ]);
  });

  it("bounds projections and validates IANA zones", () => {
    expect(projectOccurrences({ kind: "interval", everyMinutes: 5 }, 0, 24 * 60 * 60_000, 3)).toHaveLength(3);
    expect(() => validateSchedule({ kind: "daily", time: "09:00", timezone: "Mars/Olympus" })).toThrow(/timezone/);
  });
});
