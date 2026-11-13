import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COW_RADIUS,
  MAX_COWS,
  dropCow,
  getCowCapacity,
  resizeCows,
  stepCowPhysics,
} from "../../src/utils/cow-drop.ts";

const advance = (
  cows,
  seconds,
  width = 800,
  height = 600,
  obstacles = [],
  sceneCollision = false
) => {
  for (let frame = 0; frame < seconds * 120; frame++) {
    stepCowPhysics(cows, width, height, 1 / 120, obstacles, sceneCollision);
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
  resizeCows(cows, { width: 800, height: 600 }, { width: 560, height: 400 });
  assert.equal(cows.length, getCowCapacity(560, 400));
  assertContained(cows, 560, 400);
  advance(cows, 3, 560, 400);
  assert.equal(cows.length, getCowCapacity(560, 400));
  assertContained(cows, 560, 400);
});

test("shrinking a full large window trims excess cows, keeps gray cows and settles", (t) => {
  let seed = 9127;
  t.mock.method(Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  const wide = { width: 2000, height: 1000 };
  const small = { width: 1050, height: 650 };
  const launchPanels = [
    { left: 530, top: 550, right: 740, bottom: 630 },
    { left: 760, top: 550, right: 1030, bottom: 630 },
  ];
  const cows = [];
  const capacity = getCowCapacity(wide.width, wide.height);
  for (let frame = 0; frame < 2400; frame++) {
    if (frame < capacity)
      dropCow(cows, Math.random() * wide.width, wide.width, wide.height);
    stepCowPhysics(cows, wide.width, wide.height, 1 / 120);
  }
  const gray = cows[cows.length - 1];
  gray.isGray = true;
  const orientation = gray.angle;
  assert.ok(cows.length > getCowCapacity(small.width, small.height));
  resizeCows(cows, wide, small);
  assert.equal(cows.length, getCowCapacity(small.width, small.height));
  assert.ok(cows.includes(gray));
  assert.equal(gray.angle, orientation);
  assert.ok(
    cows.every(
      (cow) => cow.vx === 0 && cow.vy === 0 && cow.angularVelocity === 0
    )
  );
  assertContained(cows, small.width, small.height);
  assert.equal(dropCow(cows, 400, small.width, small.height), false);
  advance(cows, 15, small.width, small.height, launchPanels);
  assertContained(cows, small.width, small.height);
  assert.ok(cows.every((cow) => Math.abs(cow.angularVelocity) < 0.05));
  const positions = cows.map((cow) => ({ x: cow.x, y: cow.y }));
  advance(cows, 1, small.width, small.height, launchPanels);
  assert.ok(
    cows.every(
      (cow, i) => Math.hypot(cow.x - positions[i].x, cow.y - positions[i].y) < 2
    )
  );
  resizeCows(cows, small, wide);
  const retained = cows.length;
  assert.equal(dropCow(cows, 400, wide.width, wide.height), true);
  assert.equal(cows.length, retained + 1);
});

test("resizing keeps separated cows spread out instead of clamping them together", () => {
  const cows = [
    baseCow({ x: 1000, y: 800, vx: 500, vy: 500, angle: 1 }),
    baseCow({ x: 1800, y: 800, vx: -500, vy: -500, angle: -1 }),
  ];
  resizeCows(cows, { width: 2000, height: 1000 }, { width: 800, height: 600 });
  assert.ok(cows[1].x - cows[0].x > COW_RADIUS * 2);
  assert.deepEqual(
    cows.map((cow) => cow.angle),
    [1, -1]
  );
  assertContained(cows, 800, 600);
});

test("a zero-size minimized viewport preserves cows until a real resize", () => {
  const cows = [baseCow({ vx: 10, angularVelocity: 2 })];
  const original = structuredClone(cows);
  resizeCows(cows, { width: 800, height: 600 }, { width: 0, height: 0 });
  assert.deepEqual(cows, original);
  resizeCows(cows, { width: 800, height: 600 }, { width: 800, height: 600 });
  assert.deepEqual(cows, original);
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

test("a cow lands on the globe's curved surface instead of its square bounds", () => {
  const globe = {
    left: 280,
    top: 200,
    right: 520,
    bottom: 440,
    shape: "circle",
  };
  const pole = [baseCow({ x: 400 })];
  advance(pole, 4, 800, 600, [globe], true);
  assert.ok(Math.abs(pole[0].y - (globe.top - COW_RADIUS)) < 0.1);
  const corner = baseCow({ x: 290, y: 210, radius: 14 });
  stepCowPhysics([corner], 800, 600, 1 / 120, [globe]);
  assert.equal(corner.x, 290);
  assert.ok(corner.y > 210);
});

test("a cow slides down the side of the globe and settles on the floor", () => {
  const globe = {
    left: 280,
    top: 200,
    right: 520,
    bottom: 440,
    shape: "circle",
  };
  const cows = [baseCow({ x: 480, y: 100 })];
  advance(cows, 8, 800, 600, [globe], true);
  assert.equal(cows[0].y, 600 - COW_RADIUS);
  assert.ok(cows[0].x > globe.right);
  assertContained(cows, 800, 600);
});

test("round card corners leave the visible corner space free", () => {
  const rounded = {
    left: 250,
    top: 300,
    right: 550,
    bottom: 500,
    cornerRadius: 40,
  };
  const cow = baseCow({ x: 251, y: 301, radius: 10 });
  stepCowPhysics([cow], 800, 600, 1 / 120, [rounded]);
  assert.equal(cow.x, 251);
  assert.ok(cow.y > 301);
});

test("dragging a tile pushes a cow with a bounded impact velocity", () => {
  const moving = { left: 200, top: 250, right: 400, bottom: 450, vx: 200 };
  const cow = baseCow({ x: 420, y: 350 });
  stepCowPhysics([cow], 800, 600, 1 / 120, [moving]);
  assert.ok(cow.x >= moving.right + cow.radius);
  assert.ok(cow.vx > 100 && cow.vx <= 600);
  assertContained([cow], 800, 600);
});

test("nearby tiles expel a large cow from an impossible gap without oscillation", () => {
  const tiles = [
    { left: 150, top: 150, right: 400, bottom: 450 },
    { left: 415, top: 150, right: 665, bottom: 450 },
  ];
  const cows = [baseCow({ x: 407.5, y: 300, radius: 56 })];
  advance(cows, 6, 800, 600, tiles, true);
  assertContained(cows, 800, 600);
  for (const tile of tiles) {
    const dx = cows[0].x - Math.max(tile.left, Math.min(tile.right, cows[0].x));
    const dy = cows[0].y - Math.max(tile.top, Math.min(tile.bottom, cows[0].y));
    assert.ok(Math.hypot(dx, dy) >= cows[0].radius - 0.1);
  }
  const position = { x: cows[0].x, y: cows[0].y };
  advance(cows, 1, 800, 600, tiles, true);
  assert.ok(Math.hypot(cows[0].x - position.x, cows[0].y - position.y) < 2);
});

test("scene elements occupy capacity without double-counting overlapping controls", () => {
  const tile = { left: 200, top: 100, right: 650, bottom: 500 };
  const button = { left: 250, top: 200, right: 350, bottom: 250 };
  const capacity = getCowCapacity(800, 600, [tile], true);
  assert.ok(capacity < getCowCapacity(800, 600));
  assert.equal(getCowCapacity(800, 600, [tile, button]), capacity);
  assert.equal(
    getCowCapacity(800, 600, [{ left: 0, top: 0, right: 800, bottom: 600 }]),
    0
  );
});

test("new cows enter through a free top position beside the navigation and tiles", (t) => {
  t.mock.method(Math, "random", () => 0.5);
  const obstacles = [
    { left: 0, top: 0, right: 100, bottom: 600 },
    { left: 200, top: 10, right: 550, bottom: 350 },
  ];
  const cows = [];
  assert.equal(dropCow(cows, 300, 800, 600, obstacles), true);
  assert.equal(cows[0].y, cows[0].radius);
  assert.ok(
    cows[0].x <= obstacles[1].left - cows[0].radius ||
      cows[0].x >= obstacles[1].right + cows[0].radius
  );
  advance(cows, 3, 800, 600, obstacles, true);
  assertContained(cows, 800, 600);
});

test("a smaller scene reserves space for tiles and retains rare cows first", () => {
  const cows = Array.from({ length: 100 }, (_, index) =>
    baseCow({ x: 100 + index * 5, y: 200 })
  );
  cows[cows.length - 1].isGray = true;
  const rare = cows[cows.length - 1];
  const tile = { left: 150, top: 100, right: 650, bottom: 450 };
  resizeCows(cows, { width: 1400, height: 900 }, { width: 800, height: 600 }, [
    tile,
  ]);
  assert.equal(cows.length, getCowCapacity(800, 600, [tile]));
  assert.ok(cows.includes(rare));
  advance(cows, 4, 800, 600, [tile], true);
  assertContained(cows, 800, 600);
});

test("a full scene with tiles, sidebar and globe avoids tunneling and sudden jumps", (t) => {
  let seed = 9127;
  t.mock.method(Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  const obstacles = [
    { left: 16, top: 16, right: 100, bottom: 880 },
    { left: 140, top: 45, right: 510, bottom: 520 },
    { left: 535, top: 45, right: 970, bottom: 340 },
    { left: 535, top: 365, right: 900, bottom: 580 },
    { left: 1100, top: 190, right: 1320, bottom: 410, shape: "circle" },
    { left: 900, top: 760, right: 1110, bottom: 875 },
    { left: 1130, top: 760, right: 1380, bottom: 875 },
  ];
  const cows = [];
  const capacity = getCowCapacity(1400, 900, obstacles, true);
  for (let frame = 0; frame < 2400; frame++) {
    if (cows.length < capacity)
      dropCow(cows, Math.random() * 1400, 1400, 900, obstacles, true);
    stepCowPhysics(cows, 1400, 900, 1 / 120, obstacles, true);
  }
  assert.equal(cows.length, capacity);
  assertContained(cows, 1400, 900);
  for (let frame = 0; frame < 120; frame++) {
    const positions = cows.map(({ x, y }) => ({ x, y }));
    stepCowPhysics(cows, 1400, 900, 1 / 120, obstacles, true);
    assertContained(cows, 1400, 900);
    for (let index = 0; index < cows.length; index++) {
      const cow = cows[index];
      assert.ok(
        Math.hypot(cow.x - positions[index].x, cow.y - positions[index].y) < 12
      );
      for (const obstacle of obstacles) {
        const circle = obstacle.shape === "circle";
        const dx =
          cow.x -
          (circle
            ? (obstacle.left + obstacle.right) / 2
            : Math.max(obstacle.left, Math.min(obstacle.right, cow.x)));
        const dy =
          cow.y -
          (circle
            ? (obstacle.top + obstacle.bottom) / 2
            : Math.max(obstacle.top, Math.min(obstacle.bottom, cow.y)));
        assert.ok(
          Math.hypot(dx, dy) >=
            cow.radius +
              (circle ? (obstacle.right - obstacle.left) / 2 : 0) -
              0.1
        );
      }
    }
  }
});

test("a cow at the globe/window gap does not jump back to the north pole", () => {
  const cow = baseCow({ x: 1358.831, y: 271.447, radius: 41.1573, vy: 500 });
  const globe = {
    left: 1100,
    top: 190,
    right: 1320,
    bottom: 410,
    shape: "circle",
  };
  const before = { x: cow.x, y: cow.y };
  stepCowPhysics([cow], 1400, 900, 1 / 120, [globe], true);
  assert.ok(Math.hypot(cow.x - before.x, cow.y - before.y) < 8);
  assert.ok(cow.y > 260);
  assertContained([cow], 1400, 900);
});
