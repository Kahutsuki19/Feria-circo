"use strict";
/* =====================================================================
   CARRERA DOBLE — juego de plataformas/carrera para 2 jugadores (1 teclado)
   Usa los sprites de Kenney's "New Platformer Pack".
   Código base pensado para editarse fácilmente: casi todo el diseño de
   niveles vive en la sección "NIVELES" como listas simples de datos.
   ===================================================================== */

// ---------------------------------------------------------------------
// 1) CONSTANTES GENERALES
// ---------------------------------------------------------------------
const TILE = 64;                 // tamaño de cada casilla en px
const ROWS = 10;                 // filas visibles de alto (10*64 = 640)
const VIEW_W = 1152;
const VIEW_H = 640;

const GRAVITY = 2200;            // px/s^2
const JUMP_VELOCITY = -820;      // px/s
const MAX_FALL_SPEED = 1100;     // px/s
const MOVE_ACCEL = 3200;         // px/s^2
const AIR_ACCEL_FACTOR = 0.6;
const MAX_SPEED = 320;           // px/s
const FRICTION = 2800;           // px/s^2

const PLAYER_W = 42;
const PLAYER_H = 60;
const PLAYER_DUCK_H = 36;
const RESPAWN_INVULN = 1.2;      // segundos de invulnerabilidad tras reaparecer

// ---------------------------------------------------------------------
// 2) ASSETS
// ---------------------------------------------------------------------
const ASSET_MANIFEST = {
  // personajes
  p_green_idle:   "assets/characters/character_green_idle.png",
  p_green_walk_a: "assets/characters/character_green_walk_a.png",
  p_green_walk_b: "assets/characters/character_green_walk_b.png",
  p_green_jump:   "assets/characters/character_green_jump.png",
  p_green_hit:    "assets/characters/character_green_hit.png",
  p_green_duck:   "assets/characters/character_green_duck.png",

  p_pink_idle:   "assets/characters/character_pink_idle.png",
  p_pink_walk_a: "assets/characters/character_pink_walk_a.png",
  p_pink_walk_b: "assets/characters/character_pink_walk_b.png",
  p_pink_jump:   "assets/characters/character_pink_jump.png",
  p_pink_hit:    "assets/characters/character_pink_hit.png",
  p_pink_duck:   "assets/characters/character_pink_duck.png",

  // terreno
  tile_grass: "assets/tiles/terrain_grass_block_center.png",
  tile_dirt:  "assets/tiles/terrain_dirt_block_center.png",
  tile_plank: "assets/tiles/block_planks.png",
  spikes:     "assets/tiles/spikes.png",
  lava_top:   "assets/tiles/lava_top.png",
  flag_a:     "assets/tiles/flag_green_a.png",
  flag_b:     "assets/tiles/flag_green_b.png",
  ckpt_a:     "assets/tiles/flag_blue_a.png",
  ckpt_b:     "assets/tiles/flag_blue_b.png",
  coin:       "assets/tiles/coin_gold.png",
  sign_exit:  "assets/tiles/sign_exit.png",

  // enemigos / peligros
  slime_a:  "assets/enemies/slime_normal_walk_a.png",
  slime_b:  "assets/enemies/slime_normal_walk_b.png",
  saw_a:    "assets/enemies/saw_a.png",
  saw_b:    "assets/enemies/saw_b.png",

  // fondos
  bg_hills:     "assets/backgrounds/background_color_hills.png",
  bg_mushrooms: "assets/backgrounds/background_color_mushrooms.png",
  bg_desert:    "assets/backgrounds/background_color_desert.png",
};

const IMAGES = {};
function loadImages(manifest) {
  const keys = Object.keys(manifest);
  return Promise.all(keys.map(key => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => {
      console.warn("No se pudo cargar la imagen:", manifest[key]);
      resolve(); // seguimos aunque falte un asset, para no romper el juego
    };
    img.src = manifest[key];
    IMAGES[key] = img;
  })));
}

// ---------------------------------------------------------------------
// 3) ENTRADA DE TECLADO
// ---------------------------------------------------------------------
const keys = new Set();
const WATCHED_KEYS = new Set([
  "KeyA","KeyD","KeyW","KeyS",
  "ArrowLeft","ArrowRight","ArrowUp","ArrowDown",
  "Space","Enter","KeyP","KeyR"
]);
window.addEventListener("keydown", (e) => {
  if (WATCHED_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
  handleGlobalKey(e.code);
});
window.addEventListener("keyup", (e) => {
  if (WATCHED_KEYS.has(e.code)) e.preventDefault();
  keys.delete(e.code);
});

// ---------------------------------------------------------------------
// 4) HERRAMIENTAS PARA CONSTRUIR NIVELES (DSL simple)
// ---------------------------------------------------------------------
function makeGrid(cols) {
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(cols).fill("."));
  return grid;
}
// Rellena una meseta sólida desde 'topRow' hasta el fondo (columnas c0..c1)
function plateau(grid, c0, c1, topRow) {
  for (let c = c0; c <= c1; c++) {
    for (let r = topRow; r <= ROWS - 1; r++) grid[r][c] = "#";
  }
}
// Alias para el "suelo normal" (dos filas de grosor)
function ground(grid, c0, c1) { plateau(grid, c0, c1, ROWS - 2); }
// Bloque flotante suelto de una sola casilla (o varias en fila)
function block(grid, c0, c1, row) {
  for (let c = c0; c <= c1; c++) grid[row][c] = "#";
}
// Vacía una columna completa (para crear un hueco/abismo)
function clearGap(grid, c0, c1) {
  for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) grid[r][c] = ".";
}
// Coloca lava visible+letal en el fondo de un hueco
function lavaFloor(grid, c0, c1) { for (let c = c0; c <= c1; c++) grid[ROWS - 1][c] = "L"; }
function spike(grid, c, row) { grid[row][c] = "S"; }
function coinAt(grid, c, row) { grid[row][c] = "C"; }
// Devuelve la fila del primer bloque sólido de una columna (suelo o meseta),
// o ROWS si la columna está vacía (un hueco, sin suelo debajo).
function groundRowAt(grid, c) {
  for (let r = 0; r < ROWS; r++) { if (grid[r][c] === "#") return r; }
  return ROWS;
}
// Coloca una moneda "suelta" flotando 'tilesUp' casillas encima del suelo
// real de esa columna (funciona igual sobre suelo normal o una meseta
// elevada). Con el salto máximo actual (~2.4 casillas), tilesUp=2 siempre
// es alcanzable en solitario.
function coinAboveGround(grid, c, tilesUp) {
  const gRow = groundRowAt(grid, c);
  if (gRow >= ROWS) return; // columna sin suelo (hueco): no colocar moneda ahí
  coinAt(grid, c, Math.max(0, gRow - tilesUp));
}
function flagAt(grid, c, row) { grid[row][c] = "F"; }
function checkpointAt(grid, c, row) { grid[row][c] = "K"; }

