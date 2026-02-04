/* n.js — ES5-safe single-file dungeon shooter
   Requested updates:
   - Center game in middle of window when room < viewport
   - Scale up everything (larger tiles / sprites)
   - More detailed avatar
   - More weapons
   - Boss every 10 rooms (using Manhattan depth), boss has random weapon pattern
*/

(function () {
  "use strict";

  // Entry point expected by launcher
  window.create = function () { Game.create(); };

  // ---------- Constants ----------
  var TAU = Math.PI * 2;

  // SCALE UP WORLD
  var TILE = 40;            // was 24
  var ROOM_TW = 21;
  var ROOM_TH = 13;
  var ROOM_W = ROOM_TW * TILE;   // 840
  var ROOM_H = ROOM_TH * TILE;   // 520

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    A: 65, W: 87, D: 68, S: 83,
    SPACE: 32, SHIFT: 16, ESC: 27,
    F: 70, Q: 81, E: 69,
    R: 82, ONE: 49, TWO: 50, THREE: 51, FOUR: 52,
    FIVE: 53, SIX: 54, SEVEN: 55
  };

  // Door geometry (scaled with TILE)
  var DOOR_SPAN = 44;
  var DOOR_THICK = 26;

  // ---------- Canvas ----------
  var canvas, ctx;
  var dpr = 1;
  var VIEW_W = 960, VIEW_H = 540;
  var lastT = 0;

  // Room centering offsets (when room smaller than viewport)
  var VIEW_OX = 0;
  var VIEW_OY = 0;

  // ---------- Input ----------
  var keys = {};
  var keysPressed = {};
  var mouse = { x: 0, y: 0, down: false };

  function onKeyDown(e) {
    if (!keys[e.keyCode]) keysPressed[e.keyCode] = true;
    keys[e.keyCode] = true;
    if (e.keyCode === KEY.SPACE || e.keyCode === KEY.UP || e.keyCode === KEY.DOWN) e.preventDefault();
  }
  function onKeyUp(e) { keys[e.keyCode] = false; }
  function onMouseMove(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = (e.clientX - rect.left);
    var cy = (e.clientY - rect.top);
    mouse.x = (cx / rect.width) * VIEW_W;
    mouse.y = (cy / rect.height) * VIEW_H;
  }
  function onMouseDown() { mouse.down = true; }
  function onMouseUp() { mouse.down = false; }
  function wasPressed(code) { return !!keysPressed[code]; }

  // ---------- RNG / Math ----------
  function randf() { return Math.random(); }
  function randi(n) { return (Math.random() * n) | 0; }
  function chance(p) { return Math.random() < p; }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function norm(x, y) { var l = Math.sqrt(x * x + y * y) || 1; return { x: x / l, y: y / l }; }

  // ---------- Room helpers ----------
  function roomKey(x, y) { return x + "," + y; }
  function tileIndex(tx, ty) { return ty * ROOM_TW + tx; }
  function parseRoom(id) {
    var s = id.split(",");
    return { x: parseInt(s[0], 10), y: parseInt(s[1], 10) };
  }

  // ---------- Game state ----------
  var state = {
    running: false,
    paused: false,
    shopOpen: false,
    msg: "",
    msgT: 0,
    coins: 0,
    roomId: "0,0",
    cam: { x: 0, y: 0, shake: 0, shakeT: 0 },
    map: {},
    rooms: {},
    enemies: [],
    bullets: [],
    pickups: [],
    fx: []
  };

  // ---------- Weapons (more of them) ----------
  // fire = seconds between shots; pellets & spread define pattern
  var WEAPONS = [
    { id: 0, name: "Pistol",  unlocked: true,  dmg: 3, fire: 0.18, speed: 520, spread: 0.00, pellets: 1 },
    { id: 1, name: "Shotgun", unlocked: false, dmg: 2, fire: 0.55, speed: 460, spread: 0.40, pellets: 6 },
    { id: 2, name: "Rifle",   unlocked: false, dmg: 4, fire: 0.12, speed: 620, spread: 0.02, pellets: 1 },
    { id: 3, name: "SMG",     unlocked: false, dmg: 2, fire: 0.07, speed: 560, spread: 0.08, pellets: 1 },
    { id: 4, name: "Sniper",  unlocked: false, dmg: 10,fire: 0.65, speed: 860, spread: 0.00, pellets: 1 },
    { id: 5, name: "Burst",   unlocked: false, dmg: 3, fire: 0.22, speed: 640, spread: 0.03, pellets: 3, burstStep: 0.03 },
    { id: 6, name: "Laser",   unlocked: false, dmg: 5, fire: 0.30, speed: 900, spread: 0.00, pellets: 1 }
  ];

  // Shop items expanded to include more weapons
  var SHOP_ITEMS = [
    { key: 1, label: "Unlock Shotgun", cost: 10, type: "unlock", weaponId: 1, desc: "Cone crowd control" },
    { key: 2, label: "Unlock Rifle",   cost: 16, type: "unlock", weaponId: 2, desc: "Fast & accurate" },
    { key: 3, label: "Unlock SMG",     cost: 18, type: "unlock", weaponId: 3, desc: "Spray & pray" },
    { key: 4, label: "Unlock Sniper",  cost: 22, type: "unlock", weaponId: 4, desc: "Huge damage" },
    { key: 5, label: "Unlock Burst",   cost: 20, type: "unlock", weaponId: 5, desc: "3-round burst" },
    { key: 6, label: "Unlock Laser",   cost: 26, type: "unlock", weaponId: 6, desc: "Hyper-fast bolt" },
    { key: 7, label: "Heal +3",        cost: 6,  type: "heal",   amount: 3,    desc: "Patch up" }
  ];

  // ---------- Player (scaled up) ----------
  var player = {
    x: ROOM_W / 2,
    y: ROOM_H / 2,
    r: 13,
    hp: 8,
    hpMax: 8,
    invT: 0,
    dashT: 0,
    dashCD: 0,
    vx: 0, vy: 0,
    speed: 190,
    weapon: 0,
    fireCD: 0,
    burstQ: 0,      // remaining burst bullets
    burstCD: 0      // time until next burst bullet
  };

  // ---------- Room Node / Room Data ----------
  function ensureNode(id) {
    if (!state.map[id]) {
      var p = parseRoom(id);
      state.map[id] = {
        id: id,
        x: p.x, y: p.y,
        depth: Math.abs(p.x) + Math.abs(p.y),
        kind: "combat",   // combat | shop | start
        seen: false,
        cleared: false,
        flags: {}
      };
    }
    return state.map[id];
  }

  function ensureRoom(id) {
    if (!state.rooms[id]) {
      state.rooms[id] = {
        id: id,
        g: null,
        doorsOpen: { N: true, S: true, W: true, E: true },
        neighbors: { N: false, S: false, W: false, E: false }
      };
    }
    return state.rooms[id];
  }

  // ---------- Special rooms (shop per ring) ----------
  function isShopCoord(x, y) {
    var d = Math.abs(x) + Math.abs(y);
    if (d < 1) return false;
    var m = d % 4;
    if (m === 0) return (x === d && y === 0);
    if (m === 1) return (x === 0 && y === d);
    if (m === 2) return (x === -d && y === 0);
    return (x === 0 && y === -d);
  }

  function assignRoomKind(node) {
    if (node.id === "0,0") return "start";
    if (isShopCoord(node.x, node.y)) return "shop";
    return "combat";
  }

  // ---------- Boss logic ----------
  // Boss every 10 "rooms" => we use Manhattan depth multiple of 10 (10, 20, 30...)
  function shouldSpawnBoss(node) {
    if (node.kind !== "combat") return false;
    if (node.depth <= 0) return false;
    if ((node.depth % 10) !== 0) return false;
    return true;
  }

  // Boss weapon patterns (random each boss)
  var BOSS_PATTERNS = [
    { id: 0, name: "Boss Shotcone" }, // shotgun cone bursts
    { id: 1, name: "Boss Burst" },    // rifle burst lines
    { id: 2, name: "Boss Spiral" },   // rotating spiral
    { id: 3, name: "Boss LaserSweep"} // aimed fast bolts + sweep
  ];

  // ---------- Tile generation ----------
  // 0 wall, 1 floor, 2 pit, 3 door marker, 4 pillar, 5 decor
  function genRoomTiles(node) {
    var room = ensureRoom(node.id);
    var g = new Array(ROOM_TW * ROOM_TH);
    var x, y;

    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var edge = (x === 0 || y === 0 || x === ROOM_TW - 1 || y === ROOM_TH - 1);
        g[tileIndex(x, y)] = edge ? 0 : 1;
      }
    }

    // pits only in combat
    if (node.kind === "combat") {
      for (var i = 0; i < 18; i++) {
        var px = 2 + randi(ROOM_TW - 4);
        var py = 2 + randi(ROOM_TH - 4);
        if (chance(0.22)) g[tileIndex(px, py)] = 2;
      }
    } else {
      for (var d = 0; d < 16; d++) {
        var sx = 2 + randi(ROOM_TW - 4);
        var sy = 2 + randi(ROOM_TH - 4);
        if (chance(0.35)) g[tileIndex(sx, sy)] = 5;
      }
    }

    // pillars
    var density = (node.kind === "combat") ? 0.045 : 0.020;
    for (y = 2; y < ROOM_TH - 2; y++) {
      for (x = 2; x < ROOM_TW - 2; x++) {
        if (g[tileIndex(x, y)] !== 1) continue;
        if (chance(density)) g[tileIndex(x, y)] = 4;
      }
    }

    // clear center spawn
    var cx = (ROOM_TW / 2) | 0;
    var cy = (ROOM_TH / 2) | 0;
    for (y = cy - 1; y <= cy + 1; y++) {
      for (x = cx - 1; x <= cx + 1; x++) {
        g[tileIndex(x, y)] = 1;
      }
    }

    // doors
    function carveDoor(dir) {
      var mx = (ROOM_TW / 2) | 0;
      var my = (ROOM_TH / 2) | 0;
      if (dir === "N") { g[tileIndex(mx, 0)] = 1; g[tileIndex(mx, 1)] = 3; }
      else if (dir === "S") { g[tileIndex(mx, ROOM_TH - 1)] = 1; g[tileIndex(mx, ROOM_TH - 2)] = 3; }
      else if (dir === "W") { g[tileIndex(0, my)] = 1; g[tileIndex(1, my)] = 3; }
      else { g[tileIndex(ROOM_TW - 1, my)] = 1; g[tileIndex(ROOM_TW - 2, my)] = 3; }
    }

    if (room.neighbors.N) carveDoor("N");
    if (room.neighbors.S) carveDoor("S");
    if (room.neighbors.W) carveDoor("W");
    if (room.neighbors.E) carveDoor("E");

    room.g = g;
    return room;
  }

  // ---------- Collision ----------
  function isSolidAtPoint(wx, wy, room) {
    var tx = (wx / TILE) | 0;
    var ty = (wy / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) return true;

    var t = room.g[tileIndex(tx, ty)];
    if (t === 0 || t === 2) return true;

    if (t === 4) {
      var cx = tx * TILE + TILE * 0.5;
      var cy = ty * TILE + TILE * 0.5;
      var dx = wx - cx, dy = wy - cy;
      var rad = TILE * 0.30;
      return (dx * dx + dy * dy) <= rad * rad;
    }

    return false;
  }

  function collideCircle(x, y, r, room) {
    var samples = 14;
    for (var i = 0; i < samples; i++) {
      var a = (i / samples) * TAU;
      var px = x + Math.cos(a) * r;
      var py = y + Math.sin(a) * r;
      if (isSolidAtPoint(px, py, room)) return true;
    }
    return false;
  }

  // ---------- Neighbors ----------
  var MAX_DEPTH = 40;

  function buildNeighborsAround(id) {
    var node = ensureNode(id);
    var room = ensureRoom(id);

    var x = node.x, y = node.y;

    function link(nx, ny, dirA, dirB) {
      if (Math.abs(nx) + Math.abs(ny) > MAX_DEPTH) return;
      room.neighbors[dirA] = true;
      var nid = roomKey(nx, ny);
      ensureNode(nid);
      var r2 = ensureRoom(nid);
      r2.neighbors[dirB] = true;
    }

    link(x, y - 1, "N", "S");
    link(x, y + 1, "S", "N");
    link(x - 1, y, "W", "E");
    link(x + 1, y, "E", "W");

    node.kind = assignRoomKind(node);
    genRoomTiles(node);
  }

  function lockDoors(room, locked) {
    room.doorsOpen.N = !locked;
    room.doorsOpen.S = !locked;
    room.doorsOpen.W = !locked;
    room.doorsOpen.E = !locked;
  }

  // ---------- Entities ----------
  function spawnEnemy(type, x, y, depth) {
    var hpBase = (type === "shooter") ? 10 : 9;
    var e = {
      type: type,
      x: x, y: y,
      r: (type === "shooter") ? 18 : 19,
      hp: hpBase + ((depth / 3) | 0),
      vx: 0, vy: 0,
      t: 0,
      fireCD: 0
    };
    state.enemies.push(e);
  }

  function spawnBoss(x, y, depth) {
    var pat = BOSS_PATTERNS[randi(BOSS_PATTERNS.length)];
    var e = {
      type: "boss",
      x: x, y: y,
      r: 30,
      hp: 140 + depth * 6,
      vx: 0, vy: 0,
      t: 0,
      fireCD: 0,
      phase: 0,
      patternId: pat.id,
      patternName: pat.name,
      spinA: randf() * TAU
    };
    state.enemies.push(e);

    state.msg = "BOSS: " + pat.name;
    state.msgT = 1.2;
    shake(10, 0.22);
  }

  function spawnBullet(x, y, vx, vy, dmg, from, kind, life) {
    state.bullets.push({
      x: x, y: y,
      vx: vx, vy: vy,
      r: (from === "player") ? 4 : 5,
      t: (life != null) ? life : ((from === "player") ? 1.2 : 1.8),
      dmg: dmg,
      from: from,
      kind: kind
    });
  }

  function shake(amount, time) {
    state.cam.shake = Math.max(state.cam.shake, amount);
    state.cam.shakeT = Math.max(state.cam.shakeT, time);
  }

  // ---------- Coins / pickups ----------
  function dropCoins(x, y, amount) {
    for (var i = 0; i < amount; i++) {
      var a = randf() * TAU;
      var r = 18 + randf() * 22;
      state.pickups.push({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        t: "coin",
        v: 1,
        r: 9
      });
    }
  }

  // ---------- Doors (bugfix: intent-based transition) ----------
  function inDoorBand(dir, x, y) {
    var cx = ROOM_W * 0.5;
    var cy = ROOM_H * 0.5;

    if (dir === "N") return (Math.abs(x - cx) <= DOOR_SPAN) && (y <= DOOR_THICK);
    if (dir === "S") return (Math.abs(x - cx) <= DOOR_SPAN) && (y >= ROOM_H - DOOR_THICK);
    if (dir === "W") return (Math.abs(y - cy) <= DOOR_SPAN) && (x <= DOOR_THICK);
    return (Math.abs(y - cy) <= DOOR_SPAN) && (x >= ROOM_W - DOOR_THICK);
  }

  function tryDoorTransitionByIntent(dir) {
    var node = ensureNode(state.roomId);
    var room = ensureRoom(state.roomId);

    if (!room.neighbors[dir]) return false;
    if (!room.doorsOpen[dir]) {
      if (inDoorBand(dir, player.x, player.y)) {
        state.msg = "DOOR LOCKED";
        state.msgT = 0.7;
      }
      return false;
    }

    var dx = 0, dy = 0;
    if (dir === "N") dy = -1;
    else if (dir === "S") dy = 1;
    else if (dir === "W") dx = -1;
    else dx = 1;

    var nid = roomKey(node.x + dx, node.y + dy);
    ensureNode(nid);
    ensureRoom(nid);

    state.roomId = nid;
    loadRoom(state.roomId);

    if (dir === "N") { player.y = ROOM_H - 24; player.x = clamp(player.x, 24, ROOM_W - 24); }
    if (dir === "S") { player.y = 24; player.x = clamp(player.x, 24, ROOM_W - 24); }
    if (dir === "W") { player.x = ROOM_W - 24; player.y = clamp(player.y, 24, ROOM_H - 24); }
    if (dir === "E") { player.x = 24; player.y = clamp(player.y, 24, ROOM_H - 24); }

    snapCameraToPlayer();
    return true;
  }

  // ---------- Room content ----------
  function spawnRoomContents(roomId) {
    var node = ensureNode(roomId);
    var room = ensureRoom(roomId);

    node.kind = assignRoomKind(node);

    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;

    if (node.kind === "start" || node.kind === "shop") {
      node.cleared = true;
      lockDoors(room, false);
      if (node.kind === "start") state.pickups.push({ x: ROOM_W / 2 + 60, y: ROOM_H / 2, t: "coin", v: 6, r: 10 });
      return;
    }

    if (!node.cleared) {
      // Boss at depth multiple of 10
      if (shouldSpawnBoss(node)) {
        spawnBoss(ROOM_W * 0.5, ROOM_H * 0.5, node.depth);
      } else {
        var n = 4 + randi(4) + ((node.depth / 4) | 0);
        for (var i = 0; i < n; i++) {
          var px = 80 + randf() * (ROOM_W - 160);
          var py = 80 + randf() * (ROOM_H - 160);
          spawnEnemy(chance(0.30) ? "shooter" : "chaser", px, py, node.depth);
        }
      }
      lockDoors(room, true);
    } else {
      lockDoors(room, false);
    }
  }

  function loadRoom(roomId) {
    var node = ensureNode(roomId);
    node.kind = assignRoomKind(node);

    buildNeighborsAround(roomId);
    genRoomTiles(node);

    spawnRoomContents(roomId);
    ensureNode(roomId).seen = true;
    state.shopOpen = false;

    // If room smaller than viewport, keep camera at 0 and center via offsets
    snapCameraToPlayer();
  }

  // ---------- Shop ----------
  function nearShopCounter() {
    var cx = ROOM_W * 0.5;
    var cy = TILE * 2.7;
    return dist2(player.x, player.y, cx, cy) < (60 * 60);
  }

  function tryOpenShop() {
    var node = ensureNode(state.roomId);
    if (node.kind !== "shop") return;
    if (!nearShopCounter()) {
      state.msg = "STEP TO COUNTER";
      state.msgT = 0.8;
      return;
    }
    state.shopOpen = !state.shopOpen;
  }

  function buyShopItem(item) {
    if (state.coins < item.cost) {
      state.msg = "NOT ENOUGH COINS";
      state.msgT = 0.8;
      shake(2, 0.08);
      return;
    }
    if (item.type === "unlock") {
      var w = WEAPONS[item.weaponId];
      if (w.unlocked) { state.msg = "ALREADY OWNED"; state.msgT = 0.7; return; }
      w.unlocked = true;
      state.coins -= item.cost;
      state.msg = "UNLOCKED: " + w.name;
      state.msgT = 1.0;
      return;
    }
    if (item.type === "heal") {
      if (player.hp >= player.hpMax) { state.msg = "HP FULL"; state.msgT = 0.7; return; }
      state.coins -= item.cost;
      player.hp = clamp(player.hp + item.amount, 0, player.hpMax);
      state.msg = "HEALED";
      state.msgT = 0.9;
    }
  }

  // ---------- Combat ----------
  function shoot() {
    if (player.fireCD > 0) return;

    var w = WEAPONS[player.weapon];
    if (!w.unlocked) return;

    var wx = state.cam.x + (mouse.x - VIEW_OX);
    var wy = state.cam.y + (mouse.y - VIEW_OY);
    var n = norm(wx - player.x, wy - player.y);
    var baseA = Math.atan2(n.y, n.x);

    // Burst weapon: schedule multiple shots in quick succession
    if (w.id === 5) {
      player.burstQ = w.pellets;
      player.burstCD = 0;
      player.fireCD = w.fire;
      return;
    }

    // Laser: faster, slightly longer life
    if (w.id === 6) {
      var spL = w.speed;
      spawnBullet(player.x, player.y, Math.cos(baseA) * spL, Math.sin(baseA) * spL, w.dmg, "player", "pl", 0.9);
      player.fireCD = w.fire;
      shake(3, 0.07);
      return;
    }

    for (var i = 0; i < w.pellets; i++) {
      var a = baseA + (w.spread * (randf() - 0.5));
      var sp = w.speed * (0.92 + randf() * 0.16);
      spawnBullet(player.x, player.y, Math.cos(a) * sp, Math.sin(a) * sp, w.dmg, "player", "p", 1.1);
    }

    player.fireCD = w.fire;
    shake(2 + (w.pellets > 1 ? 2 : 0), 0.08);
  }

  function updateBurst(dt) {
    if (player.burstQ <= 0) return;
    player.burstCD -= dt;
    if (player.burstCD > 0) return;

    var w = WEAPONS[5]; // Burst
    var wx = state.cam.x + (mouse.x - VIEW_OX);
    var wy = state.cam.y + (mouse.y - VIEW_OY);
    var n = norm(wx - player.x, wy - player.y);
    var baseA = Math.atan2(n.y, n.x);

    var a = baseA + (w.spread * (randf() - 0.5));
    spawnBullet(player.x, player.y, Math.cos(a) * w.speed, Math.sin(a) * w.speed, w.dmg, "player", "pb", 1.0);

    player.burstQ -= 1;
    player.burstCD = w.burstStep;
    shake(1.5, 0.04);
  }

  function hurtPlayer(dmg) {
    if (player.invT > 0) return;
    player.hp -= dmg;
    player.invT = 0.7;
    shake(9, 0.18);
    if (player.hp <= 0) {
      player.hp = 0;
      state.msg = "YOU DIED — PRESS R";
      state.msgT = 999;
      state.paused = true;
    }
  }

  // ---------- Boss attacks ----------
  function bossAttack(boss, dt) {
    boss.fireCD -= dt;
    if (boss.fireCD > 0) return;

    var dx = player.x - boss.x;
    var dy = player.y - boss.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var aToP = Math.atan2(dy, dx);

    // scale difficulty by depth
    var depth = ensureNode(state.roomId).depth;
    var spBase = 260 + depth * 3;

    if (boss.patternId === 0) {
      // Shotcone: 9 pellets cone
      for (var i = 0; i < 9; i++) {
        var a = aToP + (0.75 * (i / 8 - 0.5));
        spawnBullet(boss.x, boss.y, Math.cos(a) * spBase, Math.sin(a) * spBase, 1, "enemy", "be", 2.2);
      }
      boss.fireCD = 0.95;
    } else if (boss.patternId === 1) {
      // Burst lines: 3 bursts
      for (var j = 0; j < 3; j++) {
        var aj = aToP + (0.10 * (randf() - 0.5));
        spawnBullet(boss.x, boss.y, Math.cos(aj) * (spBase + 120), Math.sin(aj) * (spBase + 120), 1, "enemy", "be", 2.0);
      }
      boss.fireCD = 0.45;
    } else if (boss.patternId === 2) {
      // Spiral
      boss.spinA += 0.55;
      for (var k = 0; k < 6; k++) {
        var ak = boss.spinA + (k * (TAU / 6));
        spawnBullet(boss.x, boss.y, Math.cos(ak) * (spBase + 60), Math.sin(ak) * (spBase + 60), 1, "enemy", "be", 2.4);
      }
      boss.fireCD = 0.70;
    } else {
      // Laser sweep: fast aimed bolts + slight sweep
      var sweep = (boss.phase % 7) - 3; // -3..+3
      var al = aToP + sweep * 0.08;
      spawnBullet(boss.x, boss.y, Math.cos(al) * (spBase + 300), Math.sin(al) * (spBase + 300), 2, "enemy", "beL", 1.2);
      boss.phase += 1;
      boss.fireCD = 0.18;
    }

    shake(6, 0.10);
  }

  // ---------- Updates ----------
  function update(dt) {
    if (state.paused) {
      if (wasPressed(KEY.ESC)) state.paused = false;
      if (wasPressed(KEY.R)) resetGame();
      return;
    }

    if (wasPressed(KEY.ESC)) {
      if (state.shopOpen) state.shopOpen = false;
      else state.paused = true;
    }
    if (wasPressed(KEY.R)) resetGame();

    if (state.msgT > 0) state.msgT -= dt;
    if (player.invT > 0) player.invT -= dt;
    if (player.fireCD > 0) player.fireCD -= dt;
    if (player.dashT > 0) player.dashT -= dt;
    if (player.dashCD > 0) player.dashCD -= dt;
    if (player.burstCD > 0) player.burstCD -= dt;

    if (state.cam.shakeT > 0) {
      state.cam.shakeT -= dt;
      state.cam.shake = lerp(state.cam.shake, 0, 10 * dt);
    } else state.cam.shake = 0;

    var node = ensureNode(state.roomId);

    // Interactions
    if (wasPressed(KEY.F) && node.kind === "shop") tryOpenShop();

    // Shop buy keys (1..7)
    if (node.kind === "shop" && state.shopOpen) {
      if (wasPressed(KEY.ONE)) buyShopItem(SHOP_ITEMS[0]);
      if (wasPressed(KEY.TWO)) buyShopItem(SHOP_ITEMS[1]);
      if (wasPressed(KEY.THREE)) buyShopItem(SHOP_ITEMS[2]);
      if (wasPressed(KEY.FOUR)) buyShopItem(SHOP_ITEMS[3]);
      if (wasPressed(KEY.FIVE)) buyShopItem(SHOP_ITEMS[4]);
      if (wasPressed(KEY.SIX)) buyShopItem(SHOP_ITEMS[5]);
      if (wasPressed(KEY.SEVEN)) buyShopItem(SHOP_ITEMS[6]);
      updateParticles(dt);
      return;
    }

    // Weapon cycling Q/E
    if (wasPressed(KEY.Q)) cycleWeapon(-1);
    if (wasPressed(KEY.E)) cycleWeapon(1);

    // Dash
    if ((wasPressed(KEY.SPACE) || wasPressed(KEY.SHIFT)) && player.dashCD <= 0) {
      var mx = 0, my = 0;
      if (keys[KEY.A] || keys[KEY.LEFT]) mx -= 1;
      if (keys[KEY.D] || keys[KEY.RIGHT]) mx += 1;
      if (keys[KEY.W] || keys[KEY.UP]) my -= 1;
      if (keys[KEY.S] || keys[KEY.DOWN]) my += 1;

      if (mx === 0 && my === 0) {
        var awx = state.cam.x + (mouse.x - VIEW_OX);
        var awy = state.cam.y + (mouse.y - VIEW_OY);
        var dn = norm(awx - player.x, awy - player.y);
        mx = dn.x; my = dn.y;
      } else {
        var dn2 = norm(mx, my);
        mx = dn2.x; my = dn2.y;
      }

      player.dashT = 0.14;
      player.dashCD = 0.80;
      player.vx = mx * 820;
      player.vy = my * 820;
      shake(5, 0.10);
    }

    // Movement
    var ax = 0, ay = 0;
    if (player.dashT <= 0) {
      if (keys[KEY.A] || keys[KEY.LEFT]) ax -= 1;
      if (keys[KEY.D] || keys[KEY.RIGHT]) ax += 1;
      if (keys[KEY.W] || keys[KEY.UP]) ay -= 1;
      if (keys[KEY.S] || keys[KEY.DOWN]) ay += 1;

      var sp = player.speed;
      if (ax !== 0 || ay !== 0) {
        var nn = norm(ax, ay);
        player.vx = nn.x * sp;
        player.vy = nn.y * sp;
      } else {
        player.vx = lerp(player.vx, 0, 10 * dt);
        player.vy = lerp(player.vy, 0, 10 * dt);
      }
    } else {
      player.vx = lerp(player.vx, 0, 5 * dt);
      player.vy = lerp(player.vy, 0, 5 * dt);
    }

    // Shooting
    if (mouse.down) shoot();
    updateBurst(dt);

    // Move + door transitions
    var room = ensureRoom(state.roomId);

    var nxp = player.x + player.vx * dt;
    var nyp = player.y + player.vy * dt;

    if (player.vy < 0 && inDoorBand("N", player.x, player.y) && (nyp <= 2)) { if (tryDoorTransitionByIntent("N")) return; }
    if (player.vy > 0 && inDoorBand("S", player.x, player.y) && (nyp >= ROOM_H - 2)) { if (tryDoorTransitionByIntent("S")) return; }
    if (player.vx < 0 && inDoorBand("W", player.x, player.y) && (nxp <= 2)) { if (tryDoorTransitionByIntent("W")) return; }
    if (player.vx > 0 && inDoorBand("E", player.x, player.y) && (nxp >= ROOM_W - 2)) { if (tryDoorTransitionByIntent("E")) return; }

    if (!collideCircle(nxp, player.y, player.r, room)) player.x = nxp; else player.vx = 0;
    if (!collideCircle(player.x, nyp, player.r, room)) player.y = nyp; else player.vy = 0;

    // Camera follow
    updateCamera(dt);

    // Sim
    updateEnemies(dt);
    updateBullets(dt);
    updatePickups(dt);
    updateParticles(dt);

    // Clear check
    if (!node.cleared && node.kind === "combat") {
      if (state.enemies.length === 0) {
        node.cleared = true;
        lockDoors(room, false);
        state.msg = "CLEARED";
        state.msgT = 0.9;
        // rewards
        state.pickups.push({ x: ROOM_W / 2, y: ROOM_H / 2, t: "coin", v: 6, r: 10 });
      }
    }
  }

  function cycleWeapon(dir) {
    var start = player.weapon;
    var i = start;
    var count = 0;
    while (count < WEAPONS.length) {
      i = (i + dir + WEAPONS.length) % WEAPONS.length;
      if (WEAPONS[i].unlocked) { player.weapon = i; break; }
      count++;
    }
  }

  function updateCamera(dt) {
    // Camera target based on player; clamp only when room larger than viewport
    var maxX = Math.max(0, ROOM_W - VIEW_W);
    var maxY = Math.max(0, ROOM_H - VIEW_H);

    var tx = clamp(player.x - VIEW_W / 2, 0, maxX);
    var ty = clamp(player.y - VIEW_H / 2, 0, maxY);

    state.cam.x = lerp(state.cam.x, tx, 10 * dt);
    state.cam.y = lerp(state.cam.y, ty, 10 * dt);

    // Centering offsets when room smaller than viewport
    VIEW_OX = (ROOM_W < VIEW_W) ? ((VIEW_W - ROOM_W) * 0.5) : 0;
    VIEW_OY = (ROOM_H < VIEW_H) ? ((VIEW_H - ROOM_H) * 0.5) : 0;
  }

  function snapCameraToPlayer() {
    var maxX = Math.max(0, ROOM_W - VIEW_W);
    var maxY = Math.max(0, ROOM_H - VIEW_H);

    state.cam.x = clamp(player.x - VIEW_W / 2, 0, maxX);
    state.cam.y = clamp(player.y - VIEW_H / 2, 0, maxY);

    VIEW_OX = (ROOM_W < VIEW_W) ? ((VIEW_W - ROOM_W) * 0.5) : 0;
    VIEW_OY = (ROOM_H < VIEW_H) ? ((VIEW_H - ROOM_H) * 0.5) : 0;
  }

  function updateEnemies(dt) {
    var room = ensureRoom(state.roomId);
    var node = ensureNode(state.roomId);
    var depth = node.depth;

    for (var i = state.enemies.length - 1; i >= 0; i--) {
      var e = state.enemies[i];
      e.t += dt;

      if (e.type === "boss") {
        // Boss movement: drift and re-center
        var dxB = (ROOM_W * 0.5) - e.x;
        var dyB = (ROOM_H * 0.5) - e.y;
        e.vx = lerp(e.vx, dxB * 0.25, 1.8 * dt);
        e.vy = lerp(e.vy, dyB * 0.25, 1.8 * dt);

        // avoid sticking
        var nx = e.x + e.vx * dt;
        var ny = e.y + e.vy * dt;
        if (!collideCircle(nx, e.y, e.r, room)) e.x = nx;
        if (!collideCircle(e.x, ny, e.r, room)) e.y = ny;

        bossAttack(e, dt);

        // contact damage
        if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) hurtPlayer(2);

        if (e.hp <= 0) {
          // boss reward: lots of coins + weapon unlock chance
          dropCoins(e.x, e.y, 30);
          if (chance(0.80)) unlockRandomWeapon();
          state.enemies.splice(i, 1);
          shake(14, 0.25);
          state.msg = "BOSS DOWN!";
          state.msgT = 1.2;
        }
        continue;
      }

      // normal enemies
      var dx = player.x - e.x;
      var dy = player.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;

      if (e.type === "chaser") {
        var sp = 105 + depth * 2;
        e.vx = (dx / d) * sp;
        e.vy = (dy / d) * sp;
      } else {
        var sp2 = 95 + depth * 1.5;
        var desired = 210;
        if (d < desired) { e.vx = -(dx / d) * sp2; e.vy = -(dy / d) * sp2; }
        else { e.vx = (randf() - 0.5) * 40; e.vy = (randf() - 0.5) * 40; }

        if (e.fireCD > 0) e.fireCD -= dt;
        if (e.fireCD <= 0 && d < 480) {
          var n = norm(dx, dy);
          spawnBullet(e.x, e.y, n.x * (320 + depth * 4), n.y * (320 + depth * 4), 1, "enemy", "e", 2.0);
          e.fireCD = 0.9 + randf() * 0.6;
        }
      }

      var nx2 = e.x + e.vx * dt;
      var ny2 = e.y + e.vy * dt;
      if (!collideCircle(nx2, e.y, e.r, room)) e.x = nx2;
      if (!collideCircle(e.x, ny2, e.r, room)) e.y = ny2;

      if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) hurtPlayer(1);

      if (e.hp <= 0) {
        var coins = 2 + randi(3) + ((depth / 4) | 0);
        dropCoins(e.x, e.y, coins);
        if (chance(0.10)) state.pickups.push({ x: e.x, y: e.y, t: "heart", v: 2, r: 10 });
        state.enemies.splice(i, 1);
      }
    }
  }

  function unlockRandomWeapon() {
    var locked = [];
    for (var i = 0; i < WEAPONS.length; i++) if (!WEAPONS[i].unlocked) locked.push(WEAPONS[i]);
    if (locked.length === 0) return;
    var w = locked[randi(locked.length)];
    w.unlocked = true;
    state.msg = "FOUND: " + w.name;
    state.msgT = 1.1;
  }

  function updateBullets(dt) {
    var room = ensureRoom(state.roomId);

    for (var i = state.bullets.length - 1; i >= 0; i--) {
      var b = state.bullets[i];
      b.t -= dt;

      var nx = b.x + b.vx * dt;
      var ny = b.y + b.vy * dt;

      if (isSolidAtPoint(nx, ny, room)) { state.bullets.splice(i, 1); continue; }

      b.x = nx; b.y = ny;

      if (b.from === "player") {
        for (var e = state.enemies.length - 1; e >= 0; e--) {
          var en = state.enemies[e];
          if (dist2(b.x, b.y, en.x, en.y) < (b.r + en.r) * (b.r + en.r)) {
            en.hp -= b.dmg;
            shake(2, 0.05);
            state.bullets.splice(i, 1);
            break;
          }
        }
      } else {
        if (dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) * (b.r + player.r)) {
          hurtPlayer(b.dmg);
          state.bullets.splice(i, 1);
          continue;
        }
      }

      if (b.t <= 0) state.bullets.splice(i, 1);
    }
  }

  function updatePickups(dt) {
    for (var i = state.pickups.length - 1; i >= 0; i--) {
      var p = state.pickups[i];
      if (dist2(p.x, p.y, player.x, player.y) < (p.r + player.r + 10) * (p.r + player.r + 10)) {
        if (p.t === "coin") { state.coins += p.v; state.msg = "+COIN"; state.msgT = 0.30; }
        else if (p.t === "heart") { player.hp = clamp(player.hp + p.v, 0, player.hpMax); state.msg = "+HP"; state.msgT = 0.45; }
        state.pickups.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (var i = state.fx.length - 1; i >= 0; i--) {
      var p = state.fx[i];
      p.t -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.002, dt);
      p.vy *= Math.pow(0.002, dt);
      if (p.t <= 0) state.fx.splice(i, 1);
    }
  }

  // ---------- Render ----------
  function draw() {
    var room = ensureRoom(state.roomId);
    var node = ensureNode(state.roomId);

    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#07060b";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var sx = 0, sy = 0;
    if (state.cam.shake > 0 && state.cam.shakeT > 0) {
      sx = (randf() - 0.5) * state.cam.shake * 2;
      sy = (randf() - 0.5) * state.cam.shake * 2;
    }

    var camX = state.cam.x + sx;
    var camY = state.cam.y + sy;

    drawRoom(room, node, camX, camY);
    drawEntities(camX, camY);
    drawHUD(node);

    if (node.kind === "shop") drawShopHint();
    if (state.shopOpen) drawShopOverlay();

    if (state.paused) drawPause();
  }

  function drawRoom(room, node, camX, camY) {
    var g = room.g;
    if (!g) return;

    var x, y;
    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var t = g[tileIndex(x, y)];

        var sx = ((x * TILE - camX) + VIEW_OX) | 0;
        var sy = ((y * TILE - camY) + VIEW_OY) | 0;

        if (sx > VIEW_W || sy > VIEW_H || sx + TILE < 0 || sy + TILE < 0) continue;

        if (t === 0) {
          ctx.fillStyle = ((x + y) & 1) ? "rgba(255,255,255,0.070)" : "rgba(255,255,255,0.095)";
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = "rgba(0,0,0,0.24)";
          ctx.fillRect(sx, sy + TILE - 4, TILE, 4);
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(sx, sy, TILE, 3);
        } else if (t === 2) {
          ctx.fillStyle = "rgba(0,0,0,0.62)";
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = "rgba(255,255,255,0.02)";
          ctx.fillRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
        } else {
          ctx.fillStyle = ((x + y) & 1) ? "rgba(255,255,255,0.030)" : "rgba(255,255,255,0.040)";
          ctx.fillRect(sx, sy, TILE, TILE);
        }

        if (t === 3) {
          ctx.fillStyle = "rgba(124,92,255,0.14)";
          ctx.fillRect(sx + 10, sy + 10, TILE - 20, TILE - 20);
        } else if (t === 4) {
          // pillar
          var cx = sx + (TILE >> 1);
          var cy = sy + (TILE >> 1);
          var r = (TILE * 0.30) | 0;

          ctx.fillStyle = "rgba(0,0,0,0.30)";
          ctx.fillRect(cx - r, cy + r, r * 2, r);

          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

          ctx.fillStyle = "rgba(124,92,255,0.20)";
          ctx.fillRect(cx - r + 3, cy - r + 3, r, r);
        } else if (t === 5) {
          ctx.fillStyle = "rgba(124,92,255,0.10)";
          ctx.fillRect(sx + 12, sy + 12, TILE - 24, TILE - 24);
        }
      }
    }

    drawDoorBars(room, camX, camY);

    if (node.kind === "shop") drawShopSet(camX, camY);
    drawVignette();
  }

  function drawDoorBars(room, camX, camY) {
    var mx = ROOM_W * 0.5;
    var my = ROOM_H * 0.5;
    var span = DOOR_SPAN;

    ctx.fillStyle = "rgba(255,80,140,0.24)";
    if (room.neighbors.N && !room.doorsOpen.N) ctx.fillRect(((mx - span - camX) + VIEW_OX) | 0, ((2 - camY) + VIEW_OY) | 0, (span * 2) | 0, 8);
    if (room.neighbors.S && !room.doorsOpen.S) ctx.fillRect(((mx - span - camX) + VIEW_OX) | 0, ((ROOM_H - 10 - camY) + VIEW_OY) | 0, (span * 2) | 0, 8);
    if (room.neighbors.W && !room.doorsOpen.W) ctx.fillRect(((2 - camX) + VIEW_OX) | 0, ((my - span - camY) + VIEW_OY) | 0, 8, (span * 2) | 0);
    if (room.neighbors.E && !room.doorsOpen.E) ctx.fillRect(((ROOM_W - 10 - camX) + VIEW_OX) | 0, ((my - span - camY) + VIEW_OY) | 0, 8, (span * 2) | 0);
  }

  function drawShopSet(camX, camY) {
    var cx = ((ROOM_W * 0.5 - camX) + VIEW_OX) | 0;
    var cy = ((TILE * 2.7 - camY) + VIEW_OY) | 0;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(cx - 130, cy + 22, 260, 14);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(cx - 130, cy + 4, 260, 20);

    ctx.fillStyle = "rgba(124,92,255,0.75)";
    ctx.fillRect(cx - 8, cy - 12, 16, 16);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 3, cy - 8, 6, 3);
  }

  function drawVignette() {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, VIEW_W, 54);
    ctx.fillRect(0, VIEW_H - 54, VIEW_W, 54);
    ctx.fillRect(0, 0, 54, VIEW_H);
    ctx.fillRect(VIEW_W - 54, 0, 54, VIEW_H);
  }

  function drawEntities(camX, camY) {
    // pickups
    for (var i = 0; i < state.pickups.length; i++) {
      var pk = state.pickups[i];
      var px = ((pk.x - camX) + VIEW_OX) | 0;
      var py = ((pk.y - camY) + VIEW_OY) | 0;

      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.fillRect(px - pk.r, py + 10, pk.r * 2, 6);

      if (pk.t === "coin") {
        ctx.fillStyle = "rgba(255,215,90,0.95)";
        ctx.fillRect(px - 8, py - 8, 16, 16);
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.fillRect(px - 3, py - 7, 6, 3);
      } else {
        ctx.fillStyle = "rgba(120,255,170,0.95)";
        ctx.fillRect(px - 8, py - 8, 16, 16);
      }
    }

    // enemies
    for (i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      var ex = ((e.x - camX) + VIEW_OX) | 0;
      var ey = ((e.y - camY) + VIEW_OY) | 0;

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(ex - e.r, ey + e.r, e.r * 2, 8);

      if (e.type === "boss") {
        // boss body
        ctx.fillStyle = "rgba(255,90,170,0.90)";
        ctx.fillRect(ex - e.r, ey - e.r, e.r * 2, e.r * 2);
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(ex - e.r + 4, ey - e.r + 4, e.r, e.r);

        // crown-ish pixels
        ctx.fillStyle = "rgba(255,215,90,0.85)";
        ctx.fillRect(ex - 18, ey - e.r - 10, 36, 10);
        ctx.fillRect(ex - 8, ey - e.r - 18, 16, 8);

        // boss HP bar
        var w = 220;
        var hp = Math.max(0, e.hp);
        var maxhp = 140 + ensureNode(state.roomId).depth * 6;
        var f = hp / maxhp;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect((VIEW_W / 2 - w / 2) | 0, 14, w, 12);
        ctx.fillStyle = "rgba(255,80,140,0.85)";
        ctx.fillRect((VIEW_W / 2 - w / 2) | 0, 14, (w * f) | 0, 12);

        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(e.patternName, (VIEW_W / 2 - w / 2) | 0, 40);

      } else {
        ctx.fillStyle = (e.type === "shooter") ? "rgba(140,190,255,0.92)" : "rgba(255,90,170,0.92)";
        ctx.fillRect(ex - e.r, ey - e.r, e.r * 2, e.r * 2);
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(ex - e.r + 3, ey - e.r + 3, e.r, e.r);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(ex + (e.type === "shooter" ? 6 : -8), ey - 3, 5, 5);
      }
    }

    // bullets
    for (i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      var bx = ((b.x - camX) + VIEW_OX) | 0;
      var by = ((b.y - camY) + VIEW_OY) | 0;
      ctx.fillStyle = (b.from === "player") ? "rgba(255,255,255,0.9)" : "rgba(255,200,90,0.9)";
      if (b.kind === "beL") ctx.fillStyle = "rgba(255,120,240,0.9)";
      ctx.fillRect(bx - 3, by - 3, 6, 6);
    }

    // player (more detailed)
    drawPlayer(camX, camY);
  }

  function drawPlayer(camX, camY) {
    var px = ((player.x - camX) + VIEW_OX) | 0;
    var py = ((player.y - camY) + VIEW_OY) | 0;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(px - player.r, py + player.r, player.r * 2, 8);

    // body silhouette
    var inv = (player.invT > 0);
    ctx.fillStyle = inv ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)";
    ctx.fillRect(px - 14, py - 10, 28, 26); // torso

    // head
    ctx.fillStyle = inv ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.88)";
    ctx.fillRect(px - 10, py - 22, 20, 14);

    // visor / accent
    ctx.fillStyle = "rgba(124,92,255,0.35)";
    ctx.fillRect(px - 8, py - 18, 16, 5);

    // backpack
    ctx.fillStyle = "rgba(124,92,255,0.18)";
    ctx.fillRect(px - 16, py - 6, 6, 18);

    // belt
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(px - 14, py + 2, 28, 3);

    // gun points toward mouse (screen-space)
    var gx = (mouse.x);
    var gy = (mouse.y);
    var dx = gx - px;
    var dy = gy - py;
    var n = norm(dx, dy);

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(px + (n.x * 10) | 0, py + (n.y * 4) | 0, 14, 6);

    ctx.fillStyle = "rgba(124,92,255,0.45)";
    ctx.fillRect(px + (n.x * 10) | 0, py + (n.y * 4) | 0, 10, 3);

    // reticle
    ctx.strokeStyle = "rgba(124,92,255,0.55)";
    ctx.strokeRect((mouse.x - 10) | 0, (mouse.y - 10) | 0, 20, 20);
  }

  function drawHUD(node) {
    ctx.fillStyle = "rgba(0,0,0,0.48)";
    ctx.fillRect(16, 12, 520, 86);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("HP", 28, 40);

    for (var i = 0; i < player.hpMax; i++) {
      ctx.fillStyle = (i < player.hp) ? "rgba(120,255,170,0.9)" : "rgba(255,255,255,0.12)";
      ctx.fillRect(62 + i * 18, 28, 14, 14);
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Coins: " + state.coins, 28, 70);

    var w = WEAPONS[player.weapon];
    ctx.fillText("Weapon: " + w.name + " (Q/E)", 220, 40);

    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("Room: " + node.kind + "   Depth: " + node.depth + "   [" + state.roomId + "]", 220, 70);

    if (state.msgT > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText(state.msg, 16, VIEW_H - 22);
    }
  }

  function drawShopHint() {
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(16, VIEW_H - 62, 620, 46);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("SHOP — press F at the counter. Buy with 1–7.", 28, VIEW_H - 34);
  }

  function drawShopOverlay() {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText("SHOP", 40, 60);

    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Coins: " + state.coins + "   (ESC to close)", 40, 84);

    var y = 130;
    for (var i = 0; i < SHOP_ITEMS.length; i++) {
      var it = SHOP_ITEMS[i];

      var owned = false;
      if (it.type === "unlock") owned = WEAPONS[it.weaponId].unlocked;

      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(40, y - 36, VIEW_W - 80, 58);

      ctx.fillStyle = "rgba(124,92,255,0.65)";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("[" + it.key + "]", 58, y);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText(it.label, 100, y);

      ctx.font = "14px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(it.desc, 100, y + 20);

      var right = VIEW_W - 210;
      if (owned) {
        ctx.fillStyle = "rgba(120,255,170,0.85)";
        ctx.fillText("OWNED", right, y);
      } else {
        ctx.fillStyle = (state.coins >= it.cost) ? "rgba(255,215,90,0.92)" : "rgba(255,255,255,0.35)";
        ctx.fillText(it.cost + " coins", right, y);
      }

      y += 76;
    }
  }

  function drawPause() {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText("PAUSED", 40, 62);
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("ESC: resume   R: restart   Q/E: cycle weapons   SPACE/SHIFT: dash", 40, 90);
  }

  // ---------- Resize (full window canvas, crisp) ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;

    var w = window.innerWidth;
    var h = window.innerHeight;

    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";

    canvas.width = (w * dpr) | 0;
    canvas.height = (h * dpr) | 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    VIEW_W = w;
    VIEW_H = h;

    snapCameraToPlayer();
  }

  // ---------- Reset ----------
  function resetGame() {
    state.msg = "";
    state.msgT = 0;
    state.coins = 0;
    state.roomId = "0,0";
    state.map = {};
    state.rooms = {};
    state.enemies = [];
    state.bullets = [];
    state.pickups = [];
    state.fx = [];
    state.paused = false;
    state.shopOpen = false;

    for (var i = 0; i < WEAPONS.length; i++) WEAPONS[i].unlocked = (WEAPONS[i].id === 0);

    player.x = ROOM_W / 2;
    player.y = ROOM_H / 2;
    player.hpMax = 8;
    player.hp = 8;
    player.invT = 0;
    player.dashT = 0;
    player.dashCD = 0;
    player.vx = 0;
    player.vy = 0;
    player.weapon = 0;
    player.fireCD = 0;
    player.burstQ = 0;
    player.burstCD = 0;

    ensureNode("0,0");
    ensureRoom("0,0");
    loadRoom("0,0");
    snapCameraToPlayer();
  }

  // ---------- Main loop ----------
  function frame(t) {
    if (!state.running) return;
    var now = t || 0;
    var dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 1 / 30);

    update(dt);
    draw();

    keysPressed = {};
    requestAnimationFrame(frame);
  }

  // ---------- Game create ----------
  var Game = {
    create: function () {
      canvas = document.getElementById("game");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "game";
        document.body.appendChild(canvas);
      }

      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      document.body.style.background = "#07060b";

      ctx = canvas.getContext("2d");

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("mousemove", onMouseMove);
      canvas.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("resize", resize);

      resize();
      resetGame();

      state.running = true;
      lastT = (performance && performance.now) ? performance.now() : 0;
      requestAnimationFrame(frame);
    }
  };

})();
