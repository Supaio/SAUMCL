import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME_TILE_DEFINITIONS } from "../../src/models/home-tiles.ts";
import {
  changeHomeTileRect,
  fitHomeTile,
  homeTilesOverlap,
  parseHomeTileLayout,
  resolveHomeTiles,
} from "../../src/utils/home-tiles.ts";

const wide = { width: 1100, height: 650 };
const narrow = { width: 450, height: 450 };
const server = HOME_TILE_DEFINITIONS[0];
const calendar = HOME_TILE_DEFINITIONS[1];
const layout = (preferences = {}, bounds = wide) =>
  resolveHomeTiles(HOME_TILE_DEFINITIONS, preferences, bounds);
const checkBoundsAndOverlap = ({ tiles, height }, bounds) => {
  const rects = Object.values(tiles);
  for (const rect of rects) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= bounds.width);
    assert.ok(rect.y + rect.height <= bounds.height);
    assert.ok(Object.values(rect).every(Number.isFinite));
  }
  assert.equal(height, bounds.height);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++)
      assert.equal(homeTilesOverlap(rects[i], rects[j]), false);
  }
};

test("default tiles sit side by side in a wide viewport", () => {
  const result = layout();
  checkBoundsAndOverlap(result, wide);
  assert.equal(result.tiles[server.id].x, 0);
  assert.ok(result.tiles[calendar.id].x >= server.defaultWidth);
  assert.equal(result.tiles[calendar.id].y, 0);
});

test("tiles can sit eight pixels apart without being pushed down", () => {
  const result = layout({
    [server.id]: { x: 0, y: 0, width: 420, height: 240 },
    [calendar.id]: { x: 428, y: 0, width: 360, height: 420 },
  });
  assert.equal(result.tiles[server.id].y, 0);
  assert.equal(result.tiles[calendar.id].y, 0);
  assert.equal(result.tiles[calendar.id].x, 428);
});

test("narrow and short viewports fit tiles inside one visible canvas", () => {
  const bounds = { width: 250, height: 180 };
  const result = layout({}, bounds);
  checkBoundsAndOverlap(result, bounds);
  assert.equal(result.tiles[calendar.id].width, 250);
  assert.ok(result.tiles[calendar.id].y >= result.tiles[server.id].height);
  assert.equal(result.height, bounds.height);
});

test("layout parsing rejects malformed, unsupported and nonfinite values", () => {
  for (const value of [null, [], "x", { schemaVersion: 2, tiles: {} }])
    assert.deepEqual(parseHomeTileLayout(value), {});
  assert.deepEqual(
    parseHomeTileLayout({
      schemaVersion: 1,
      tiles: {
        valid: { x: 10, y: 20, width: 300, height: 250, extra: 1 },
        partial: { x: -1, y: Infinity, width: 350, height: NaN },
        invalid: { x: "10", y: -1, width: 0, height: 10001 },
        empty: null,
      },
    }),
    {
      valid: { x: 10, y: 20, width: 300, height: 250 },
      partial: { width: 350 },
    }
  );
});

test("legacy width and height can be imported without invented positions", () => {
  const imported = parseHomeTileLayout({
    schemaVersion: 1,
    tiles: { [server.id]: { width: 480, height: 320 } },
  });
  const result = layout(imported);
  assert.deepEqual(result.tiles[server.id], {
    x: 0,
    y: 0,
    width: 480,
    height: 320,
  });
});

test("saved positions survive a JSON roundtrip and a page remount", () => {
  const result = layout({
    [server.id]: { x: 25, y: 100, width: 420, height: 260 },
    [calendar.id]: { x: 550, y: 70, width: 400, height: 480 },
  });
  const stored = parseHomeTileLayout(
    JSON.parse(JSON.stringify({ schemaVersion: 1, tiles: result.tiles }))
  );
  assert.deepEqual(layout(stored), result);
});

test("a valid saved stacked layout keeps both tile sizes unchanged", () => {
  const stored = {
    [server.id]: { x: 0, y: 0, width: 640, height: 240 },
    [calendar.id]: { x: 0, y: 248, width: 900, height: 380 },
  };
  const result = layout(stored);
  checkBoundsAndOverlap(result, wide);
  assert.deepEqual(result.tiles[server.id], stored[server.id]);
  assert.deepEqual(result.tiles[calendar.id], stored[calendar.id]);
});

test("moving clamps to the visible canvas bounds", () => {
  const rect = layout().tiles[calendar.id];
  assert.deepEqual(
    changeHomeTileRect(rect, "move", -2000, -2000, calendar, wide),
    { ...rect, x: 0, y: 0 }
  );
  assert.deepEqual(
    changeHomeTileRect(rect, "move", 2000, 2000, calendar, wide),
    { ...rect, x: wide.width - rect.width, y: wide.height - rect.height }
  );
});