function makePlatform({ axis, min, max, fixed, w, h, speed, startAtMin = true }) {
  return { axis, min, max, fixed, w, h, speed, dir: 1, pos: startAtMin ? min : max, prevX: 0, prevY: 0 };
}
function platformRect(p) {
  if (p.axis === "x") return { x: p.pos, y: p.fixed, w: p.w, h: p.h };
  return { x: p.fixed, y: p.pos, w: p.w, h: p.h };
}

function makeEnemy(col, groundRow, minCol, maxCol, speed) {
  return {
    x: col * TILE, y: groundRow * TILE - 40,
    w: 48, h: 40,
    minX: minCol * TILE, maxX: maxCol * TILE,
    speed, dir: 1, alive: true, animT: 0,
  };
}

// ---------------------------------------------------------------------
// 5) NIVELES
// ---------------------------------------------------------------------
function buildLevel1() {
  const cols = 46;
  const grid = makeGrid(cols);
  ground(grid, 0, cols - 1);

  // pequeños huecos de práctica (sencillos, con red de lava visible abajo)
  [[14, 14], [27, 28]].forEach(([a, b]) => { clearGap(grid, a, b); lavaFloor(grid, a, b); });

  // un par de plataformas flotantes para practicar el salto (con monedas de bono)
  block(grid, 9, 11, ROWS - 4);
  coinAt(grid, 10, ROWS - 5);
  block(grid, 33, 35, ROWS - 4);
  coinAt(grid, 34, ROWS - 5);

  flagAt(grid, cols - 3, ROWS - 3);

  // un par de enemigos lentos y fáciles para practicar cómo saltarles encima
  const enemies = [
    makeEnemy(19, ROWS - 2, 16, 22, 55),
    makeEnemy(39, ROWS - 2, 37, 43, 55),
  ];

  return {
    id: 1,
    name: "Colinas Tranquilas",
    tip: "Usen A/D o ◄/► para moverse y W/▲ para saltar. Salten sobre la cabeza de los slimes para vencerlos. ¡Nivel tranquilo, solo para practicar!",
    background: "bg_hills",
    cols, grid,
    spawn1: { c: 1 }, spawn2: { c: 2 },
    platforms: [], enemies, saws: [], checkpoints: [],
  };
}

function buildLevel2() {
  const cols = 64;
  const grid = makeGrid(cols);
  ground(grid, 0, cols - 1);

  const gaps = [[10, 11], [20, 21], [37, 43], [53, 54]];
  gaps.forEach(([a, b]) => { clearGap(grid, a, b); lavaFloor(grid, a, b); });

  // pinchos sobre el suelo normal
  [16, 30, 48].forEach(c => spike(grid, c, ROWS - 2));

  // plataformas flotantes de bonificación (misma altura que en el Nivel 1:
  // 2 casillas sobre el suelo, dentro del alcance de un salto normal)
  block(grid, 6, 7, ROWS - 4);
  coinAt(grid, 6, ROWS - 5);
  coinAt(grid, 9, ROWS - 5); // piedra de un solo tile: cadena de saltos hacia el hueco
  block(grid, 9, 9, ROWS - 4);
  block(grid, 33, 33, ROWS - 4); // pequeña cadena de saltos antes del puente móvil
  coinAt(grid, 33, ROWS - 5);
  block(grid, 35, 35, ROWS - 4);
  coinAt(grid, 35, ROWS - 5);
  block(grid, 45, 47, ROWS - 4);
  coinAt(grid, 46, ROWS - 5);
  block(grid, 50, 50, ROWS - 4);
  coinAt(grid, 50, ROWS - 5);

  // monedas sueltas (2 casillas sobre el suelo real de cada columna)
  [4, 26, 59].forEach(c => coinAboveGround(grid, c, 2));

  flagAt(grid, cols - 3, ROWS - 3);

  const platforms = [
    makePlatform({ axis: "x", min: 37 * TILE, max: 41 * TILE, fixed: (ROWS - 2) * TILE, w: 2 * TILE, h: 20, speed: 90 }),
  ];
  const enemies = [
    makeEnemy(24, ROWS - 2, 23, 35, 70),
    makeEnemy(56, ROWS - 2, 55, 62, 85),
  ];

  return {
    id: 2,
    name: "Cañón de Setas",
    tip: "¡Toca practicar el salto! Encadenen saltos entre plataformas, esquiven pinchos y un slime patrullando. Si caen a la lava reaparecen en el inicio del nivel.",
    background: "bg_mushrooms",
    cols, grid,
    spawn1: { c: 1 }, spawn2: { c: 2 },
    platforms, enemies, saws: [], checkpoints: [],
  };
}

