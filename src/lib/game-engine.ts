// ============================================================
// game-engine.ts  –  Pure-function state-machine snake game engine
// No DOM · No Canvas · No side-effects
// ============================================================

// -------------------- Types --------------------

export interface Point {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  name: string;
  body: Point[];        // body[0] is head
  dir: Point;           // current direction {x: 0|1|-1, y: 0|1|-1}
  nextDir: Point;       // direction applied on next tick
  color: { body: string; head: string };
  speed: number;        // move interval (ms)
  moveTimer: number;    // accumulated move time (ms)
  energy: number;       // sprint energy 0-100
  boosting: boolean;    // sprinting?
  alive: boolean;
  score: number;
  kills: number;
  shield: boolean;      // shield active
  shieldTimer: number;  // shield remaining ms
  isAI: boolean;
  respawnTimer: number; // respawn countdown (ticks)
}

export interface Food {
  pos: Point;
  type: 'normal' | 'big' | 'speed' | 'shield';
  value: number;        // score / growth value
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface GameConfig {
  gridW: number;        // default 24
  gridH: number;        // default 24
  speed: 'slow' | 'normal' | 'fast';
  mode: 'local' | 'online';
}

export interface GameState {
  snakes: Snake[];
  foods: Food[];
  particles: Particle[];
  config: GameConfig;
  gameOver: boolean;
  winner: string | null;
  tick: number;
}

// -------------------- Constants --------------------

export const GRID_SIZE = 24;

export const BASE_SPEEDS: Record<string, number> = {
  slow: 150,
  normal: 110,
  fast: 70,
};

export const SNAKE_COLORS: { body: string; head: string }[] = [
  { body: '#00f5a0', head: '#00d9f5' },   // cyan-blue
  { body: '#ff6b9d', head: '#ff9ec4' },   // pink
  { body: '#c084fc', head: '#d8b4fe' },   // purple
  { body: '#fbbf24', head: '#fde68a' },   // gold
];

export const ENERGY_MAX = 100;
export const ENERGY_DRAIN = 35;   // per second
export const ENERGY_REGEN = 15;   // per second
export const RESPAWN_TICKS = 60;  // ~3 s

// -------------------- Helpers (internal) --------------------

function clonePoint(p: Point): Point {
  return { x: p.x, y: p.y };
}

function cloneSnake(s: Snake): Snake {
  return {
    ...s,
    body: s.body.map(clonePoint),
    dir: clonePoint(s.dir),
    nextDir: clonePoint(s.nextDir),
    color: { ...s.color },
  };
}

function cloneFood(f: Food): Food {
  return { pos: clonePoint(f.pos), type: f.type, value: f.value };
}

function cloneParticle(p: Particle): Particle {
  return { ...p };
}

function cloneState(state: GameState): GameState {
  return {
    snakes: state.snakes.map(cloneSnake),
    foods: state.foods.map(cloneFood),
    particles: state.particles.map(cloneParticle),
    config: { ...state.config },
    gameOver: state.gameOver,
    winner: state.winner,
    tick: state.tick,
  };
}

/** Check whether a cell is occupied by any alive snake body */
function isOccupied(
  x: number,
  y: number,
  snakes: Snake[],
  foods: Food[],
): boolean {
  for (const sn of snakes) {
    if (!sn.alive) continue;
    for (const seg of sn.body) {
      if (seg.x === x && seg.y === y) return true;
    }
  }
  for (const f of foods) {
    if (f.pos.x === x && f.pos.y === y) return true;
  }
  return false;
}

/** Find a random free cell */
function randomFreeCell(
  gridW: number,
  gridH: number,
  snakes: Snake[],
  foods: Food[],
): Point {
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = Math.floor(Math.random() * gridW);
    const y = Math.floor(Math.random() * gridH);
    if (!isOccupied(x, y, snakes, foods)) return { x, y };
  }
  // fallback – may overlap
  return {
    x: Math.floor(Math.random() * gridW),
    y: Math.floor(Math.random() * gridH),
  };
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// -------------------- Exported Functions --------------------

/**
 * 1. createGame – initialise a fresh GameState
 */
export function createGame(
  config: GameConfig,
  players: { name: string; color: { body: string; head: string }; isAI: boolean }[],
): GameState {
  const { gridW, gridH } = config;

  // Distribute spawn positions evenly
  const spawnPositions: { x: number; y: number; dx: number }[] = [
    { x: Math.floor(gridW * 0.25), y: Math.floor(gridH * 0.25), dx: 1 },
    { x: Math.floor(gridW * 0.75), y: Math.floor(gridH * 0.25), dx: -1 },
    { x: Math.floor(gridW * 0.25), y: Math.floor(gridH * 0.75), dx: -1 },
    { x: Math.floor(gridW * 0.75), y: Math.floor(gridH * 0.75), dx: 1 },
  ];

  const snakes: Snake[] = players.map((p, i) => {
    const sp = spawnPositions[i % spawnPositions.length];
    const dx = sp.dx;
    const body: Point[] = [
      { x: sp.x, y: sp.y },
      { x: sp.x - dx, y: sp.y },
      { x: sp.x - dx * 2, y: sp.y },
    ];
    return {
      id: generateId(),
      name: p.name,
      body,
      dir: { x: dx, y: 0 },
      nextDir: { x: dx, y: 0 },
      color: { ...p.color },
      speed: BASE_SPEEDS[config.speed] ?? BASE_SPEEDS.normal,
      moveTimer: 0,
      energy: ENERGY_MAX,
      boosting: false,
      alive: true,
      score: 0,
      kills: 0,
      shield: false,
      shieldTimer: 0,
      isAI: p.isAI,
      respawnTimer: 0,
    };
  });

  // Initial foods
  let foods: Food[] = [];
  const state: GameState = {
    snakes,
    foods,
    particles: [],
    config,
    gameOver: false,
    winner: null,
    tick: 0,
  };

  // Spawn initial foods (5-8)
  let result = { ...state };
  const initialFoodCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < initialFoodCount; i++) {
    result = spawnFood(result);
  }

