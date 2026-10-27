import type {
  HomeTileDefinition,
  HomeTileLayout,
  HomeTileOperation,
  HomeTilePreferences,
  HomeTileRect,
} from "@/models/home-tiles";

export const HOME_TILE_GAP = 8;
const limit = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function parseHomeTileLayout(value: unknown): HomeTilePreferences {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== 1 ||
    !input.tiles ||
    typeof input.tiles !== "object"
  )
    return {};
  return Object.fromEntries(
    Object.entries(input.tiles).flatMap(([id, value]) => {
      if (!value || typeof value !== "object") return [];
      const rect = value as Record<string, unknown>;
      const entries = Object.entries(rect).filter(
        ([key, value]) =>
          ["x", "y", "width", "height"].includes(key) &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= (key === "x" || key === "y" ? 0 : 1) &&
          value <= (key === "x" || key === "y" ? 100000 : 10000)
      );
      return entries.length ? [[id, Object.fromEntries(entries)]] : [];
    })
  );
}

export function homeTilesOverlap(
  left: HomeTileRect,
  right: HomeTileRect
): boolean {
  return (
    left.x < right.x + right.width + HOME_TILE_GAP &&
    left.x + left.width + HOME_TILE_GAP > right.x &&
    left.y < right.y + right.height + HOME_TILE_GAP &&
    left.y + left.height + HOME_TILE_GAP > right.y
  );
}

export function fitHomeTile(
  rect: HomeTileRect,
  others: HomeTileRect[],
  bounds: { width: number; height: number }
): HomeTileRect | null {
  if (rect.width > bounds.width || rect.height > bounds.height) return null;
  const xs = new Set([
    limit(rect.x, 0, bounds.width - rect.width),
    0,
    bounds.width - rect.width,
    ...others.flatMap((other) => [
      other.x - rect.width - HOME_TILE_GAP,
      other.x + other.width + HOME_TILE_GAP,
    ]),
  ]);
  const ys = new Set([
    limit(rect.y, 0, bounds.height - rect.height),
    0,
    bounds.height - rect.height,
    ...others.flatMap((other) => [
      other.y - rect.height - HOME_TILE_GAP,
      other.y + other.height + HOME_TILE_GAP,
    ]),
  ]);
  let nearest: HomeTileRect | null = null;
  let distance = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      if (
        x < 0 ||
        y < 0 ||
        x + rect.width > bounds.width ||
        y + rect.height > bounds.height
      )
        continue;
      const candidate = { ...rect, x, y };
      if (others.some((other) => homeTilesOverlap(candidate, other))) continue;
      const nextDistance = (x - rect.x) ** 2 + (y - rect.y) ** 2;
      if (nextDistance < distance) {
        nearest = candidate;
        distance = nextDistance;
      }
    }
  }
  return nearest;
}

const allocateSizes = (
  wanted: number[],
  minimums: number[],
  available: number
) => {
  const minimumTotal = minimums.reduce((sum, size) => sum + size, 0);
  if (minimumTotal > available)
    return minimums.map((size) => (size * available) / minimumTotal);
  const extraTotal = wanted.reduce(
    (sum, size, index) => sum + size - minimums[index],
    0
  );
  const ratio = Math.min(
    1,
    (available - minimumTotal) / Math.max(1, extraTotal)
  );
  return wanted.map(
    (size, index) => minimums[index] + (size - minimums[index]) * ratio
  );
};