function buildLevel3() {
  const cols = 85;
  const grid = makeGrid(cols);

  // tramos de suelo a distinta altura (mesas) separados por huecos
  ground(grid, 0, 8);
  ground(grid, 11, 18);
  ground(grid, 25, 33);
  ground(grid, 42, 45);
  // Meseta elevada: 2 casillas sobre el suelo normal (igual que en el resto
  // del juego), así que SIEMPRE se puede alcanzar en solitario con un salto
  // normal — antes estaba a 3 casillas y era un muro imposible de subir.
  plateau(grid, 46, 55, ROWS - 4);
  plateau(grid, 56, 57, ROWS - 3);  // escalón de bajada
  ground(grid, 58, 69);
  ground(grid, 75, 84);

  // huecos (abismos) — algunos se cruzan con plataformas móviles
  [[9, 10], [19, 24], [34, 41], [70, 74]].forEach(([a, b]) => { clearGap(grid, a, b); lavaFloor(grid, a, b); });

  // pinchos (uno extra encima de la meseta, entre la sierra y el enemigo)
  [14, 61].forEach(c => spike(grid, c, ROWS - 2));
  spike(grid, 52, ROWS - 4); // pincho sobre la propia superficie de la meseta

  // puntos de control (actualizan el punto de reaparición de cada jugador)
  checkpointAt(grid, 30, ROWS - 3);
  checkpointAt(grid, 76, ROWS - 3);

  // monedas de bonificación (2 casillas sobre el suelo real de cada columna,
  // sea suelo normal o la meseta elevada — antes usaban una fila fija
  // demasiado alta y la mayoría quedaban fuera de alcance)
  [5, 13, 29, 77].forEach(c => coinAboveGround(grid, c, 2));

  // bono muy alto y opcional sobre la meseta: NO bloquea el camino
  // principal, pero solo se alcanza saltando sobre la cabeza del
  // compañero (3 casillas de altura) — aquí es donde de verdad hace
  // falta trabajar en equipo.
  [49, 50, 51].forEach(c => coinAt(grid, c, 3));

  flagAt(grid, 83, ROWS - 3);

  const platforms = [
    makePlatform({ axis: "x", min: 19 * TILE, max: 23 * TILE, fixed: (ROWS - 2) * TILE, w: 2 * TILE, h: 20, speed: 100 }),
    makePlatform({ axis: "x", min: 34 * TILE, max: 39 * TILE, fixed: (ROWS - 2) * TILE, w: 2 * TILE, h: 20, speed: 110 }),
    makePlatform({ axis: "x", min: 70 * TILE, max: 73 * TILE, fixed: (ROWS - 2) * TILE, w: 2 * TILE, h: 20, speed: 135 }),
  ];
  const enemies = [
    makeEnemy(16, ROWS - 2, 15, 18, 80),
    makeEnemy(32, ROWS - 2, 26, 33, 85),
    makeEnemy(49, ROWS - 4, 47, 54, 75), // patrulla la meseta elevada
    makeEnemy(80, ROWS - 2, 78, 83, 95),
  ];
  const saws = [
    makePlatform({ axis: "y", min: 3 * TILE, max: 7 * TILE, fixed: 9.5 * TILE, w: 44, h: 44, speed: 150 }),   // sobre el hueco 1
    makePlatform({ axis: "x", min: 47 * TILE, max: 54 * TILE, fixed: (ROWS - 5) * TILE, w: 44, h: 44, speed: 130 }), // barre la meseta alta
    makePlatform({ axis: "y", min: 3 * TILE, max: 7 * TILE, fixed: 65 * TILE, w: 44, h: 44, speed: 175 }),   // sube y baja a media altura
  ];

  return {
    id: 3,
    name: "Abismo Ardiente",
    tip: "Nivel muy difícil incluso trabajando juntos. Consejo clave: uno puede saltar sobre la cabeza del otro para ganar altura extra en la meseta elevada. Usen S/▼ para agacharse bajo las sierras.",
    background: "bg_desert",
    cols, grid,
    spawn1: { c: 1 }, spawn2: { c: 2 },
    platforms, enemies, saws, checkpoints: [{ c: 30 }, { c: 76 }],
  };
}

const LEVELS = [buildLevel1(), buildLevel2(), buildLevel3()];

// ---------------------------------------------------------------------
// 6) ESTADO DEL JUEGO
// ---------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false; // arte pixel: evita el difuminado que crea costuras entre tiles/fondo

const game = {
  state: "MENU",       // MENU | LEVEL_INTRO | PLAYING | PAUSED | LEVEL_DONE | FINAL
  levelIndex: 0,
  level: null,
  coinsCollected: 0,
  wins: { p1: 0, p2: 0 },
  levelResults: [],    // historial {levelId, winner, t1, t2}
  cameraX: 0,
  cameraInit: false,
  lastTime: 0,
  runtimeCoins: null,  // Set de "c,r" recogidas en el nivel actual
  bannerShown: false,
};

function makeInitialPlayerState(id, spawnCol) {
  return {
    id,
    color: id === "p1" ? "green" : "pink",
    x: spawnCol * TILE + (TILE - PLAYER_W) / 2,
    y: (ROWS - 2) * TILE - PLAYER_H,
    vx: 0, vy: 0,
    w: PLAYER_W, h: PLAYER_H,
    facing: 1,
    onGround: false,
    ducking: false,
    anim: "idle", animT: 0, animFrame: 0,
    finished: false, time: 0,
    invuln: 0,
    respawnX: spawnCol * TILE + (TILE - PLAYER_W) / 2,
    respawnY: (ROWS - 2) * TILE - PLAYER_H,
    standingOnPlatform: null,
    standingOnPlayer: null,
    falls: 0,
  };
}

let player1, player2;

function loadLevel(index) {
  game.levelIndex = index;
  game.level = LEVELS[index];
  const lvl = game.level;

  // reinicia entidades dinámicas para que el nivel arranque "limpio"
  lvl.platforms.forEach(p => { p.pos = p.min; p.dir = 1; });
  lvl.saws.forEach(s => { s.pos = s.min; s.dir = 1; });
  lvl.enemies.forEach(e => { e.x = e.minX; e.dir = 1; e.alive = true; });

  player1 = makeInitialPlayerState("p1", lvl.spawn1.c);
  player2 = makeInitialPlayerState("p2", lvl.spawn2.c);

  game.runtimeCoins = new Set();
  game.coinsCollected = 0;
  game.cameraX = 0;
  game.cameraInit = false;
  game.bannerShown = false;

  document.getElementById("hudLevelName").textContent = `Nivel ${lvl.id} — ${lvl.name}`;
  document.getElementById("finishBanner").classList.add("hidden");
  updateHudFinishedPill(player1, false);
  updateHudFinishedPill(player2, false);
}