  return result;
}

/**
 * 2. setDirection – allow ANY turn, including 180° U-turn
 */
export function setDirection(snake: Snake, newDir: Point): Snake {
  return {
    ...snake,
    body: snake.body.map(clonePoint),
    dir: clonePoint(snake.dir),
    nextDir: clonePoint(newDir),
    color: { ...snake.color },
  };
}

/**
 * 3. tickGame – main loop tick
 */
export function tickGame(state: GameState, dt: number): GameState {
  let s = cloneState(state);
  s.tick += 1;
  const dtMs = dt * 1000;

  // Process each snake
  for (let i = 0; i < s.snakes.length; i++) {
    const sn = s.snakes[i];

    // Dead snake: handle respawn countdown
    if (!sn.alive) {
      if (sn.respawnTimer > 0) {
        sn.respawnTimer -= 1;
        if (sn.respawnTimer <= 0) {
          s = respawnSnake(s, i);
        }
      }
      continue;
    }

    // AI decision
    if (sn.isAI) {
      const aiDir = tickAI(s, i);
      s.snakes[i].nextDir = aiDir;
    }

    // Accumulate move timer
    const interval = getSpeedInterval(sn, s.config);
    sn.moveTimer += dtMs;

    if (sn.moveTimer >= interval) {
      sn.moveTimer -= interval;
      s = tickSnake(s, i);
    }

    // Energy: drain while boosting, regen otherwise
    const snAfter = s.snakes[i];
    if (snAfter && snAfter.alive) {
      if (snAfter.boosting && snAfter.energy > 0) {
        snAfter.energy = Math.max(0, snAfter.energy - ENERGY_DRAIN * dt);
        if (snAfter.energy <= 0) {
          snAfter.boosting = false;
        }
      } else {
        snAfter.energy = Math.min(ENERGY_MAX, snAfter.energy + ENERGY_REGEN * dt);
      }

      // Shield timer countdown
      if (snAfter.shield && snAfter.shieldTimer > 0) {
        snAfter.shieldTimer -= dtMs;
        if (snAfter.shieldTimer <= 0) {
          snAfter.shield = false;
          snAfter.shieldTimer = 0;
        }
      }
    }
  }

  // Update particles
  s.particles = s.particles
    .map(p => ({
      ...p,
      x: p.x + p.vx * dt,
      y: p.y + p.vy * dt,
      vx: p.vx * (1 - 2.5 * dt),
      vy: p.vy * (1 - 2.5 * dt),
      life: p.life - (1 / p.maxLife) * dt,
    }))
    .filter(p => p.life > 0);

  // Ensure enough food on the field (5-8)
  const foodCount = s.foods.length;
  if (foodCount < 5) {
    const needed = 5 + Math.floor(Math.random() * 4) - foodCount;
    for (let i = 0; i < needed; i++) {
      s = spawnFood(s);
    }
  }

  // Check game-over: all human players dead?
  const humanSnakes = s.snakes.filter(sn => !sn.isAI);
  const aliveHumans = humanSnakes.filter(sn => sn.alive);
  if (humanSnakes.length > 0 && aliveHumans.length === 0) {
    // In local mode with AI, game is over when player is dead (respawnTimer === 0 means fully dead)
    const allHumansDead = humanSnakes.every(
      sn => !sn.alive && sn.respawnTimer <= 0,
    );
    if (allHumansDead) {
      s.gameOver = true;
      // Winner = snake with highest score
      const sorted = [...s.snakes].sort((a, b) => b.score - a.score);
      s.winner = sorted[0]?.name ?? null;
    }
  }

  return s;
}

