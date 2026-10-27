import assert from "node:assert/strict";
import { test } from "node:test";
import { getSunPosition } from "../../src/utils/solar.ts";

const degrees = (radians) => (radians * 180) / Math.PI;
const sunAt = (iso) => getSunPosition(Date.parse(iso));
const altitudeSine = (sun, latitude, longitude) => {
  const phi = (latitude * Math.PI) / 180;
  const hourAngle = (longitude * Math.PI) / 180 - sun.longitude;
  return (
    Math.sin(phi) * Math.sin(sun.declination) +
    Math.cos(phi) * Math.cos(sun.declination) * Math.cos(hourAngle)
  );
};

test("solstices put the Sun above the correct tropic and polar hemisphere", () => {
  const june = sunAt("2026-06-21T12:00:00Z");
  const december = sunAt("2026-12-21T12:00:00Z");
  assert.ok(Math.abs(degrees(june.declination) - 23.44) < 0.4);
  assert.ok(Math.abs(degrees(december.declination) + 23.44) < 0.4);
  assert.ok(altitudeSine(june, 90, 0) > 0);
  assert.ok(altitudeSine(june, -90, 0) < 0);
  assert.ok(altitudeSine(december, 90, 0) < 0);
  assert.ok(altitudeSine(december, -90, 0) > 0);
});

test("UTC determines the real day and night in China", () => {
  const noon = sunAt("2026-03-20T04:00:00Z");
  const midnight = sunAt("2026-03-20T16:00:00Z");
  assert.ok(Math.abs(degrees(noon.declination)) < 1);
  assert.ok(Math.abs(degrees(noon.longitude) - 120) < 4);
  assert.ok(altitudeSine(noon, 39.9, 116.4) > 0.5);
  assert.ok(altitudeSine(midnight, 39.9, 116.4) < -0.5);
});

test("the subsolar meridian moves west as UTC advances", () => {
  const first = sunAt("2026-10-26T03:00:00Z");
  const next = sunAt("2026-10-26T04:00:00Z");
  assert.ok(Math.abs(degrees(first.longitude - next.longitude) - 15) < 0.1);
});

test("leap days and year boundaries keep finite, continuous solar positions", () => {
  for (const dates of [
    ["2024-02-28T12:00:00Z", "2024-02-29T12:00:00Z", "2024-03-01T12:00:00Z"],
    ["2026-12-31T12:00:00Z", "2027-01-01T12:00:00Z"],
  ]) {
    const positions = dates.map(sunAt);
    for (const position of positions) {
      assert.ok(Number.isFinite(position.declination));
      assert.ok(
        position.longitude >= -Math.PI && position.longitude <= Math.PI
      );
    }
    for (let i = 1; i < positions.length; i++) {
      assert.ok(
        Math.abs(
          degrees(positions[i].declination - positions[i - 1].declination)
        ) < 0.5
      );
    }
  }
});

test("the selected device time zone does not affect the Sun position", () => {
  const originalZone = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Honolulu";
    const first = sunAt("2026-10-26T16:00:00Z");
    process.env.TZ = "Asia/Tokyo";
    assert.deepEqual(sunAt("2026-10-26T16:00:00Z"), first);
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});