// ---------------------------------------------------------------------
// 7) COLISIONES CONTRA EL MAPA DE CASILLAS
// ---------------------------------------------------------------------
function tileAt(grid, col, row) {
  if (row < 0 || row >= ROWS || col < 0 || col >= grid[0].length) return "#"; // fuera de rango = sólido (borde del mundo)
  return grid[row][col];
}
function isSolid(ch) { return ch === "#"; }
function isHazard(ch) { return ch === "S" || ch === "L"; }

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// El sprite del slime (64x64 origen) deja bastante margen transparente
// alrededor del cuerpo (sobre todo arriba). Si usamos el rectángulo completo
// de la imagen como hitbox, el jugador "muere" al tocar aire vacío. Esta
// función devuelve un rectángulo de colisión más ajustado al cuerpo visible.
const ENEMY_HIT_INSET_X = 0.08;   // % del ancho recortado a cada lado
const ENEMY_HIT_INSET_TOP = 0.32; // % del alto recortado arriba (el sprite pega los pies abajo)
function enemyHitRect(en) {
  const insetX = en.w * ENEMY_HIT_INSET_X;
  const insetTop = en.h * ENEMY_HIT_INSET_TOP;
  return { x: en.x + insetX, y: en.y + insetTop, w: en.w - insetX * 2, h: en.h - insetTop };
}

function resolveTileCollisionsX(entity, grid) {
  const col0 = Math.floor(entity.x / TILE);
  const col1 = Math.floor((entity.x + entity.w) / TILE);
  const row0 = Math.floor(entity.y / TILE);
  const row1 = Math.floor((entity.y + entity.h) / TILE);
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      if (!isSolid(tileAt(grid, c, r))) continue;
      const tileRect = { x: c * TILE, y: r * TILE, w: TILE, h: TILE };
      if (!rectsOverlap(entity, tileRect)) continue;
      if (entity.vx > 0) entity.x = tileRect.x - entity.w;
      else if (entity.vx < 0) entity.x = tileRect.x + TILE;
      entity.vx = 0;
    }
  }
}
function resolveTileCollisionsY(entity, grid) {
  entity.onGround = false;
  const col0 = Math.floor(entity.x / TILE);
  const col1 = Math.floor((entity.x + entity.w) / TILE);
  const row0 = Math.floor(entity.y / TILE);
  const row1 = Math.floor((entity.y + entity.h) / TILE);
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      if (!isSolid(tileAt(grid, c, r))) continue;
      const tileRect = { x: c * TILE, y: r * TILE, w: TILE, h: TILE };
      if (!rectsOverlap(entity, tileRect)) continue;
      if (entity.vy > 0) { entity.y = tileRect.y - entity.h; entity.onGround = true; }
      else if (entity.vy < 0) { entity.y = tileRect.y + TILE; }
      entity.vy = 0;
    }
  }
}

function respawnPlayer(p) {
  p.x = p.respawnX; p.y = p.respawnY;
  p.vx = 0; p.vy = 0;
  p.invuln = RESPAWN_INVULN;
  p.falls++;
  p.standingOnPlatform = null;
  p.standingOnPlayer = null;
}