/**
 * 4. tickSnake – execute a single snake's move
 */
export function tickSnake(state: GameState, snakeIndex: number): GameState {
  const s = cloneState(state);
  const sn = s.snakes[snakeIndex];
  if (!sn || !sn.alive) return s;

  const { gridW, gridH } = s.config;

  // Apply nextDir → dir
  sn.dir = clonePoint(sn.nextDir);

  const head = sn.body[0];
  const nx = head.x + sn.dir.x;
  const ny = head.y + sn.dir.y;

  // --- Collision detection ---

  // 1. Wall collision
  if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) {
    if (sn.shield) {
      // Wrap around
      const wrappedX = ((nx % gridW) + gridW) % gridW;
      const wrappedY = ((ny % gridH) + gridH) % gridH;
      sn.body.unshift({ x: wrappedX, y: wrappedY });
      // Eat check + tail pop handled below
      return postMove(s, snakeIndex, wrappedX, wrappedY);
    }
    // Die
    return killSnake(s, snakeIndex, snakeIndex);
  }

  // 2. Self collision
  for (let i = 0; i < sn.body.length; i++) {
    const seg = sn.body[i];
    if (seg.x === nx && seg.y === ny) {
      if (i === 1) {
        // U-turn detected: new head == body[1]
        // Reverse the body array and set dir to the opposite direction
        sn.body.reverse();
        sn.dir = { x: -sn.dir.x, y: -sn.dir.y };
        sn.nextDir = clonePoint(sn.dir);
        return s;
      }
      // Other self-collision → death
      return killSnake(s, snakeIndex, snakeIndex);
    }
  }

  // 3. Other snake collision
  for (let j = 0; j < s.snakes.length; j++) {
    if (j === snakeIndex || !s.snakes[j].alive) continue;
    const other = s.snakes[j];

    for (let si = 0; si < other.body.length; si++) {
      const seg = other.body[si];
      if (seg.x === nx && seg.y === ny) {
        // Head-to-head collision (both at index 0)
        if (si === 0) {
          // Longer wins, equal both die
          if (sn.body.length > other.body.length) {
            return killSnake(s, j, snakeIndex);
          } else if (sn.body.length < other.body.length) {
            return killSnake(s, snakeIndex, j);
          } else {
            let result = killSnake(s, snakeIndex, j);
            result = killSnake(result, j, snakeIndex);
            return result;
          }
        }

        // Hit other snake's body
        if (sn.shield) {
          // Shield: kill the other snake
          return killSnake(s, j, snakeIndex);
        }
        return killSnake(s, snakeIndex, j);
      }
    }
  }

  // Move forward
  sn.body.unshift({ x: nx, y: ny });
  return postMove(s, snakeIndex, nx, ny);
}

