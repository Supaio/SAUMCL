import assert from "node:assert/strict";
import { test } from "node:test";
import {
  localDateKey,
  playtimeDuration,
  playtimeMonth,
  summarizePlaytime,
} from "../../src/utils/playtime.ts";

const stats = (dailySeconds, totalSeconds = 0) => ({
  dailySeconds,
  totalSeconds,
});

test("today uses the local calendar date", () => {
  const now = new Date(2026, 9, 24, 0, 30);
  assert.equal(localDateKey(now), "2026-10-24");
  assert.equal(
    summarizePlaytime(stats({ "2026-10-24": 3600, "2026-10-23": 7200 }), now)
      .todaySeconds,
    3600
  );
});

test("a week runs Monday to Sunday and counts each played day once", () => {
  const result = summarizePlaytime(
    stats(
      {
        "2026-10-18": 99999,
        "2026-10-19": 3600,
        "2026-10-24": 7200,
        "2026-10-25": 1800,
        "2026-10-26": 99999,
      },
      15000
    ),
    new Date(2026, 9, 25)
  );
  assert.deepEqual(result, {
    todaySeconds: 1800,
    weekSeconds: 12600,
    weekDays: 3,
    totalSeconds: 15000,
    totalDays: 5,
  });
  const monday = summarizePlaytime(
    stats({ "2026-10-25": 7200, "2026-10-26": 60 }),
    new Date(2026, 9, 26)
  );
  assert.equal(monday.weekDays, 1);
  assert.equal(monday.weekSeconds, 60);
});

test("a week can cross a year boundary", () => {
  const result = summarizePlaytime(
    stats({
      "2026-12-28": 3600,
      "2026-12-31": 1800,
      "2027-01-01": 60,
      "2026-12-27": 9999,
    }),
    new Date(2027, 0, 1)
  );
  assert.equal(result.weekDays, 3);
  assert.equal(result.weekSeconds, 5460);
});

test("legacy cumulative history is not invented as daily or weekly play", () => {
  const result = summarizePlaytime(stats({}, 123456), new Date(2026, 9, 24));
  assert.deepEqual(result, {
    todaySeconds: 0,
    weekSeconds: 0,
    weekDays: 0,
    totalSeconds: 123456,
    totalDays: 0,
  });
});

test("total played days count recorded dates across weeks, excluding empty dates", () => {
  const result = summarizePlaytime(
    stats(
      {
        "2026-09-30": 1,
        "2026-10-18": 90000,
        "2026-10-24": 3600,
        "2026-10-20": 0,
      },
      999999
    ),
    new Date(2026, 9, 24)
  );
  assert.equal(result.totalDays, 3);
  assert.equal(result.weekDays, 1);
  assert.equal(result.totalSeconds, 999999);
});

test("the month grid starts Monday, supports leap years and highlights today", () => {
  const cells = playtimeMonth(new Date(2024, 1, 29), { "2024-02-29": 3600 });
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.slice(0, 3), [null, null, null]);
  assert.equal(cells.filter(Boolean).length, 29);
  assert.deepEqual(
    cells.filter((day) => day?.today),
    [{ key: "2024-02-29", day: 29, seconds: 3600, today: true }]
  );
});

test("duration displays hours and whole minutes without rounding unplayed time up", () => {
  assert.deepEqual(playtimeDuration(59), { hours: 0, minutes: 0 });
  assert.deepEqual(playtimeDuration(9059), { hours: 2, minutes: 30 });
  assert.deepEqual(playtimeDuration(360001), { hours: 100, minutes: 0 });
});