// ---------------------------------------------------------------------
// 8) ACTUALIZACIÓN DE JUGADORES
// ---------------------------------------------------------------------
function updatePlayer(p, other, dt, lvl) {
  if (p.finished) { p.vx = 0; return; }
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

  const ctrl = p.id === "p1"
    ? { left: keys.has("KeyA"), right: keys.has("KeyD"), jump: keys.has("KeyW"), duck: keys.has("KeyS") }
    : { left: keys.has("ArrowLeft"), right: keys.has("ArrowRight"), jump: keys.has("ArrowUp"), duck: keys.has("ArrowDown") };

  // ----- agacharse -----
  const wantsDuck = ctrl.duck && p.onGround;
  if (wantsDuck !== p.ducking) {
    const oldBottom = p.y + p.h;
    p.h = wantsDuck ? PLAYER_DUCK_H : PLAYER_H;
    p.y = oldBottom - p.h;
    p.ducking = wantsDuck;
  }

  // ----- movimiento horizontal -----
  const accel = MOVE_ACCEL * (p.onGround ? 1 : AIR_ACCEL_FACTOR);
  if (ctrl.left && !ctrl.right) {
    p.vx -= accel * dt;
    p.facing = -1;
  } else if (ctrl.right && !ctrl.left) {
    p.vx += accel * dt;
    p.facing = 1;
  } else {
    const decel = FRICTION * dt;
    if (p.vx > 0) p.vx = Math.max(0, p.vx - decel);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + decel);
  }
  p.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.vx));

  // ----- salto -----
  if (ctrl.jump && p.onGround && !p.ducking) {
    p.vy = JUMP_VELOCITY;
    p.onGround = false;
    p.standingOnPlatform = null;
    p.standingOnPlayer = null;
  }

  // ----- gravedad -----
  p.vy += GRAVITY * dt;
  if (p.vy > MAX_FALL_SPEED) p.vy = MAX_FALL_SPEED;

  // ----- si va sobre una plataforma móvil, la acompaña -----
  if (p.standingOnPlatform) {
    p.x += p.standingOnPlatform.dx || 0;
  }
  if (p.standingOnPlayer && !p.standingOnPlayer.finished) {
    p.x += p.standingOnPlayer.frameDx || 0;
  }

  // ----- aplica movimiento y resuelve colisiones contra el mapa -----
  p.x += p.vx * dt;
  resolveTileCollisionsX(p, lvl.grid);
  p.y += p.vy * dt;
  p.standingOnPlatform = null;
  p.standingOnPlayer = null;
  resolveTileCollisionsY(p, lvl.grid);

  // ----- límites del mundo -----
  if (p.x < 0) { p.x = 0; p.vx = 0; }
  const worldW = lvl.cols * TILE;
  if (p.x + p.w > worldW) { p.x = worldW - p.w; p.vx = 0; }
  if (p.y > ROWS * TILE + 200) { respawnPlayer(p); return; }

  // ----- colisión con plataformas móviles (aterrizar encima) -----
  for (const plat of lvl.platforms) {
    const rect = platformRect(plat);
    const feet = { x: p.x, y: p.y + p.h - 1, w: p.w, h: 2 };
    if (p.vy >= 0 && rectsOverlap(feet, rect) && p.y + p.h - (p.vy * dt) <= rect.y + 6) {
      p.y = rect.y - p.h;
      p.vy = 0;
      p.onGround = true;
      p.standingOnPlatform = plat;
    }
  }

  // ----- peligros de las casillas (pinchos / lava) -----
  if (p.invuln <= 0) {
    const col0 = Math.floor(p.x / TILE), col1 = Math.floor((p.x + p.w) / TILE);
    const row0 = Math.floor(p.y / TILE), row1 = Math.floor((p.y + p.h) / TILE);
    outer:
    for (let r = row0; r <= row1; r++) {
      for (let c = col0; c <= col1; c++) {
        const ch = tileAt(lvl.grid, c, r);
        if (isHazard(ch)) { respawnPlayer(p); break outer; }
      }
    }
  }

  // ----- sierras (siempre letales) -----
  if (p.invuln <= 0) {
    for (const saw of lvl.saws) {
      const rect = platformRect(saw);
      if (rectsOverlap(p, rect)) { respawnPlayer(p); break; }
    }
  }

  // ----- enemigos (slime): aplastar desde arriba o recibir daño -----
  if (p.invuln <= 0) {
    for (const en of lvl.enemies) {
      if (!en.alive) continue;
      const hit = enemyHitRect(en);
      if (!rectsOverlap(p, hit)) continue;
      const wasAbove = (p.y + p.h - (p.vy * dt)) <= hit.y + 10;
      if (p.vy > 0 && wasAbove) {
        en.alive = false;
        p.vy = JUMP_VELOCITY * 0.6; // pequeño rebote
      } else {
        respawnPlayer(p);
        break;
      }
    }
  }

  // ----- monedas -----
  const col0 = Math.floor(p.x / TILE), col1 = Math.floor((p.x + p.w) / TILE);
  const row0 = Math.floor(p.y / TILE), row1 = Math.floor((p.y + p.h) / TILE);
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      if (tileAt(lvl.grid, c, r) === "C") {
        const key = c + "," + r;
        if (!game.runtimeCoins.has(key)) {
          game.runtimeCoins.add(key);
          game.coinsCollected++;
        }
      }
    }
  }

  // ----- puntos de control -----
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      if (tileAt(lvl.grid, c, r) === "K") {
        p.respawnX = c * TILE + (TILE - PLAYER_W) / 2;
        p.respawnY = (Math.min(ROWS - 2, r + 1)) * TILE - PLAYER_H;
        // ajusta a la altura real del suelo bajo ese punto de control
        let groundRow = r + 1;
        while (groundRow < ROWS && !isSolid(tileAt(lvl.grid, c, groundRow))) groundRow++;
        p.respawnY = groundRow * TILE - PLAYER_H;
      }
    }
  }

  // ----- meta -----
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      if (tileAt(lvl.grid, c, r) === "F" && !p.finished) {
        p.finished = true;
        p.time = game.levelTime;
        onPlayerFinished(p);
      }
    }
  }

  // ----- animación -----
  p.animT += dt;
  if (!p.onGround) p.anim = "jump";
  else if (p.ducking) p.anim = "duck";
  else if (Math.abs(p.vx) > 15) p.anim = "walk";
  else p.anim = "idle";
  if (p.anim === "walk") {
    if (p.animT > 0.12) { p.animT = 0; p.animFrame = 1 - p.animFrame; }
  } else {
    p.animFrame = 0;
  }
}

function onPlayerFinished(p) {
  updateHudFinishedPill(p, true);
  if (!game.bannerShown) {
    game.bannerShown = true;
    showFinishBanner(p);
  } else {
    // el segundo jugador también llegó: actualiza el subtítulo del banner
    const sub = document.getElementById("finishSub");
    sub.textContent = `¡Ambos llegaron! Verde: ${player1.finished ? player1.time.toFixed(1) + "s" : "—"} · Rosa: ${player2.finished ? player2.time.toFixed(1) + "s" : "—"}`;
  }
}

function showFinishBanner(winner) {
  const title = document.getElementById("finishTitle");
  const sub = document.getElementById("finishSub");
  const name = winner.id === "p1" ? "Jugador Verde" : "Jugador Rosa";
  title.textContent = `¡${name} llega primero!`;
  sub.textContent = `Tiempo: ${winner.time.toFixed(1)}s — el otro jugador puede seguir intentándolo.`;
  document.getElementById("finishBanner").classList.remove("hidden");
}

function updateHudFinishedPill(p, finished) {
  const el = document.querySelector(`.player-pill.${p.id}`);
  if (el) el.classList.toggle("finished", finished);
}

// ---------------------------------------------------------------------
// 9) ACTUALIZACIÓN DE ENTIDADES DEL NIVEL
// ---------------------------------------------------------------------
function stepOscillators(lvl, dt) {
  for (const p of lvl.platforms) {
    const prev = p.pos;
    p.pos += p.speed * p.dir * dt;
    if (p.pos > p.max) { p.pos = p.max; p.dir = -1; }
    if (p.pos < p.min) { p.pos = p.min; p.dir = 1; }
    const delta = p.pos - prev;
    p.dx = (p.axis === "x") ? delta : 0;
    p.dy = (p.axis === "y") ? delta : 0;
  }
  for (const s of lvl.saws) {
    const prev = s.pos;
    s.pos += s.speed * s.dir * dt;
    if (s.pos > s.max) { s.pos = s.max; s.dir = -1; }
    if (s.pos < s.min) { s.pos = s.min; s.dir = 1; }
  }
}

