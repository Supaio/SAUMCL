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

export const getCowCapacity = (width: number, height: number): number =>
  Math.min(
    MAX_COWS,
    Math.max(0, Math.floor(width / COW_CELL_SIZE)) *
      Math.max(0, Math.floor(height / COW_CELL_SIZE))
  );

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
}

const collideWithPanel = (
  cow: CowBody,
  panel: CowObstacle,
  width: number,
  height: number
) => {
  const dx = cow.x - Math.max(panel.left, Math.min(panel.right, cow.x));
  const dy = cow.y - Math.max(panel.top, Math.min(panel.bottom, cow.y));
  const distance = Math.hypot(dx, dy);
  if (distance >= cow.radius) return false;

  let nx = distance > 0 ? dx / distance : 0;
  let ny = distance > 0 ? dy / distance : 0;
  let x = cow.x + nx * (cow.radius - distance);
  let y = cow.y + ny * (cow.radius - distance);
  const fitsWindow = (x: number, y: number) =>
    x >= cow.radius &&
    x <= width - cow.radius &&
    y >= cow.radius &&
    y <= height - cow.radius;

  // Layout changes can place a cow inside a panel or a gap smaller than its size.
  if (distance === 0 || !fitsWindow(x, y)) {
    const exits = [
      { x: cow.x, y: panel.top - cow.radius, nx: 0, ny: -1 },
      { x: cow.x, y: panel.bottom + cow.radius, nx: 0, ny: 1 },
      { x: panel.left - cow.radius, y: cow.y, nx: -1, ny: 0 },
      { x: panel.right + cow.radius, y: cow.y, nx: 1, ny: 0 },
    ].filter((exit) => fitsWindow(exit.x, exit.y));
    exits.sort(
      (a, b) =>
        Math.hypot(a.x - cow.x, a.y - cow.y) -
        Math.hypot(b.x - cow.x, b.y - cow.y)
    );
    const exit = exits[0];
    if (!exit) return false;
    ({ x, y, nx, ny } = exit);
  }

  cow.x = x;
  cow.y = y;
  const speed = cow.vx * nx + cow.vy * ny;
  if (speed < 0) {
    if (speed < -40)
      cow.angularVelocity += ((-cow.vx * ny + cow.vy * nx) / cow.radius) * 0.2;
    const bounce = speed < -40 ? 0.2 : 0;
    cow.vx -= (1 + bounce) * speed * nx;
    cow.vy -= (1 + bounce) * speed * ny;
  }
  if (ny < -0.5) cow.vx *= 0.98;
  return true;
};

export const dropCow = (
  cows: CowBody[],
  x: number,
  width: number,
  height: number
): boolean => {
  if (
    cows.length >= getCowCapacity(width, height) ||
    width < COW_RADIUS * 2 ||
    height < COW_RADIUS * 2
  )
    return false;
  const radius = Math.min(
    MIN_COW_RADIUS + Math.random() * (MAX_COW_RADIUS - MIN_COW_RADIUS),
    width / 2,
    height / 2
  );
  cows.push({
    x: Math.max(radius, Math.min(width - radius, x)),
    y: radius,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: x < width / 2 ? -1.8 : 1.8,
    radius,
    isGray: Math.random() < 0.000082,
  });
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

export const stepCowPhysics = (
  cows: CowBody[],
  width: number,
  height: number,
  dt: number,
  obstacles: CowObstacle[] = []
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
            a.x -= nx * correction;
            a.y -= ny * correction;
            b.x += nx * correction;
            b.y += ny * correction;

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
