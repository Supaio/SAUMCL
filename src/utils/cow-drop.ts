export const COW_RADIUS = 28;
const MIN_COW_RADIUS = COW_RADIUS * 0.5;
export const MAX_COW_RADIUS = COW_RADIUS * 2;
export const COW_LAUNCH_LIMIT = 100;
export const MAX_COWS = 500;

// Reserve the average footprint of the full size range to avoid overcrowding.
const COW_CELL_SIZE =
  2 *
  Math.sqrt(
    (MIN_COW_RADIUS ** 2 +
      MIN_COW_RADIUS * MAX_COW_RADIUS +
      MAX_COW_RADIUS ** 2) /
      3
  );

export const getCowCapacity = (
  width: number,
  height: number,
  obstacles: CowObstacle[] = []
): number => {
  const columns = Math.max(0, Math.floor(width / COW_CELL_SIZE));
  const rows = Math.max(0, Math.floor(height / COW_CELL_SIZE));
  if (!obstacles.length) return Math.min(MAX_COWS, columns * rows);
  let capacity = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const sample = {
        x: (column + 0.5) * COW_CELL_SIZE,
        y: (row + 0.5) * COW_CELL_SIZE,
        radius: COW_CELL_SIZE / 2,
      };
      if (!obstacles.some((obstacle) => obstacleContact(sample, obstacle)))
        capacity++;
      if (capacity === MAX_COWS) return capacity;
    }
  }
  return capacity;
};

export interface CowBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  radius: number;
  isGray: boolean;
}

export interface CowObstacle {
  left: number;
  top: number;
  right: number;
  bottom: number;
  shape?: "circle";
  cornerRadius?: number;
  vx?: number;
  vy?: number;
}

const obstacleContact = (
  cow: Pick<CowBody, "x" | "y" | "radius">,
  obstacle: CowObstacle
) => {
  const halfWidth = (obstacle.right - obstacle.left) / 2;
  const halfHeight = (obstacle.bottom - obstacle.top) / 2;
  const dx = cow.x - (obstacle.left + halfWidth);
  const dy = cow.y - (obstacle.top + halfHeight);
  if (obstacle.shape === "circle") {
    const distance = Math.hypot(dx, dy);
    const penetration = cow.radius + Math.min(halfWidth, halfHeight) - distance;
    if (penetration <= 0.0001) return;
    return {
      penetration,
      nx: distance > 0 ? dx / distance : 0,
      ny: distance > 0 ? dy / distance : -1,
    };
  }
  const corner = Math.max(
    0,
    Math.min(obstacle.cornerRadius || 0, halfWidth, halfHeight)
  );
  const qx = Math.abs(dx) - halfWidth + corner;
  const qy = Math.abs(dy) - halfHeight + corner;
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  const distance = Math.hypot(outsideX, outsideY);
  const penetration =
    cow.radius - (distance + Math.min(Math.max(qx, qy), 0) - corner);
  if (penetration <= 0.0001) return;
  return {
    penetration,
    nx:
      distance > 0
        ? (outsideX / distance) * Math.sign(dx)
        : qx > qy
          ? Math.sign(dx) || 1
          : 0,
    ny:
      distance > 0
        ? (outsideY / distance) * Math.sign(dy)
        : qx > qy
          ? 0
          : Math.sign(dy) || -1,
  };
};

const findFreePosition = (
  cow: Pick<CowBody, "x" | "y" | "radius">,
  width: number,
  height: number,
  obstacles: CowObstacle[],
  topOnly = false
) => {
  const r = cow.radius;
  const xs = [
    cow.x,
    r,
    width - r,
    ...obstacles.flatMap((o) => [o.left - r, o.right + r]),
  ];
  const ys = topOnly
    ? [r]
    : [
        cow.y,
        r,
        height - r,
        ...obstacles.flatMap((o) => [o.top - r, o.bottom + r]),
      ];
  let best: { x: number; y: number } | undefined;
  let distance = Infinity;
  for (const x of xs) {
    if (x < r || x > width - r) continue;
    for (const y of ys) {
      if (y < r || y > height - r) continue;
      const score = (x - cow.x) ** 2 + (y - cow.y) ** 2;
      if (
        score >= distance ||
        obstacles.some((o) => obstacleContact({ x, y, radius: r }, o))
      )
        continue;
      best = { x, y };
      distance = score;
    }
  }
  return best;
};