function updateEnemies(lvl, dt) {
  for (const en of lvl.enemies) {
    if (!en.alive) continue;
    en.x += en.speed * en.dir * dt;
    if (en.x > en.maxX) { en.x = en.maxX; en.dir = -1; }
    if (en.x < en.minX) { en.x = en.minX; en.dir = 1; }
    en.animT += dt;
    if (en.animT > 0.2) { en.animT = 0; en.animFrame = 1 - (en.animFrame || 0); }
  }
}

// ---------------------------------------------------------------------
// 10) INTERACCIÓN ENTRE LOS DOS JUGADORES
// ---------------------------------------------------------------------
function resolvePlayerVsPlayer(p1, p2, dt) {
  p1.frameDx = p1.vx * dt;
  p2.frameDx = p2.vx * dt;
  if (p1.finished || p2.finished) return;
  if (!rectsOverlap(p1, p2)) return;

  const p1Bottom = p1.y + p1.h;
  const p2Bottom = p2.y + p2.h;

  // ¿uno está aterrizando sobre la cabeza del otro? (permite ganar altura extra)
  const p1OnP2 = p1.vy >= 0 && (p1Bottom - p1.vy * dt) <= p2.y + 12 && p1Bottom > p2.y;
  const p2OnP1 = p2.vy >= 0 && (p2Bottom - p2.vy * dt) <= p1.y + 12 && p2Bottom > p1.y;

  if (p1OnP2 && !p2OnP1) {
    p1.y = p2.y - p1.h;
    p1.vy = 0;
    p1.onGround = true;
    p1.standingOnPlayer = p2;
    return;
  }
  if (p2OnP1 && !p1OnP2) {
    p2.y = p1.y - p2.h;
    p2.vy = 0;
    p2.onGround = true;
    p2.standingOnPlayer = p1;
    return;
  }

  // si no es un aterrizaje claro, se empujan lateralmente (como dos cuerpos sólidos)
  const overlapX = Math.min(p1.x + p1.w, p2.x + p2.w) - Math.max(p1.x, p2.x);
  if (overlapX > 0) {
    const push = overlapX / 2 + 0.5;
    if (p1.x < p2.x) { p1.x -= push; p2.x += push; }
    else { p1.x += push; p2.x -= push; }
  }
}

// ---------------------------------------------------------------------
// 11) CÁMARA
// ---------------------------------------------------------------------
// Reglas: si un jugador acaba de reaparecer (todavía está en su ventana de
// invulnerabilidad tras morir), la cámara NO debe tirar de vuelta hacia él;
// debe seguir mostrando al jugador que sigue vivo/avanzando. Cuando ambos
// están "vivos" (ninguno en su ventana de reaparición), la cámara vuelve a
// seguir a ambos, priorizando a quien va más adelante si están muy separados.
function updateCamera(lvl, dt) {
  const p1Reviving = player1.invuln > 0;
  const p2Reviving = player2.invuln > 0;

  let targetX;
  if (p1Reviving && !p2Reviving) {
    targetX = player2.x + player2.w / 2;
  } else if (p2Reviving && !p1Reviving) {
    targetX = player1.x + player1.w / 2;
  } else {
    const c1 = player1.x + player1.w / 2;
    const c2 = player2.x + player2.w / 2;
    const spread = Math.abs(c1 - c2);
    const CLOSE_RANGE = 5 * TILE;
    if (spread <= CLOSE_RANGE) {
      targetX = (c1 + c2) / 2;
    } else {
      // muy separados: prioriza a quien va primero, con un pequeño margen
      // hacia atrás para no dejar al otro completamente fuera de cuadro
      targetX = Math.max(c1, c2) - TILE * 1.5;
    }
  }

  let cam = targetX - VIEW_W / 2;
  const maxCam = Math.max(0, lvl.cols * TILE - VIEW_W);
  cam = Math.max(0, Math.min(maxCam, cam));

  if (!game.cameraInit) {
    game.cameraX = cam;
    game.cameraInit = true;
  } else {
    const followSpeed = 10; // más alto = la cámara alcanza el objetivo más rápido
    const t = 1 - Math.exp(-followSpeed * dt);
    game.cameraX += (cam - game.cameraX) * t;
  }
  game.cameraX = Math.round(game.cameraX); // evita posiciones fraccionarias (costuras visuales)
}

// ---------------------------------------------------------------------
// 12) RENDER
// ---------------------------------------------------------------------
function drawBackground(lvl) {
  const img = IMAGES[lvl.background];
  if (!img || !img.width) { ctx.fillStyle = "#87ceeb"; ctx.fillRect(0, 0, VIEW_W, VIEW_H); return; }
  const parallax = 0.35;
  // Escala la imagen manteniendo SIEMPRE su proporción original (nunca se
  // deforma) para que cubra todo el alto del escenario sin verse
  // "alargada y estrecha".
  const scale = VIEW_H / img.height;
  const tileW = img.width * scale;
  const offsetX = -(Math.floor(game.cameraX * parallax) % tileW);
  for (let x = offsetX - tileW; x < VIEW_W; x += tileW) {
    ctx.drawImage(img, Math.round(x), 0, Math.ceil(tileW) + 1, VIEW_H); // +1px de solape anti-costuras
  }
}