/**
 * Handle post-move: eating food, popping tail
 */
function postMove(
  state: GameState,
  snakeIndex: number,
  nx: number,
  ny: number,
): GameState {
  const s = state; // already cloned by caller
  const sn = s.snakes[snakeIndex];
  let ate = false;

  // Check food
  for (let fi = s.foods.length - 1; fi >= 0; fi--) {
    const food = s.foods[fi];
    if (food.pos.x === nx && food.pos.y === ny) {
      ate = true;
      sn.score += food.value;

      // Spawn particles at eating position
      spawnEatParticles(s, nx, ny, sn.color.body);

      // Apply food effect
      if (food.type === 'shield') {
        sn.shield = true;
        sn.shieldTimer = 5000;
      } else if (food.type === 'speed') {
        sn.boosting = true;
      }

      s.foods.splice(fi, 1);
      break;
    }
  }

  // Pop tail if nothing was eaten
  if (!ate) {
    sn.body.pop();
  }

  return s;
}

/**
 * Kill a snake, credit the killer
 */
function killSnake(
  state: GameState,
  victimIndex: number,
  killerIndex: number,
): GameState {
  const s = cloneState(state);
  const victim = s.snakes[victimIndex];
  if (!victim || !victim.alive) return s;

  victim.alive = false;
  victim.respawnTimer = RESPAWN_TICKS;

  // Credit kill
  if (killerIndex !== victimIndex) {
    const killer = s.snakes[killerIndex];
    if (killer) {
      killer.kills += 1;
    }
  }

  // Death particles
  for (const seg of victim.body) {
    for (let i = 0; i < 3; i++) {
      s.particles.push({
        x: seg.x,
        y: seg.y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        life: 1,
        maxLife: 1,
        color: victim.color.body,
        size: 2 + Math.random() * 3,
      });
    }
  }

  return s;
}

/**
 * Spawn eat-effect particles
 */
function spawnEatParticles(
  state: GameState,
  gx: number,
  gy: number,
  color: string,
): void {
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
    const speed = 2 + Math.random() * 3;
    state.particles.push({
      x: gx,
      y: gy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      maxLife: 1,
      color,
      size: 2 + Math.random() * 2,
    });
  }
}

/**
 * 5. tickAI – greedy pathfinding AI, returns best direction
 */