const collideWithPanel = (
  cow: CowBody,
  panel: CowObstacle,
  width: number,
  height: number
) => {
  const contact = obstacleContact(cow, panel);
  if (!contact) return false;
  let { nx, ny } = contact;
  let x = cow.x + nx * contact.penetration;
  let y = cow.y + ny * contact.penetration;
  const fitsWindow = (x: number, y: number) =>
    x >= cow.radius &&
    x <= width - cow.radius &&
    y >= cow.radius &&
    y <= height - cow.radius;

  // Layout changes can place a cow inside a panel or a gap smaller than its size.
  if (!fitsWindow(x, y)) {
    const exits = [
      { x: cow.x, y: panel.top - cow.radius, nx: 0, ny: -1 },
      { x: cow.x, y: panel.bottom + cow.radius, nx: 0, ny: 1 },
      { x: panel.left - cow.radius, y: cow.y, nx: -1, ny: 0 },
      { x: panel.right + cow.radius, y: cow.y, nx: 1, ny: 0 },
    ];
    if (panel.shape === "circle") {
      const cx = (panel.left + panel.right) / 2;
      const cy = (panel.top + panel.bottom) / 2;
      const radius =
        Math.min(panel.right - panel.left, panel.bottom - panel.top) / 2 +
        cow.radius;
      // Slide along the circle/window intersection instead of jumping to the pole.
      for (const px of [
        Math.max(cow.radius, Math.min(width - cow.radius, x)),
        cow.x,
      ]) {
        const squared = radius ** 2 - (px - cx) ** 2;
        if (squared < 0) continue;
        for (const py of [cy - Math.sqrt(squared), cy + Math.sqrt(squared)])
          exits.push({
            x: px,
            y: py,
            nx: (px - cx) / radius,
            ny: (py - cy) / radius,
          });
      }
      for (const py of [
        Math.max(cow.radius, Math.min(height - cow.radius, y)),
        cow.y,
      ]) {
        const squared = radius ** 2 - (py - cy) ** 2;
        if (squared < 0) continue;
        for (const px of [cx - Math.sqrt(squared), cx + Math.sqrt(squared)])
          exits.push({
            x: px,
            y: py,
            nx: (px - cx) / radius,
            ny: (py - cy) / radius,
          });
      }
    }
    const fittingExits = exits.filter((exit) => fitsWindow(exit.x, exit.y));
    fittingExits.sort(
      (a, b) =>
        Math.hypot(a.x - cow.x, a.y - cow.y) -
        Math.hypot(b.x - cow.x, b.y - cow.y)
    );
    const exit = fittingExits[0];
    if (!exit) return false;
    ({ x, y, nx, ny } = exit);
  }

  cow.x = x;
  cow.y = y;
  const relativeX = cow.vx - (panel.vx || 0);
  const relativeY = cow.vy - (panel.vy || 0);
  const speed = relativeX * nx + relativeY * ny;
  if (speed < 0) {
    if (speed < -40)
      cow.angularVelocity +=
        ((-relativeX * ny + relativeY * nx) / cow.radius) * 0.2;
    const bounce = speed < -40 ? 0.2 : 0;
    cow.vx -= (1 + bounce) * speed * nx;
    cow.vy -= (1 + bounce) * speed * ny;
  }
  if (ny < -0.5) cow.vx = (panel.vx || 0) + relativeX * 0.98;
  return true;
};

export const dropCow = (
  cows: CowBody[],
  x: number,
  width: number,
  height: number,
  obstacles: CowObstacle[] = []
): boolean => {
  if (
    cows.length >= getCowCapacity(width, height, obstacles) ||
    width < COW_RADIUS * 2 ||
    height < COW_RADIUS * 2
  )
    return false;
  const radius = Math.min(
    MIN_COW_RADIUS + Math.random() * (MAX_COW_RADIUS - MIN_COW_RADIUS),
    width / 2,
    height / 2
  );
  const cow = {
    x: Math.max(radius, Math.min(width - radius, x)),
    y: radius,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: x < width / 2 ? -1.8 : 1.8,
    radius,
    isGray: Math.random() < 0.000082,
  };
  if (obstacles.length) {
    const position = findFreePosition(cow, width, height, obstacles, true);
    if (!position) return false;
    Object.assign(cow, position);
  }
  cows.push(cow);
  return true;
};