function drawTiles(lvl) {
  const grid = lvl.grid;
  const colStart = Math.max(0, Math.floor(game.cameraX / TILE) - 1);
  const colEnd = Math.min(lvl.cols - 1, Math.ceil((game.cameraX + VIEW_W) / TILE) + 1);

  for (let r = 0; r < ROWS; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const ch = grid[r][c];
      if (ch === ".") continue;
      const sx = c * TILE - game.cameraX;
      const sy = r * TILE;
      if (ch === "#") {
        const above = r > 0 ? grid[r - 1][c] : ".";
        const img = (above !== "#") ? IMAGES.tile_grass : IMAGES.tile_dirt;
        drawTileImg(img, sx, sy);
      } else if (ch === "S") {
        drawTileImg(IMAGES.spikes, sx, sy);
      } else if (ch === "L") {
        drawTileImg(IMAGES.lava_top, sx, sy);
      } else if (ch === "F") {
        const frame = (Math.floor(performance.now() / 400) % 2 === 0) ? IMAGES.flag_a : IMAGES.flag_b;
        if (IMAGES.sign_exit && IMAGES.sign_exit.width) drawTileImg(IMAGES.sign_exit, sx - TILE, sy);
        drawTileImg(frame, sx, sy);
      } else if (ch === "K") {
        const frame = (Math.floor(performance.now() / 400) % 2 === 0) ? IMAGES.ckpt_a : IMAGES.ckpt_b;
        drawTileImg(frame, sx, sy);
      } else if (ch === "C") {
        const key = c + "," + r;
        if (!game.runtimeCoins.has(key)) {
          const bob = Math.sin(performance.now() / 250 + c) * 4;
          drawTileImg(IMAGES.coin, sx, sy + bob);
        }
      }
    }
  }
}
function drawTileImg(img, x, y) {
  if (!img || !img.width) return;
  ctx.drawImage(img, x, y, TILE, TILE);
}

function drawPlatforms(lvl) {
  for (const p of lvl.platforms) {
    const rect = platformRect(p);
    const sx = rect.x - game.cameraX;
    const img = IMAGES.tile_plank;
    if (img && img.width) {
      const tilesN = Math.max(1, Math.round(rect.w / TILE));
      for (let i = 0; i < tilesN; i++) {
        ctx.drawImage(img, sx + i * TILE, rect.y, TILE, TILE * 0.5);
      }
    }
  }
}

function drawSaws(lvl) {
  const frame = (Math.floor(performance.now() / 90) % 2 === 0) ? IMAGES.saw_a : IMAGES.saw_b;
  for (const s of lvl.saws) {
    const rect = platformRect(s);
    const sx = rect.x - game.cameraX;
    if (frame && frame.width) ctx.drawImage(frame, sx, rect.y, rect.w, rect.h);
  }
}

function drawEnemies(lvl) {
  for (const en of lvl.enemies) {
    if (!en.alive) continue;
    const img = (en.animFrame ? IMAGES.slime_b : IMAGES.slime_a);
    const sx = en.x - game.cameraX;
    if (img && img.width) {
      ctx.save();
      if (en.dir < 0) {
        ctx.translate(sx + en.w, en.y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, en.w, en.h);
      } else {
        ctx.drawImage(img, sx, en.y, en.w, en.h);
      }
      ctx.restore();
    }
  }
}

function playerSprite(p) {
  const prefix = "p_" + p.color + "_";
  let key;
  if (p.anim === "jump") key = prefix + "jump";
  else if (p.anim === "duck") key = prefix + "duck";
  else if (p.anim === "walk") key = prefix + (p.animFrame ? "walk_b" : "walk_a");
  else key = prefix + "idle";
  return IMAGES[key];
}

function drawPlayer(p) {
  if (p.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0) return; // parpadeo al reaparecer
  const img = playerSprite(p);
  const sx = p.x - game.cameraX;
  const drawSize = 64;
  const dx = sx + p.w / 2 - drawSize / 2;
  const dy = p.y + p.h - drawSize;
  if (!img || !img.width) {
    ctx.fillStyle = p.color === "green" ? "#55b647" : "#e75a9b";
    ctx.fillRect(sx, p.y, p.w, p.h);
    return;
  }
  ctx.save();
  if (p.facing < 0) {
    ctx.translate(dx + drawSize, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, drawSize, drawSize);
  } else {
    ctx.drawImage(img, dx, dy, drawSize, drawSize);
  }
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  const lvl = game.level;
  if (!lvl) return;
  drawBackground(lvl);
  drawTiles(lvl);
  drawPlatforms(lvl);
  drawSaws(lvl);
  drawEnemies(lvl);
  // dibuja primero al jugador que está más atrás en profundidad (arriba en pantalla)
  if (player1.y < player2.y) { drawPlayer(player2); drawPlayer(player1); }
  else { drawPlayer(player1); drawPlayer(player2); }
}

// ---------------------------------------------------------------------
// 13) HUD
// ---------------------------------------------------------------------
function updateHud() {
  document.getElementById("p1Time").textContent = (player1.finished ? player1.time : game.levelTime).toFixed(1) + "s";
  document.getElementById("p2Time").textContent = (player2.finished ? player2.time : game.levelTime).toFixed(1) + "s";
  document.getElementById("hudCoins").textContent = "🪙 " + game.coinsCollected;
}

// ---------------------------------------------------------------------
// 14) BUCLE PRINCIPAL
// ---------------------------------------------------------------------
game.levelTime = 0;

function tick(now) {
  requestAnimationFrame(tick);
  if (!game.lastTime) game.lastTime = now;
  let dt = (now - game.lastTime) / 1000;
  dt = Math.min(dt, 0.033);
  game.lastTime = now;

  if (game.state === "PLAYING") {
    game.levelTime += dt;
    const lvl = game.level;
    stepOscillators(lvl, dt);
    updateEnemies(lvl, dt);
    updatePlayer(player1, player2, dt, lvl);
    updatePlayer(player2, player1, dt, lvl);
    resolvePlayerVsPlayer(player1, player2, dt);
    updateCamera(lvl, dt);
    updateHud();
  }
  render();
}
requestAnimationFrame(tick);

