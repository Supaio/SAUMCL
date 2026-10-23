import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COW_RADIUS,
  MAX_COWS,
  containCows,
  dropCow,
  getCowCapacity,
  stepCowPhysics,
} from "../../src/utils/cow-drop.ts";

const advance = (cows, seconds, width = 800, height = 600, obstacles = []) => {
  for (let frame = 0; frame < seconds * 120; frame++) {
    stepCowPhysics(cows, width, height, 1 / 120, obstacles);
  }
};

const assertContained = (cows, width, height) => {
  for (const cow of cows) {
    assert.ok(
      [
        cow.x,
        cow.y,
        cow.vx,
        cow.vy,
        cow.radius,
        cow.angle,
        cow.angularVelocity,
      ].every(Number.isFinite)
    );
    assert.ok(cow.x >= cow.radius && cow.x <= width - cow.radius);
    assert.ok(cow.y >= cow.radius && cow.y <= height - cow.radius);
  }
};

const baseCow = (overrides) => ({
  x: 400,
  y: COW_RADIUS,
  vx: 0,
  vy: 0,
  angle: 0,
  angularVelocity: 0,
  radius: COW_RADIUS,
  isGray: false,
  ...overrides,
});

test("a large window can hold more than the old 100-cow limit", () => {
  const cows = [];
  for (let i = 0; i < 150; i++) {
    assert.equal(dropCow(cows, (i * 97) % 1600, 1600, 900), true);
  }
  assert.equal(cows.length, 150);
});

test("a falling cow rotates, then stops rotating after settling", () => {
  const cows = [];
  dropCow(cows, 400, 800, 600);
  advance(cows, 0.5);
  assert.ok(Math.abs(cows[0].angle) > 0.5);
  advance(cows, 8);
  assert.ok(Math.abs(cows[0].angularVelocity) < 0.01);
  const restingAngle = cows[0].angle;
  advance(cows, 2);
  assert.ok(Math.abs(cows[0].angle - restingAngle) < 0.01);
  assertContained(cows, 800, 600);
});

test("size is randomized from 50% to 200% and gray cows use a 0.0082% chance", (t) => {
  const values = [0, 0.000081999, 0.999999, 0.000082];
  t.mock.method(Math, "random", () => values.shift());
  const cows = [];
  dropCow(cows, 200, 800, 600);
  dropCow(cows, 600, 800, 600);
  assert.equal(cows[0].radius, COW_RADIUS * 0.5);
  assert.ok(cows[1].radius > COW_RADIUS * 1.99);
  assert.ok(cows[1].radius <= COW_RADIUS * 2);
  assert.equal(cows[0].isGray, true);
  assert.equal(cows[1].isGray, false);
});

test("even a large screen stops at 500 cows", () => {
  const cows = [];
  for (let i = 0; i < 500; i++) {
    assert.equal(dropCow(cows, (i * 97) % 4000, 4000, 2400), true);
  }
  assert.equal(dropCow(cows, 2000, 4000, 2400), false);
  assert.equal(cows.length, 500);
});

test("wall impacts cause rotation without spinning forever", () => {
  const cows = [baseCow({ x: COW_RADIUS + 1, y: 250, vx: -400, vy: 150 })];
  advance(cows, 0.2);
  assert.ok(Math.abs(cows[0].angle) > 0.1);
  advance(cows, 8);
  assert.ok(Math.abs(cows[0].angularVelocity) < 0.01);
  assertContained(cows, 800, 600);
});