export const containCows = (cows: CowBody[], width: number, height: number) => {
  for (const cow of cows) {
    if (cow.x < cow.radius) {
      cow.x = cow.radius;
      if (cow.vx < -40) cow.angularVelocity += (cow.vy / cow.radius) * 0.2;
      if (cow.vx < 0) cow.vx *= -0.3;
    } else if (cow.x > width - cow.radius) {
      cow.x = Math.max(cow.radius, width - cow.radius);
      if (cow.vx > 40) cow.angularVelocity -= (cow.vy / cow.radius) * 0.2;
      if (cow.vx > 0) cow.vx *= -0.3;
    }
    if (cow.y < cow.radius) {
      cow.y = cow.radius;
      if (cow.vy < -40) cow.angularVelocity -= (cow.vx / cow.radius) * 0.2;
      if (cow.vy < 0) cow.vy = 0;
    } else if (cow.y > height - cow.radius) {
      cow.y = Math.max(cow.radius, height - cow.radius);
      if (cow.vy > 40) cow.angularVelocity += (cow.vx / cow.radius) * 0.2;
      cow.vy = cow.vy > 40 ? -cow.vy * 0.2 : 0;
      cow.vx *= 0.94;
    }
  }
};

export const resizeCows = (
  cows: CowBody[],
  previous: { width: number; height: number },
  next: { width: number; height: number },
  obstacles: CowObstacle[] = []
) => {
  const { width, height } = next;
  // A minimized or temporarily hidden canvas must not discard the current herd.
  if (width <= 0 || height <= 0) return;
  const capacity = getCowCapacity(width, height, obstacles);
  if (cows.length > capacity) {
    // Keep rare cows first; ordinary cows retain their original order.
    cows.sort((a, b) => Number(b.isGray) - Number(a.isGray));
    cows.length = capacity;
  }
  if (previous.width !== width || previous.height !== height) {
    for (const cow of cows) {
      // Preserve relative positions instead of piling every offscreen cow on an edge.
      const diameter = cow.radius * 2;
      if (previous.width > diameter)
        cow.x =
          cow.radius +
          ((cow.x - cow.radius) / (previous.width - diameter)) *
            Math.max(0, width - diameter);
      if (previous.height > diameter)
        cow.y =
          cow.radius +
          ((cow.y - cow.radius) / (previous.height - diameter)) *
            Math.max(0, height - diameter);
      cow.vx = 0;
      cow.vy = 0;
      cow.angularVelocity = 0;
    }
  }
  containCows(cows, width, height);
};