test("width, height and corner resize respect minimums and usable bounds", () => {
  const rect = layout().tiles[server.id];
  const width = changeHomeTileRect(rect, "width", -1000, 1000, server, wide);
  assert.equal(width.width, server.minWidth);
  assert.equal(width.height, rect.height);
  const height = changeHomeTileRect(rect, "height", 1000, -1000, server, wide);
  assert.equal(height.width, rect.width);
  assert.equal(height.height, server.minHeight);
  const both = changeHomeTileRect(rect, "both", 5000, 5000, server, wide);
  assert.equal(both.width, wide.width);
  assert.equal(both.height, wide.height);
});

test("a small overlap is corrected sideways without pushing the neighboring tile down", () => {
  const neighbor = { x: 0, y: 0, width: 420, height: 240 };
  const snapshot = structuredClone(neighbor);
  const rect = { x: 424, y: 0, width: 360, height: 420 };
  const placed = fitHomeTile(rect, [neighbor], wide);
  assert.deepEqual(placed, { ...rect, x: 428 });
  assert.deepEqual(neighbor, snapshot);
});

test("a distant move uses the nearest free position and preserves its neighbor", () => {
  const neighbor = { x: 0, y: 0, width: 420, height: 240 };
  const rect = { x: 400, y: 100, width: 360, height: 420 };
  const placed = fitHomeTile(rect, [neighbor], wide);
  assert.deepEqual(placed, { ...rect, x: 428 });
  assert.equal(neighbor.y, 0);
  const next = layout({ [server.id]: neighbor, [calendar.id]: placed });
  assert.deepEqual(next.tiles[server.id], neighbor);
  assert.deepEqual(next.tiles[calendar.id], placed);
});

test("a move with no available space can be cancelled instead of adding scroll height", () => {
  const rect = { x: 0, y: 0, width: wide.width, height: wide.height };
  const neighbor = { x: 0, y: 0, width: 420, height: 240 };
  assert.equal(fitHomeTile(rect, [neighbor], wide), null);
});

test("resizing stops at neighboring edges without moving either tile", () => {
  const rect = { x: 0, y: 0, width: 420, height: 240 };
  const right = { x: 428, y: 0, width: 360, height: 420 };
  assert.deepEqual(
    changeHomeTileRect(rect, "width", 100, 0, server, wide, [right]),
    rect
  );
  const below = { x: 0, y: 248, width: 360, height: 300 };
  assert.deepEqual(
    changeHomeTileRect(rect, "height", 0, 100, server, wide, [below]),
    rect
  );
  const corner = changeHomeTileRect(rect, "both", 100, 80, server, wide, [
    right,
  ]);
  assert.equal(corner.width, rect.width);
  assert.equal(corner.height, 320);
});

test("a medium viewport narrows both tiles to keep them side by side", () => {
  const bounds = { width: 800, height: 500 };
  const result = layout({}, bounds);
  checkBoundsAndOverlap(result, bounds);
  assert.equal(result.tiles[server.id].y, 0);
  assert.equal(result.tiles[calendar.id].y, 0);
  assert.ok(result.tiles[server.id].width >= server.minWidth);
  assert.ok(result.tiles[calendar.id].width >= calendar.minWidth);
});

test("window shrink clamps and separates tiles without overwriting preferences", () => {
  const stored = layout().tiles;
  const snapshot = structuredClone(stored);
  const small = layout(stored, narrow);
  checkBoundsAndOverlap(small, narrow);
  assert.ok(small.tiles[calendar.id].y >= small.tiles[server.id].height);
  assert.deepEqual(stored, snapshot);
  assert.deepEqual(layout(stored).tiles, snapshot);
});

test("additional tiles receive the same bounds and collision handling", () => {
  const definitions = [
    ...HOME_TILE_DEFINITIONS,
    {
      id: "new-tile",
      defaultWidth: 350,
      defaultHeight: 240,
      minWidth: 200,
      minHeight: 160,
    },
  ];
  const preferences = Object.fromEntries(
    definitions.map(({ id }) => [id, { x: 50, y: 50 }])
  );
  const result = resolveHomeTiles(definitions, preferences, narrow);
  checkBoundsAndOverlap(result, narrow);
  assert.equal(Object.keys(result.tiles).length, definitions.length);
  assert.deepEqual(resolveHomeTiles(definitions, result.tiles, narrow), result);
});

test("unmeasured boards do not produce invalid rectangles", () => {
  assert.deepEqual(layout({}, { width: 0, height: 0 }), {
    tiles: {},
    height: 0,
  });
});