test("a full window of random-sized cows settles without spinning in place", (t) => {
  let seed = 9127;
  t.mock.method(Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  const cows = [];
  const capacity = getCowCapacity(1400, 780);
  for (let frame = 0; frame < 2400; frame++) {
    if (frame < capacity) dropCow(cows, Math.random() * 1400, 1400, 780);
    stepCowPhysics(cows, 1400, 780, 1 / 120);
  }
  assert.equal(cows.length, capacity);
  assertContained(cows, 1400, 780);
  assert.ok(cows.every((cow) => Math.abs(cow.angularVelocity) < 0.05));
});

test("each drop adds exactly one cow; the limit stops further drops", () => {
  const cows = [];
  const capacity = getCowCapacity(800, 600);
  for (let i = 0; i < capacity; i++) {
    assert.equal(dropCow(cows, 400, 800, 600), true);
    assert.equal(cows.length, i + 1);
  }
  assert.equal(dropCow(cows, 400, 800, 600), false);
  assert.equal(cows.length, capacity);
  assert.equal(dropCow([], 0, 20, 20), false);
  assert.ok(getCowCapacity(575, 369) < 100);
  assert.ok(getCowCapacity(1600, 900) > 100);
  assert.equal(getCowCapacity(20000, 20000), MAX_COWS);
});

test("a cow falls and settles on the floor inside the window", () => {
  const cows = [];
  dropCow(cows, 400, 800, 600);
  const startY = cows[0].y;
  assert.equal(startY, cows[0].radius);
  advance(cows, 0.1);
  assert.ok(cows[0].y > startY);
  advance(cows, 8);
  assert.equal(cows[0].y, 600 - cows[0].radius);
  assert.ok(Math.abs(cows[0].vy) < 1);
  assertContained(cows, 800, 600);
});

test("coincident cows separate without disappearing or merging", () => {
  const cows = [];
  dropCow(cows, 400, 800, 600);
  dropCow(cows, 400, 800, 600);
  advance(cows, 5);
  assert.equal(cows.length, 2);
  assert.ok(
    Math.hypot(cows[0].x - cows[1].x, cows[0].y - cows[1].y) >=
      cows[0].radius + cows[1].radius - 1
  );
  assertContained(cows, 800, 600);
});

test("cows dropped in sequence stack instead of passing through one another", () => {
  const cows = [];
  for (let i = 0; i < 4; i++) {
    dropCow(cows, 400, 800, 600);
    advance(cows, 1);
  }
  advance(cows, 6);
  const ordered = [...cows].sort((a, b) => b.y - a.y);
  assert.equal(ordered.length, 4);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      ordered[i - 1].y - ordered[i].y >
        ordered[i - 1].radius + ordered[i].radius - 1
    );
  }
  assertContained(cows, 800, 600);
});

test("wall clicks, resizing and a full window keep all cows finite and contained", () => {
  const cows = [];
  const capacity = getCowCapacity(800, 600);
  for (let i = 0; i < capacity; i++) {
    dropCow(cows, i % 2 ? -100 : 900, 800, 600);
  }
  advance(cows, 3);
  containCows(cows, 560, 400);
  assertContained(cows, 560, 400);
  advance(cows, 3, 560, 400);
  assert.equal(cows.length, capacity);
  assertContained(cows, 560, 400);
});

const panel = { left: 250, top: 400, right: 550, bottom: 550 };

test("a cow lands on a launcher panel and falls when the panel disappears", () => {
  const cows = [];
  dropCow(cows, 400, 800, 600);
  advance(cows, 5, 800, 600, [panel]);
  assert.ok(Math.abs(cows[0].y - (panel.top - cows[0].radius)) < 0.1);
  assert.ok(Math.abs(cows[0].vy) < 1);
  advance(cows, 2);
  assert.equal(cows[0].y, 600 - cows[0].radius);
});

test("a moving cow bounces off the side and underside of a panel", () => {
  const side = baseCow({
    x: panel.left - COW_RADIUS - 1,
    y: 450,
    vx: 300,
    vy: 0,
  });
  stepCowPhysics([side], 800, 600, 1 / 120, [panel]);
  assert.ok(side.x <= panel.left - COW_RADIUS);
  assert.ok(side.vx < 0);
  const underneath = baseCow({
    x: 400,
    y: panel.bottom + COW_RADIUS - 1,
    vx: 0,
    vy: -300,
  });
  stepCowPhysics([underneath], 800, 700, 1 / 120, [panel]);
  assert.ok(underneath.y >= panel.bottom + COW_RADIUS);
  assert.ok(underneath.vy > 0);
});

test("a cow near a panel corner can slide off without entering the panel", () => {
  const cows = [baseCow({ x: panel.left - 12, y: panel.top - COW_RADIUS })];
  advance(cows, 2, 800, 600, [panel]);
  assert.ok(cows[0].x < panel.left - COW_RADIUS);
  assert.ok(cows[0].y > panel.top);
  assertContained(cows, 800, 600);
});

test("a resized panel pushes a cow out of a gap too small for it to fit", () => {
  const cows = [baseCow({ y: 600 - COW_RADIUS })];
  const resizedPanel = { ...panel, bottom: 585 };
  stepCowPhysics(cows, 800, 600, 1 / 120, [resizedPanel]);
  assert.ok(cows[0].y <= resizedPanel.top - COW_RADIUS);
  assertContained(cows, 800, 600);
});

test("cows stack on a panel and still keep their count", () => {
  const cows = [];
  for (let i = 0; i < 4; i++) {
    dropCow(cows, 400, 800, 600);
    advance(cows, 1, 800, 600, [panel]);
  }
  advance(cows, 5, 800, 600, [panel]);
  assert.equal(cows.length, 4);
  assert.ok(cows.every((cow) => cow.y <= panel.top - cow.radius + 0.1));
  const ordered = [...cows].sort((a, b) => b.y - a.y);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      ordered[i - 1].y - ordered[i].y >
        ordered[i - 1].radius + ordered[i].radius - 1
    );
  }
});