export const stepCowPhysics = (
  cows: CowBody[],
  width: number,
  height: number,
  dt: number,
  obstacles: CowObstacle[] = [],
  sceneCollision = false
) => {
  const previous = cows.map(({ x, y, angularVelocity }) => ({
    x,
    y,
    angularVelocity,
  }));
  for (const cow of cows) {
    cow.vy += 1200 * dt;
    cow.vx *= Math.exp(-0.45 * dt);
    cow.x += cow.vx * dt;
    cow.y += cow.vy * dt;
  }

  const contacts = new Set<CowBody>();
  if (sceneCollision) containCows(cows, width, height);
  const positionIsFree = (cow: CowBody, x: number, y: number) =>
    x >= cow.radius - 0.0001 &&
    x <= width - cow.radius + 0.0001 &&
    y >= cow.radius - 0.0001 &&
    y <= height - cow.radius + 0.0001 &&
    !obstacles.some(
      (o) =>
        (obstacleContact({ x, y, radius: cow.radius }, o)?.penetration || 0) >
        0.1
    );
  for (let i = 0; sceneCollision && i < cows.length; i++) {
    const cow = cows[i];
    for (const panel of obstacles) {
      if (collideWithPanel(cow, panel, width, height)) contacts.add(cow);
    }
    // Layout changes can leave a cow inside a tile or in an impossible gap.
    if (
      obstacles.some((o) => (obstacleContact(cow, o)?.penetration || 0) > 1)
    ) {
      const position = positionIsFree(cow, previous[i].x, previous[i].y)
        ? previous[i]
        : findFreePosition(cow, width, height, obstacles);
      if (position) {
        cow.x = position.x;
        cow.y = position.y;
        cow.vx = 0;
        cow.vy = 0;
        cow.angularVelocity *= 0.3;
      }
    }
  }
  if (sceneCollision) containCows(cows, width, height);
  const diameter = MAX_COW_RADIUS * 2;
  const columns = Math.ceil(width / diameter) + 2;
  // Check nearby cells so filling a large window does not compare every pair.
  for (let pass = 0; pass < 6; pass++) {
    const cells = new Map<number, CowBody[]>();
    for (const a of cows) {
      const column = Math.floor(a.x / diameter);
      const row = Math.floor(a.y / diameter);
      for (let cy = row - 1; cy <= row + 1; cy++) {
        for (let cx = column - 1; cx <= column + 1; cx++) {
          for (const b of cells.get(cy * columns + cx) || []) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distanceSquared = dx * dx + dy * dy;
            const separation = a.radius + b.radius;
            if (distanceSquared >= separation ** 2) continue;
            contacts.add(a);
            contacts.add(b);

            const distance = Math.sqrt(distanceSquared);
            const nx = distance > 0 ? dx / distance : 1;
            const ny = distance > 0 ? dy / distance : 0;
            const correction = (separation - distance) / 2;
            const freeA =
              !sceneCollision ||
              positionIsFree(a, a.x - nx * correction, a.y - ny * correction);
            const freeB =
              !sceneCollision ||
              positionIsFree(b, b.x + nx * correction, b.y + ny * correction);
            // A panel carries the contact load; the other cow takes the separation.
            const moveA = freeA
              ? !freeB &&
                positionIsFree(
                  a,
                  a.x - nx * correction * 2,
                  a.y - ny * correction * 2
                )
                ? correction * 2
                : correction
              : 0;
            const moveB = freeB
              ? !freeA &&
                positionIsFree(
                  b,
                  b.x + nx * correction * 2,
                  b.y + ny * correction * 2
                )
                ? correction * 2
                : correction
              : 0;
            a.x -= nx * moveA;
            a.y -= ny * moveA;
            b.x += nx * moveB;
            b.y += ny * moveB;

            const closingSpeed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (closingSpeed < 0) {
              const bounce = closingSpeed < -80 ? 0.1 : 0;
              const impulse = (-(1 + bounce) * closingSpeed) / 2;
              a.vx -= impulse * nx;
              a.vy -= impulse * ny;
              b.vx += impulse * nx;
              b.vy += impulse * ny;
              const tangentSpeed = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
              const friction = Math.max(
                -impulse * 0.35,
                Math.min(impulse * 0.35, -tangentSpeed / 2)
              );
              a.vx += friction * ny;
              a.vy -= friction * nx;
              b.vx -= friction * ny;
              b.vy += friction * nx;
              // Impact friction gives both sculptures a turn without amplifying resting noise.
              if (closingSpeed < -40 && Math.abs(tangentSpeed) > 20) {
                a.angularVelocity -= (2 * friction) / a.radius;
                b.angularVelocity -= (2 * friction) / b.radius;
              }
            }
          }
        }
      }
      const key =
        Math.floor(a.y / diameter) * columns + Math.floor(a.x / diameter);
      const cell = cells.get(key);
      if (cell) cell.push(a);
      else cells.set(key, [a]);
    }
    for (const cow of cows) {
      for (const panel of obstacles) {
        if (collideWithPanel(cow, panel, width, height)) contacts.add(cow);
      }
    }
    containCows(cows, width, height);
  }
  for (let i = 0; i < cows.length; i++) {
    const cow = cows[i];
    const speed = Math.hypot(cow.vx, cow.vy);
    if (speed > 600) {
      cow.vx *= 600 / speed;
      cow.vy *= 600 / speed;
    }
    const touching =
      contacts.has(cow) ||
      cow.x <= cow.radius + 0.01 ||
      cow.x >= width - cow.radius - 0.01 ||
      cow.y >= height - cow.radius - 0.01;
    const resting =
      touching &&
      Math.hypot(cow.x - previous[i].x, cow.y - previous[i].y) < 15 * dt;
    // Ignore repeated solver impulses when a packed cow is already stationary.
    const spin = resting ? previous[i].angularVelocity : cow.angularVelocity;
    cow.angularVelocity =
      Math.max(-6, Math.min(6, spin)) * Math.exp(-(touching ? 8 : 0.4) * dt);
    if (resting && Math.abs(cow.angularVelocity) < 0.02)
      cow.angularVelocity = 0;
    // Keep the resting orientation; damping stops jitter without forcing cows upright.
    cow.angle =
      ((((cow.angle + cow.angularVelocity * dt + Math.PI) % (Math.PI * 2)) +
        Math.PI * 2) %
        (Math.PI * 2)) -
      Math.PI;
  }
};
