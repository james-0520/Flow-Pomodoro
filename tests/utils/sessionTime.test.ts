import { expect, test, vi } from "vitest";
import { toDate, toReadableTime, toTimestamp } from "../../utils/sessionTime";
import { TimerMode } from "../../types";

test("toTimestamp handles number and valid date string", () => {
  const now = Date.now();
  expect(toTimestamp(now)).toBe(now);
  expect(toTimestamp("2024-01-02T03:04:05.000Z")).toBe(Date.parse("2024-01-02T03:04:05.000Z"));
});

test("toTimestamp returns 0 for invalid date string", () => {
  expect(toTimestamp("not-a-date")).toBe(0);
});

test("toDate converts value to Date instance", () => {
  const result = toDate(1700000000000);
  expect(result instanceof Date).toBe(true);
  expect(result.getTime()).toBe(1700000000000);
});

test("toReadableTime returns a local ISO-like string", () => {
  const output = toReadableTime("2024-01-02T03:04:05.678Z");
  expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
});

test("toReadableTime supports both positive and negative timezone offsets", () => {
  const offsetSpy = vi.spyOn(Date.prototype, "getTimezoneOffset");
  try {
    offsetSpy.mockReturnValue(-120);
    expect(toReadableTime(0)).toMatch(/\+02:00$/);

    offsetSpy.mockReturnValue(150);
    expect(toReadableTime(0)).toMatch(/-02:30$/);
  } finally {
    offsetSpy.mockRestore();
  }
});

test("TimerMode enum is available", () => {
  expect(TimerMode.FLOW).toBe("FLOW");
  expect(TimerMode.BREAK).toBe("BREAK");
  expect(TimerMode.IDLE).toBe("IDLE");
});