// ---------------------------------------------------------------------
// 15) MÁQUINA DE ESTADOS / MENÚS
// ---------------------------------------------------------------------
function showOnly(id) {
  ["screenStart", "screenLevelIntro", "screenPause", "screenFinal"].forEach(s => {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  });
}

function goToLevelIntro(index) {
  loadLevel(index);
  const lvl = game.level;
  document.getElementById("introLevelNum").textContent = "Nivel " + lvl.id + " de " + LEVELS.length;
  document.getElementById("introLevelName").textContent = lvl.name;
  document.getElementById("introLevelTip").textContent = lvl.tip;
  showOnly("screenLevelIntro");
  document.getElementById("hud").classList.add("hidden");
  game.state = "LEVEL_INTRO";
}

function startPlaying() {
  showOnly(null);
  document.getElementById("hud").classList.remove("hidden");
  game.levelTime = 0;
  game.state = "PLAYING";
}

function finishLevelAndAdvance() {
  const p1w = player1.finished, p2w = player2.finished;
  let winnerId = null;
  if (p1w && p2w) winnerId = player1.time <= player2.time ? "p1" : "p2";
  else if (p1w) winnerId = "p1";
  else if (p2w) winnerId = "p2";

  if (winnerId === "p1") game.wins.p1++;
  else if (winnerId === "p2") game.wins.p2++;

  game.levelResults.push({
    levelId: game.level.id,
    winner: winnerId,
    t1: p1w ? player1.time : null,
    t2: p2w ? player2.time : null,
  });

  document.getElementById("finishBanner").classList.add("hidden");

  if (game.levelIndex + 1 < LEVELS.length) {
    goToLevelIntro(game.levelIndex + 1);
  } else {
    showFinalResults();
  }
}

function showFinalResults() {
  document.getElementById("hud").classList.add("hidden");
  const box = document.getElementById("finalResults");
  box.innerHTML = "";
  game.levelResults.forEach(r => {
    const row = document.createElement("div");
    row.className = "row";
    const who = r.winner === "p1" ? "🟢 Verde" : (r.winner === "p2" ? "🟣 Rosa" : "— nadie llegó —");
    row.innerHTML = `<span>Nivel ${r.levelId}</span><span>${who}</span>`;
    box.appendChild(row);
  });
  const totalRow = document.createElement("div");
  totalRow.className = "row win";
  totalRow.innerHTML = `<span>Total</span><span>🟢 ${game.wins.p1} — ${game.wins.p2} 🟣</span>`;
  box.appendChild(totalRow);

  const title = document.getElementById("finalTitle");
  if (game.wins.p1 === game.wins.p2) title.textContent = "🤝 ¡Empate!";
  else title.textContent = game.wins.p1 > game.wins.p2 ? "🏆 ¡Gana el Jugador Verde!" : "🏆 ¡Gana el Jugador Rosa!";

  showOnly("screenFinal");
  game.state = "FINAL";
}

function restartLevel() {
  goToLevelIntro(game.levelIndex);
}

function handleGlobalKey(code) {
  if (code === "Enter") {
    if (game.state === "MENU") { goToLevelIntro(0); }
    else if (game.state === "LEVEL_INTRO") { startPlaying(); }
    else if (game.state === "PLAYING" && game.bannerShown) { finishLevelAndAdvance(); }
  }
  if (code === "KeyP" && game.state === "PLAYING") togglePause();
  else if (code === "KeyP" && game.state === "PAUSED") togglePause();
  if (code === "KeyF") toggleFullscreen();
  if (code === "KeyR" && (game.state === "PLAYING" || game.state === "PAUSED")) {
    showOnly(null);
    document.getElementById("hud").classList.remove("hidden");
    restartLevel();
    // restartLevel envía a LEVEL_INTRO; si querían saltarla directo, podrían llamar startPlaying()
  }
}

function togglePause() {
  if (game.state === "PLAYING") {
    game.state = "PAUSED";
    showOnly("screenPause");
  } else if (game.state === "PAUSED") {
    showOnly(null);
    game.state = "PLAYING";
  }
}

// ---------------------------------------------------------------------
// 16) PANTALLA COMPLETA
// ---------------------------------------------------------------------
function toggleFullscreen() {
  const stage = document.getElementById("stage");
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFs) {
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req) req.call(stage).catch(() => {});
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
  }
}
function updateFullscreenButtons() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  ["btnFullscreen"].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = isFs ? "⤢" : "⛶";
    btn.title = isFs ? "Salir de pantalla completa (F)" : "Pantalla completa (F)";
  });
}
document.addEventListener("fullscreenchange", updateFullscreenButtons);
document.addEventListener("webkitfullscreenchange", updateFullscreenButtons);

// ---------------------------------------------------------------------
// 17) BOTONES
// ---------------------------------------------------------------------
document.getElementById("btnStart").addEventListener("click", () => { toggleFullscreen(); goToLevelIntro(0); });
document.getElementById("btnFullscreenStart").addEventListener("click", toggleFullscreen);
document.getElementById("btnFullscreen").addEventListener("click", toggleFullscreen);
document.getElementById("btnLevelGo").addEventListener("click", startPlaying);
document.getElementById("btnPause").addEventListener("click", togglePause);
document.getElementById("btnResume").addEventListener("click", togglePause);
document.getElementById("btnRestartLevel").addEventListener("click", () => { showOnly(null); restartLevel(); });
document.getElementById("btnMainMenu").addEventListener("click", () => {
  showOnly("screenStart");
  document.getElementById("hud").classList.add("hidden");
  game.state = "MENU";
});
document.getElementById("btnContinue").addEventListener("click", finishLevelAndAdvance);
document.getElementById("btnPlayAgain").addEventListener("click", () => {
  game.wins = { p1: 0, p2: 0 };
  game.levelResults = [];
  showOnly("screenStart");
  game.state = "MENU";
});

// ---------------------------------------------------------------------
// 18) ARRANQUE
// ---------------------------------------------------------------------
loadImages(ASSET_MANIFEST).then(() => {
  showOnly("screenStart");
});