export function resolveHomeTiles(
  definitions: HomeTileDefinition[],
  preferences: HomeTilePreferences,
  bounds: { width: number; height: number }
): { tiles: HomeTileLayout; height: number } {
  if (bounds.width <= 0 || bounds.height <= 0) return { tiles: {}, height: 0 };
  const saved: HomeTileLayout = {};
  for (const definition of definitions) {
    const { x, y, width, height } = preferences[definition.id] ?? {};
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      ![x, y, width, height].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > bounds.width ||
      y + height > bounds.height
    )
      break;
    const rect = { x, y, width, height };
    if (Object.values(saved).some((other) => homeTilesOverlap(rect, other)))
      break;
    saved[definition.id] = rect;
  }
  if (Object.keys(saved).length === definitions.length)
    return { tiles: saved, height: bounds.height };
  // Add a new tile in free space before resizing an existing saved arrangement.
  const expanded = { ...saved };
  for (const definition of definitions) {
    if (expanded[definition.id]) continue;
    const preferred = preferences[definition.id];
    const rect = fitHomeTile(
      {
        x: preferred?.x ?? 0,
        y: preferred?.y ?? 0,
        width: limit(
          preferred?.width ?? definition.defaultWidth,
          Math.min(definition.minWidth, bounds.width),
          bounds.width
        ),
        height: limit(
          preferred?.height ?? definition.defaultHeight,
          Math.min(definition.minHeight, bounds.height),
          bounds.height
        ),
      },
      Object.values(expanded),
      bounds
    );
    if (!rect) break;
    expanded[definition.id] = rect;
  }
  if (Object.keys(expanded).length === definitions.length)
    return { tiles: expanded, height: bounds.height };
  const rows: HomeTileDefinition[][] = [];
  let rowWidth = 0;
  for (const definition of definitions) {
    const minimum = Math.min(definition.minWidth, bounds.width);
    if (!rows.length || rowWidth + HOME_TILE_GAP + minimum > bounds.width) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1].push(definition);
    rowWidth += minimum + (rowWidth ? HOME_TILE_GAP : 0);
  }
  const wantedHeight = (definition: HomeTileDefinition) =>
    limit(
      preferences[definition.id]?.height ?? definition.defaultHeight,
      Math.min(definition.minHeight, bounds.height),
      bounds.height
    );
  const rowHeights = allocateSizes(
    rows.map((row) => Math.max(...row.map(wantedHeight))),
    rows.map((row) =>
      Math.min(bounds.height, Math.max(...row.map((tile) => tile.minHeight)))
    ),
    bounds.height - Math.max(0, rows.length - 1) * HOME_TILE_GAP
  );
  const defaults: HomeTileLayout = {};
  let y = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const widths = allocateSizes(
      row.map((definition) =>
        limit(
          preferences[definition.id]?.width ?? definition.defaultWidth,
          Math.min(definition.minWidth, bounds.width),
          bounds.width
        )
      ),
      row.map((definition) => Math.min(definition.minWidth, bounds.width)),
      bounds.width - (row.length - 1) * HOME_TILE_GAP
    );
    const rowHeight = Math.min(rowHeights[rowIndex], bounds.height - y);
    let x = 0;
    for (const [column, definition] of row.entries()) {
      const width = Math.min(widths[column], bounds.width - x);
      defaults[definition.id] = {
        x,
        y,
        width,
        height: Math.min(wantedHeight(definition), rowHeight),
      };
      x += width + HOME_TILE_GAP;
    }
    y += rowHeight + HOME_TILE_GAP;
  }
  const tiles: HomeTileLayout = {};
  for (const definition of definitions) {
    const preferred = preferences[definition.id];
    const rect = {
      ...defaults[definition.id],
      x: limit(
        preferred?.x ?? defaults[definition.id].x,
        0,
        bounds.width - defaults[definition.id].width
      ),
      y: limit(
        preferred?.y ?? defaults[definition.id].y,
        0,
        bounds.height - defaults[definition.id].height
      ),
    };
    const placed = fitHomeTile(rect, Object.values(tiles), bounds);
    // A smaller window can invalidate the saved arrangement; use the fitted rows.
    if (!placed) return { tiles: defaults, height: bounds.height };
    tiles[definition.id] = placed;
  }
  return { tiles, height: bounds.height };
}

export function changeHomeTileRect(
  rect: HomeTileRect,
  operation: HomeTileOperation,
  dx: number,
  dy: number,
  definition: HomeTileDefinition,
  bounds: { width: number; height: number },
  others: HomeTileRect[] = []
): HomeTileRect {
  if (operation === "move") {
    return {
      ...rect,
      x: limit(rect.x + dx, 0, Math.max(0, bounds.width - rect.width)),
      y: limit(rect.y + dy, 0, Math.max(0, bounds.height - rect.height)),
    };
  }
  const maxWidth = Math.max(1, bounds.width - rect.x);
  const next = {
    ...rect,
    width:
      operation === "height"
        ? rect.width
        : limit(
            rect.width + dx,
            Math.min(definition.minWidth, rect.width, maxWidth),
            maxWidth
          ),
    height:
      operation === "width"
        ? rect.height
        : limit(
            rect.height + dy,
            Math.min(definition.minHeight, rect.height, bounds.height - rect.y),
            bounds.height - rect.y
          ),
  };
  const widths =
    operation === "height"
      ? [next.width]
      : [
          next.width,
          rect.width,
          ...others.map((other) => other.x - rect.x - HOME_TILE_GAP),
        ];
  const heights =
    operation === "width"
      ? [next.height]
      : [
          next.height,
          rect.height,
          ...others.map((other) => other.y - rect.y - HOME_TILE_GAP),
        ];
  const candidates = widths
    .flatMap((width) => heights.map((height) => ({ ...next, width, height })))
    .filter(
      (candidate) =>
        candidate.width >= Math.min(rect.width, definition.minWidth) &&
        candidate.width <= next.width &&
        candidate.height >= Math.min(rect.height, definition.minHeight) &&
        candidate.height <= next.height &&
        !others.some((other) => homeTilesOverlap(candidate, other))
    );
  candidates.sort(
    (left, right) =>
      (left.width - next.width) ** 2 +
      (left.height - next.height) ** 2 -
      (right.width - next.width) ** 2 -
      (right.height - next.height) ** 2
  );
  return candidates[0] ?? rect;
}