export function tickAI(state: GameState, snakeIndex: number): Point {
  const sn = state.snakes[snakeIndex];
  if (!sn || !sn.alive) return { x: 1, y: 0 };

  const head = sn.body[0];
  const { gridW, gridH } = state.config;

  const dirs: Point[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  // Find nearest food
  let nearestFood: Point | null = null;
  let nearestDist = Infinity;
  for (const f of state.foods) {
    const dist = Math.abs(head.x - f.pos.x) + Math.abs(head.y - f.pos.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestFood = f.pos;
    }
  }

  let bestDir: Point = { ...sn.dir };
  let bestDist = Infinity;

  for (const d of dirs) {
    // AI avoids reversing into itself (AI doesn't do U-turns)
    if (d.x === -sn.dir.x && d.y === -sn.dir.y) continue;

    const nx = head.x + d.x;
    const ny = head.y + d.y;

    // Wall check
    if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;

    // Self-body check
    let blocked = false;
    for (const seg of sn.body) {
      if (seg.x === nx && seg.y === ny) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    // Other snakes check
    for (const other of state.snakes) {
      if (other === sn || !other.alive) continue;
      for (const seg of other.body) {
        if (seg.x === nx && seg.y === ny) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (blocked) continue;

    // Calculate distance to nearest food
    if (nearestFood) {
      const dist =
        Math.abs(nx - nearestFood.x) + Math.abs(ny - nearestFood.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestDir = d;
      }
    } else {
      // No food: just pick first safe direction
      bestDir = d;
      break;
    }
  }

  return bestDir;
}

/**
 * 6. spawnFood – add a food item to the state
 */
export function spawnFood(state: GameState): GameState {
  const s = cloneState(state);
  const { gridW, gridH } = s.config;

  // Don't exceed 8 foods
  if (s.foods.length >= 8) return s;

  const pos = randomFreeCell(gridW, gridH, s.snakes, s.foods);

  // Random food type
  const roll = Math.random();
  let type: Food['type'];
  let value: number;

  if (roll < 0.65) {
    type = 'normal';
    value = 10;
  } else if (roll < 0.80) {
    type = 'big';
    value = 25;
  } else if (roll < 0.92) {
    type = 'speed';
    value = 10;
  } else {
    type = 'shield';
    value = 10;
  }

  s.foods.push({ pos, type, value });
  return s;
}

/**
 * 7. getSpeedInterval – compute move interval in ms
 */
export function getSpeedInterval(snake: Snake, config: GameConfig): number {
  const baseSpeed = BASE_SPEEDS[config.speed] ?? BASE_SPEEDS.normal;
  const length = snake.body.length;

  // Length scaling: longer snake → slower
  const lengthFactor = Math.min(2, 1 + (length - 3) * 0.03);
  let interval = baseSpeed * lengthFactor;

  // Boosting halves the interval (min 40ms)
  if (snake.boosting && snake.energy > 0) {
    interval = Math.max(40, interval * 0.5);
  }

  return interval;
}

/**
 * 8. respawnSnake – respawn a dead snake at a random position
 */
export function respawnSnake(
  state: GameState,
  snakeIndex: number,
): GameState {
  const s = cloneState(state);
  const sn = s.snakes[snakeIndex];
  if (!sn) return s;

  const { gridW, gridH } = s.config;

  // Find a safe 3-cell spawn location
  let pos: Point | null = null;
  let dx = 1;
  for (let attempt = 0; attempt < 200; attempt++) {
    const px = Math.floor(Math.random() * gridW);
    const py = Math.floor(Math.random() * gridH);
    dx = Math.random() > 0.5 ? 1 : -1;

    const p1 = { x: px, y: py };
    const p2 = { x: px - dx, y: py };
    const p3 = { x: px - dx * 2, y: py };

    // Check bounds
    if (
      p2.x < 0 || p2.x >= gridW ||
      p3.x < 0 || p3.x >= gridW
    ) continue;

    // Check occupancy
    if (
      !isOccupied(p1.x, p1.y, s.snakes, s.foods) &&
      !isOccupied(p2.x, p2.y, s.snakes, s.foods) &&
      !isOccupied(p3.x, p3.y, s.snakes, s.foods)
    ) {
      pos = p1;
      break;
    }
  }

  if (!pos) {
    pos = randomFreeCell(gridW, gridH, s.snakes, s.foods);
    dx = 1;
  }

  // Reset snake body and state, keep score
  sn.body = [
    { x: pos.x, y: pos.y },
    { x: pos.x - dx, y: pos.y },
    { x: pos.x - dx * 2, y: pos.y },
  ];
  sn.dir = { x: dx, y: 0 };
  sn.nextDir = { x: dx, y: 0 };
  sn.alive = true;
  sn.respawnTimer = 0;
  sn.shield = false;
  sn.shieldTimer = 0;
  sn.boosting = false;
  sn.energy = ENERGY_MAX;

  return s;
}
